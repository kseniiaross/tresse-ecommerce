# tresse_backend/orders/tests.py
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import stripe
from django.contrib import messages
from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from django.contrib.messages import get_messages
from django.contrib.messages.storage.fallback import FallbackStorage
from django.core.cache import cache
from django.db import IntegrityError, connection
from django.template.loader import render_to_string
from django.test import Client, RequestFactory, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from orders.admin import OrderAdmin
from orders.models import Order, OrderItem
from products.models import Cart, CartItem, Product, ProductSize, Size

User = get_user_model()


def _make_user(email, **kwargs):
    defaults = dict(
        phone_number="1234567890",
        password="testpass123",
        first_name="Test",
        last_name="User",
    )
    defaults.update(kwargs)
    return User.objects.create_user(email=email, **defaults)


# ============================================================
# Order model
# ============================================================
class OrderPublicIdTestCase(TestCase):
    def setUp(self):
        self.user = _make_user("anna@example.com")

    def test_public_id_generated_on_save(self):
        order = Order.objects.create(
            user=self.user,
            full_name="Anna Smith",
            address="123 Main St",
            city="Kyiv",
            postal_code="01001",
            country="UA",
        )
        self.assertIsNotNone(order.public_id)
        self.assertTrue(order.public_id.startswith("TR-"))

    def test_public_id_is_unique_across_orders(self):
        order1 = Order.objects.create(
            user=self.user,
            full_name="A",
            address="a",
            city="a",
            postal_code="1",
            country="UA",
        )
        order2 = Order.objects.create(
            user=self.user,
            full_name="B",
            address="b",
            city="b",
            postal_code="2",
            country="UA",
        )
        self.assertNotEqual(order1.public_id, order2.public_id)

    def test_public_id_not_regenerated_on_resave(self):
        order = Order.objects.create(
            user=self.user,
            full_name="A",
            address="a",
            city="a",
            postal_code="1",
            country="UA",
        )
        original_id = order.public_id
        order.status = "paid"
        order.save()
        self.assertEqual(order.public_id, original_id)


class OrderSaveLogicTestCase(TestCase):
    def setUp(self):
        self.user = _make_user("ivan@example.com")

    def test_email_defaults_to_user_email(self):
        order = Order.objects.create(
            user=self.user,
            full_name="Ivan",
            address="a",
            city="a",
            postal_code="1",
            country="UA",
        )
        self.assertEqual(order.email, "ivan@example.com")

    def test_explicit_email_not_overwritten(self):
        order = Order.objects.create(
            user=self.user,
            full_name="Ivan",
            address="a",
            city="a",
            postal_code="1",
            country="UA",
            email="custom@example.com",
        )
        self.assertEqual(order.email, "custom@example.com")

    def test_subtotal_defaults_to_total_amount(self):
        order = Order.objects.create(
            user=self.user,
            full_name="Ivan",
            address="a",
            city="a",
            postal_code="1",
            country="UA",
            total_amount=Decimal("99.99"),
        )
        self.assertEqual(order.subtotal_amount, Decimal("99.99"))


class OrderPaymentIntentTestCase(TestCase):
    def setUp(self):
        self.user = _make_user("max@example.com")

    def test_duplicate_payment_intent_raises(self):
        Order.objects.create(
            user=self.user,
            full_name="A",
            address="a",
            city="a",
            postal_code="1",
            country="UA",
            stripe_payment_intent="pi_12345",
        )
        with self.assertRaises(IntegrityError):
            Order.objects.create(
                user=self.user,
                full_name="B",
                address="b",
                city="b",
                postal_code="2",
                country="UA",
                stripe_payment_intent="pi_12345",
            )


class OrderStatusDefaultsTestCase(TestCase):
    def setUp(self):
        self.user = _make_user("olga@example.com")

    def test_default_status_is_pending(self):
        order = Order.objects.create(
            user=self.user,
            full_name="Olga",
            address="a",
            city="a",
            postal_code="1",
            country="UA",
        )
        self.assertEqual(order.status, "pending")

    def test_default_return_status_is_empty(self):
        order = Order.objects.create(
            user=self.user,
            full_name="Olga",
            address="a",
            city="a",
            postal_code="1",
            country="UA",
        )
        self.assertEqual(order.return_status, "")


# ============================================================
# Stripe webhook (orders/views_stripe.py)
# ============================================================
def _fake_stripe_event(event_type, data_object):
    return {"type": event_type, "data": {"object": data_object}}


class StripeWebhookBaseTestCase(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = _make_user("anna_webhook@example.com")
        self.size, _ = Size.objects.get_or_create(name="M")
        self.product = Product.objects.create(name="Sweater", price=Decimal("50.00"))
        self.product_size = ProductSize.objects.create(
            product=self.product,
            size=self.size,
            quantity=5,
        )
        self.cart = Cart.objects.create(user=self.user)
        self.cart_item = CartItem.objects.create(
            cart=self.cart,
            product_size=self.product_size,
            quantity=2,
        )
        self.url = reverse("stripe-webhook")

    def _post_event(self, event):
        with patch("orders.views_stripe.stripe.Webhook.construct_event", return_value=event):
            return self.client.post(
                self.url,
                data=b"{}",
                content_type="application/json",
                HTTP_STRIPE_SIGNATURE="fake_sig",
            )


class CheckoutSessionCompletedTestCase(StripeWebhookBaseTestCase):
    def _build_session(self, cart_sig, **overrides):
        payload = {
            "id": "cs_test_123",
            "payment_intent": "pi_test_123",
            "amount_total": 10000,
            "amount_subtotal": 10000,
            "total_details": {"amount_discount": 0, "amount_tax": 0},
            "customer_details": {
                "name": "Anna Smith",
                "email": "anna_webhook@example.com",
                "address": {
                    "line1": "123 Main St",
                    "line2": "",
                    "city": "Kyiv",
                    "state": "",
                    "postal_code": "01001",
                    "country": "UA",
                },
            },
            "metadata": {
                "user_id": str(self.user.id),
                "cart_id": str(self.cart.id),
                "cart_sig": cart_sig,
                "policy_accepted": "true",
                "policy_version": "2026-06",
                "custom_size_final_sale_acknowledged": "false",
            },
        }
        payload.update(overrides)
        return payload

    @patch(
        "orders.views_stripe._extract_card_details_from_payment_intent",
        return_value=("visa", "4242"),
    )
    @patch("orders.views_stripe.send_order_confirmation_email")
    def test_successful_checkout_creates_order_and_decrements_stock(self, mock_email, mock_card):
        from orders.views_stripe import _build_cart_signature

        sig = _build_cart_signature([self.cart_item])
        session = self._build_session(sig)
        event = _fake_stripe_event("checkout.session.completed", session)

        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        order = Order.objects.get(stripe_payment_intent="pi_test_123")
        self.assertEqual(order.status, "paid")
        self.assertEqual(order.total_amount, Decimal("100.00"))
        self.assertEqual(order.items.count(), 1)

        self.product_size.refresh_from_db()
        self.assertEqual(self.product_size.quantity, 3)  # 5 - 2

        self.assertFalse(CartItem.objects.filter(cart=self.cart).exists())

    @patch(
        "orders.views_stripe._extract_card_details_from_payment_intent",
        return_value=("", ""),
    )
    @patch("orders.views_stripe.send_order_confirmation_email")
    def test_duplicate_webhook_is_idempotent(self, mock_email, mock_card):
        from orders.views_stripe import _build_cart_signature

        sig = _build_cart_signature([self.cart_item])
        session = self._build_session(sig)
        event = _fake_stripe_event("checkout.session.completed", session)

        self._post_event(event)
        self._post_event(event)

        self.assertEqual(Order.objects.filter(stripe_payment_intent="pi_test_123").count(), 1)

    def test_cart_signature_mismatch_does_not_create_order(self):
        session = self._build_session(cart_sig="tampered_signature")
        event = _fake_stripe_event("checkout.session.completed", session)

        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Order.objects.filter(stripe_payment_intent="pi_test_123").exists())

    def test_missing_policy_consent_does_not_create_order(self):
        from orders.views_stripe import _build_cart_signature

        sig = _build_cart_signature([self.cart_item])
        session = self._build_session(
            sig,
            metadata={
                "user_id": str(self.user.id),
                "cart_id": str(self.cart.id),
                "cart_sig": sig,
                "policy_accepted": "false",
                "policy_version": "",
            },
        )
        event = _fake_stripe_event("checkout.session.completed", session)

        self._post_event(event)

        self.assertFalse(Order.objects.filter(stripe_payment_intent="pi_test_123").exists())

    @patch("orders.views_stripe.send_checkout_stock_sold_out_email")
    @patch("orders.views_stripe.stripe.Refund.create")
    @patch("orders.views_stripe.send_checkout_webhook_alert")
    def test_insufficient_stock_does_not_create_order(
        self, mock_alert, mock_refund, mock_customer_email
    ):
        from orders.views_stripe import _build_cart_signature

        self.cart_item.quantity = 10
        self.cart_item.save()
        sig = _build_cart_signature([self.cart_item])
        session = self._build_session(sig)
        event = _fake_stripe_event("checkout.session.completed", session)

        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Order.objects.filter(stripe_payment_intent="pi_test_123").exists())
        self.product_size.refresh_from_db()
        self.assertEqual(self.product_size.quantity, 5)
        mock_refund.assert_called_once()


class CheckoutWebhookAlertTestCase(StripeWebhookBaseTestCase):
    """The 'Stripe captured money, no order got created' branches of
    stripe_webhook: each must alert ops, and the stock-shortage branch must
    also refund the customer and tell them."""

    def _build_session(self, cart_sig="sig", payment_intent="pi_test_alert", **overrides):
        payload = {
            "id": "cs_test_alert",
            "payment_intent": payment_intent,
            "amount_total": 10000,
            "amount_subtotal": 10000,
            "total_details": {"amount_discount": 0, "amount_tax": 0},
            "customer_details": {
                "name": "Anna Smith",
                "email": "anna_webhook@example.com",
                "address": {
                    "line1": "123 Main St",
                    "line2": "",
                    "city": "Kyiv",
                    "state": "",
                    "postal_code": "01001",
                    "country": "UA",
                },
            },
            "metadata": {
                "user_id": str(self.user.id),
                "cart_id": str(self.cart.id),
                "cart_sig": cart_sig,
                "policy_accepted": "true",
                "policy_version": "2026-06",
                "custom_size_final_sale_acknowledged": "false",
            },
        }
        payload.update(overrides)
        return payload

    @patch("orders.views_stripe.send_checkout_webhook_alert")
    def test_missing_metadata_sends_alert(self, mock_alert):
        session = self._build_session(metadata={})
        event = _fake_stripe_event("checkout.session.completed", session)

        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        mock_alert.assert_called_once()
        self.assertEqual(mock_alert.call_args.kwargs["reason"], "missing_metadata")

    @patch("orders.views_stripe.send_checkout_webhook_alert")
    def test_user_not_found_sends_alert(self, mock_alert):
        session = self._build_session(
            metadata={
                "user_id": "999999",
                "cart_id": str(self.cart.id),
                "cart_sig": "sig",
                "policy_accepted": "true",
                "policy_version": "2026-06",
                "custom_size_final_sale_acknowledged": "false",
            }
        )
        event = _fake_stripe_event("checkout.session.completed", session)

        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        mock_alert.assert_called_once()
        self.assertEqual(mock_alert.call_args.kwargs["reason"], "user_not_found")

    @patch("orders.views_stripe.send_checkout_webhook_alert")
    def test_cart_not_found_sends_alert(self, mock_alert):
        session = self._build_session(
            metadata={
                "user_id": str(self.user.id),
                "cart_id": "999999",
                "cart_sig": "sig",
                "policy_accepted": "true",
                "policy_version": "2026-06",
                "custom_size_final_sale_acknowledged": "false",
            }
        )
        event = _fake_stripe_event("checkout.session.completed", session)

        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        mock_alert.assert_called_once()
        self.assertEqual(mock_alert.call_args.kwargs["reason"], "cart_not_found")

    @patch("orders.views_stripe.send_checkout_webhook_alert")
    def test_empty_cart_sends_alert_when_no_order_exists(self, mock_alert):
        self.cart_item.delete()
        session = self._build_session()
        event = _fake_stripe_event("checkout.session.completed", session)

        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        mock_alert.assert_called_once()
        self.assertEqual(mock_alert.call_args.kwargs["reason"], "empty_cart")

    @patch(
        "orders.views_stripe._extract_card_details_from_payment_intent",
        return_value=("", ""),
    )
    @patch("orders.views_stripe.send_order_confirmation_email")
    @patch("orders.views_stripe.send_checkout_webhook_alert")
    def test_empty_cart_stays_silent_for_duplicate_delivery(
        self, mock_alert, mock_email, mock_card
    ):
        from orders.views_stripe import _build_cart_signature

        sig = _build_cart_signature([self.cart_item])
        session = self._build_session(cart_sig=sig, payment_intent="pi_dup")
        event = _fake_stripe_event("checkout.session.completed", session)

        first = self._post_event(event)
        self.assertEqual(first.status_code, 200)
        self.assertTrue(Order.objects.filter(stripe_payment_intent="pi_dup").exists())
        self.assertFalse(CartItem.objects.filter(cart=self.cart).exists())

        # Same event delivered again: the cart is now empty because the
        # first delivery already consumed it, but an order exists, so this
        # is an expected idempotent retry, not a real problem.
        second = self._post_event(event)

        self.assertEqual(second.status_code, 200)
        self.assertEqual(Order.objects.filter(stripe_payment_intent="pi_dup").count(), 1)
        mock_alert.assert_not_called()

    @patch("orders.views_stripe.send_checkout_webhook_alert")
    def test_policy_consent_missing_sends_alert(self, mock_alert):
        session = self._build_session(
            metadata={
                "user_id": str(self.user.id),
                "cart_id": str(self.cart.id),
                "cart_sig": "sig",
                "policy_accepted": "false",
                "policy_version": "",
                "custom_size_final_sale_acknowledged": "false",
            }
        )
        event = _fake_stripe_event("checkout.session.completed", session)

        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        mock_alert.assert_called_once()
        self.assertEqual(mock_alert.call_args.kwargs["reason"], "policy_consent_missing")

    @patch("orders.views_stripe.send_checkout_webhook_alert")
    def test_custom_ack_missing_sends_alert(self, mock_alert):
        self.cart_item.custom_length_selected = True
        self.cart_item.custom_length_cm = 120
        self.cart_item.save()

        from orders.views_stripe import _build_cart_signature

        sig = _build_cart_signature([self.cart_item])
        session = self._build_session(
            cart_sig=sig,
            metadata={
                "user_id": str(self.user.id),
                "cart_id": str(self.cart.id),
                "cart_sig": sig,
                "policy_accepted": "true",
                "policy_version": "2026-06",
                "custom_size_final_sale_acknowledged": "false",
            },
        )
        event = _fake_stripe_event("checkout.session.completed", session)

        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        mock_alert.assert_called_once()
        self.assertEqual(mock_alert.call_args.kwargs["reason"], "custom_ack_missing")

    @patch("orders.views_stripe.send_checkout_webhook_alert")
    def test_cart_signature_mismatch_sends_alert(self, mock_alert):
        session = self._build_session(cart_sig="tampered-signature")
        event = _fake_stripe_event("checkout.session.completed", session)

        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        mock_alert.assert_called_once()
        self.assertEqual(mock_alert.call_args.kwargs["reason"], "cart_signature_mismatch")

    @patch("orders.views_stripe.send_checkout_stock_sold_out_email")
    @patch("orders.views_stripe.stripe.Refund.create")
    @patch("orders.views_stripe.send_checkout_webhook_alert")
    def test_stock_insufficient_alerts_refunds_and_notifies_customer(
        self, mock_alert, mock_refund, mock_customer_email
    ):
        mock_refund.return_value = {"id": "re_soldout", "status": "succeeded"}
        self.cart_item.quantity = 10
        self.cart_item.save()

        from orders.views_stripe import _build_cart_signature

        sig = _build_cart_signature([self.cart_item])
        session = self._build_session(cart_sig=sig, payment_intent="pi_soldout")
        event = _fake_stripe_event("checkout.session.completed", session)

        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Order.objects.filter(stripe_payment_intent="pi_soldout").exists())
        self.product_size.refresh_from_db()
        self.assertEqual(self.product_size.quantity, 5)

        mock_alert.assert_called_once()
        self.assertEqual(mock_alert.call_args.kwargs["reason"], "stock_insufficient")

        mock_refund.assert_called_once()
        refund_kwargs = mock_refund.call_args.kwargs
        self.assertEqual(refund_kwargs["payment_intent"], "pi_soldout")
        self.assertEqual(refund_kwargs["idempotency_key"], "stock_sold_out_refund_pi_soldout")

        mock_customer_email.assert_called_once()
        email_kwargs = mock_customer_email.call_args.kwargs
        self.assertEqual(email_kwargs["to_email"], "anna_webhook@example.com")
        self.assertEqual(email_kwargs["amount"], Decimal("100.00"))

    @patch("orders.views_stripe.send_checkout_stock_sold_out_email")
    @patch(
        "orders.views_stripe.stripe.Refund.create",
        side_effect=stripe.error.StripeError("boom"),
    )
    @patch("orders.views_stripe.send_checkout_webhook_alert")
    def test_stock_insufficient_refund_failure_skips_customer_email(
        self, mock_alert, mock_refund, mock_customer_email
    ):
        self.cart_item.quantity = 10
        self.cart_item.save()

        from orders.views_stripe import _build_cart_signature

        sig = _build_cart_signature([self.cart_item])
        session = self._build_session(cart_sig=sig, payment_intent="pi_soldout_fail")
        event = _fake_stripe_event("checkout.session.completed", session)

        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Order.objects.filter(stripe_payment_intent="pi_soldout_fail").exists())
        mock_refund.assert_called_once()
        mock_customer_email.assert_not_called()


class CheckoutWebhookAlertHelperTestCase(StripeWebhookBaseTestCase):
    """A failure inside send_checkout_webhook_alert (Sentry or the support
    email) must be logged and swallowed, never bubble up into the webhook
    response — exercised through the real helper, not a mock of it."""

    @override_settings(SUPPORT_EMAIL="ops@example.com")
    @patch("orders.emails.EmailMessage.send", side_effect=Exception("smtp down"))
    def test_failing_support_email_still_returns_200(self, mock_send):
        session = {
            "id": "cs_test_alertfail",
            "payment_intent": None,
            "amount_total": 0,
            "amount_subtotal": 0,
            "total_details": {},
            "customer_details": {},
            "metadata": {},
        }
        event = _fake_stripe_event("checkout.session.completed", session)

        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        mock_send.assert_called_once()

    @override_settings(SUPPORT_EMAIL="ops@example.com")
    @patch("orders.emails.sentry_sdk.capture_message", side_effect=Exception("sentry down"))
    def test_failing_sentry_capture_still_returns_200_and_still_emails(self, mock_capture):
        session = {
            "id": "cs_test_sentryfail",
            "payment_intent": None,
            "amount_total": 0,
            "amount_subtotal": 0,
            "total_details": {},
            "customer_details": {},
            "metadata": {},
        }
        event = _fake_stripe_event("checkout.session.completed", session)

        with patch("orders.emails.EmailMessage.send") as mock_send:
            resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        mock_capture.assert_called_once()
        mock_send.assert_called_once()

    @override_settings(SUPPORT_EMAIL="")
    @patch("orders.emails.sentry_sdk.capture_message")
    def test_no_support_email_configured_skips_email_but_still_calls_sentry(self, mock_capture):
        session = {
            "id": "cs_test_nosupport",
            "payment_intent": None,
            "amount_total": 0,
            "amount_subtotal": 0,
            "total_details": {},
            "customer_details": {},
            "metadata": {},
        }
        event = _fake_stripe_event("checkout.session.completed", session)

        with patch("orders.emails.EmailMessage.send") as mock_send:
            resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        mock_capture.assert_called_once()
        mock_send.assert_not_called()


class StripeWebhookSignatureTestCase(StripeWebhookBaseTestCase):
    def test_invalid_signature_rejected(self):
        with patch(
            "orders.views_stripe.stripe.Webhook.construct_event",
            side_effect=Exception("bad sig"),
        ):
            resp = self.client.post(
                self.url,
                data=b"{}",
                content_type="application/json",
                HTTP_STRIPE_SIGNATURE="wrong",
            )
        self.assertEqual(resp.status_code, 400)

    def test_unknown_event_type_ignored(self):
        event = _fake_stripe_event("payment_intent.created", {})
        resp = self._post_event(event)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Order.objects.count(), 0)


class RefundWebhookTestCase(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = _make_user("ivan_refund@example.com")
        self.order = Order.objects.create(
            user=self.user,
            full_name="Ivan",
            address="a",
            city="a",
            postal_code="1",
            country="UA",
            status="paid",
            return_status="refund_pending",
            stripe_refund_id="re_test_123",
        )
        self.url = reverse("stripe-webhook")

    def _post_event(self, event):
        with patch("orders.views_stripe.stripe.Webhook.construct_event", return_value=event):
            return self.client.post(
                self.url,
                data=b"{}",
                content_type="application/json",
                HTTP_STRIPE_SIGNATURE="fake_sig",
            )

    def test_refund_succeeded_updates_order(self):
        event = _fake_stripe_event(
            "refund.updated",
            {"id": "re_test_123", "status": "succeeded"},
        )
        resp = self._post_event(event)

        self.assertEqual(resp.status_code, 200)
        self.order.refresh_from_db()
        self.assertEqual(self.order.refund_status, "succeeded")
        self.assertEqual(self.order.return_status, "refunded")
        self.assertIsNotNone(self.order.return_refunded_at)

    def test_refund_for_unknown_id_does_not_crash(self):
        event = _fake_stripe_event(
            "refund.updated",
            {"id": "re_unknown", "status": "succeeded"},
        )
        resp = self._post_event(event)
        self.assertEqual(resp.status_code, 200)


# ============================================================
# Email templates render (smoke test)
# ============================================================
class OrderEmailTemplatesRenderTestCase(TestCase):
    def _fake_order(self):
        class FakeOrder:
            id = 1
            full_name = "Anna Smith"
            address = "123 Main St"
            city = "Kyiv"
            state = ""
            postal_code = "01001"
            country = "UA"
            card_last4 = "4242"
            total_amount = "100.00"
            created_at = "2026-08-05"

        return FakeOrder()

    def test_order_confirmation_renders(self):
        html = render_to_string(
            "emails/orders/order_confirmation.txt",
            {
                "order": self._fake_order(),
                "items": [
                    {
                        "quantity": 1,
                        "product_name": "Sweater",
                        "size": "M",
                        "unit_price": "50.00",
                    }
                ],
                "support_email": "support@tresseknitting.com",
                "support_url": "https://www.tresseknitting.com/help",
            },
        )
        self.assertIn("Order Confirmation", html)
        self.assertIn("Sweater", html)

    def test_order_canceled_renders(self):
        html = render_to_string(
            "emails/orders/order_canceled.txt",
            {
                "order": self._fake_order(),
                "items": [],
                "support_email": "support@tresseknitting.com",
            },
        )
        self.assertIn("Order Canceled", html)

    def test_refund_initiated_renders(self):
        html = render_to_string(
            "emails/orders/refund_initiated.txt",
            {
                "order": self._fake_order(),
                "support_email": "support@tresseknitting.com",
            },
        )
        self.assertIn("Refund Initiated", html)

    def test_shipping_confirmation_renders_with_tracking(self):
        html = render_to_string(
            "emails/orders/shipping_confirmation.txt",
            {
                "order": self._fake_order(),
                "tracking_number": "1Z999",
                "tracking_url": "https://track.example.com/1Z999",
                "support_email": "support@tresseknitting.com",
            },
        )
        self.assertIn("1Z999", html)

    def test_delivered_renders(self):
        html = render_to_string(
            "emails/orders/delivered.txt",
            {
                "order": self._fake_order(),
                "support_email": "support@tresseknitting.com",
            },
        )
        self.assertIn("Delivered", html)


# ============================================================
# Admin shipping actions
# ============================================================
class OrderAdminShippingActionsTestCase(TestCase):
    def setUp(self):
        self.user = _make_user("shipping@example.com")
        self.admin = OrderAdmin(Order, AdminSite())
        self.factory = RequestFactory()

    def _request(self):
        request = self.factory.post("/admin/orders/order/")
        request.session = {}
        request._messages = FallbackStorage(request)
        return request

    def _make_order(self, **kwargs):
        defaults = dict(
            user=self.user,
            full_name="Anna Smith",
            address="123 Main St",
            city="Kyiv",
            postal_code="01001",
            country="UA",
            status="paid",
        )
        defaults.update(kwargs)
        return Order.objects.create(**defaults)

    @patch("orders.admin.send_shipping_confirmation_email")
    def test_mark_shipped_sends_email_and_sets_timestamp(self, mock_send):
        order = self._make_order(tracking_number="1Z999AA1")

        self.admin.mark_shipped(
            self._request(),
            Order.objects.filter(pk=order.pk),
        )

        order.refresh_from_db()
        self.assertIsNotNone(order.shipped_at)
        mock_send.assert_called_once()
        _, call_kwargs = mock_send.call_args
        self.assertEqual(call_kwargs["order"], order)
        self.assertEqual(call_kwargs["tracking_number"], "1Z999AA1")
        self.assertIn("1Z999AA1", call_kwargs["tracking_url"])

    @patch("orders.admin.send_shipping_confirmation_email")
    def test_mark_shipped_skips_ineligible_order(self, mock_send):
        # No tracking number set, so this order does not qualify.
        order = self._make_order(tracking_number="")

        self.admin.mark_shipped(
            self._request(),
            Order.objects.filter(pk=order.pk),
        )

        order.refresh_from_db()
        self.assertIsNone(order.shipped_at)
        mock_send.assert_not_called()

    @patch("orders.admin.send_delivered_email")
    def test_mark_delivered_sends_email_and_sets_timestamp(self, mock_send):
        order = self._make_order(
            tracking_number="1Z999AA1",
            shipped_at=timezone.now(),
        )

        self.admin.mark_delivered(
            self._request(),
            Order.objects.filter(pk=order.pk),
        )

        order.refresh_from_db()
        self.assertIsNotNone(order.delivered_at)
        mock_send.assert_called_once_with(order=order)

    @patch("orders.admin.send_delivered_email")
    def test_mark_delivered_skips_order_not_yet_shipped(self, mock_send):
        order = self._make_order(shipped_at=None)

        self.admin.mark_delivered(
            self._request(),
            Order.objects.filter(pk=order.pk),
        )

        order.refresh_from_db()
        self.assertIsNone(order.delivered_at)
        mock_send.assert_not_called()


# ============================================================
# Shared fixtures for the money-moving endpoints and admin actions
# ============================================================
class OrderFixtureMixin:
    """Builds orders and items with a unique payment intent per order."""

    _order_counter = 0

    def _make_product(self):
        if not hasattr(self, "_product"):
            self._product = Product.objects.create(name="Corset", price=Decimal("80.00"))
        return self._product

    def _make_order(self, user=None, **kwargs):
        type(self)._order_counter += 1
        n = type(self)._order_counter
        defaults = dict(
            user=user or self.user,
            full_name="Anna Smith",
            address="123 Main St",
            city="Kyiv",
            postal_code="01001",
            country="UA",
            status="paid",
            stripe_payment_intent=f"pi_test_{type(self).__name__}_{n}",
        )
        defaults.update(kwargs)
        return Order.objects.create(**defaults)

    def _add_item(self, order, **kwargs):
        defaults = dict(
            order=order,
            product=self._make_product(),
            size="M",
            quantity=1,
            unit_price=Decimal("80.00"),
        )
        defaults.update(kwargs)
        return OrderItem.objects.create(**defaults)

    def _age(self, order, **delta):
        """Move created_at back; it is auto_now_add so it cannot be passed to create()."""
        Order.objects.filter(pk=order.pk).update(created_at=timezone.now() - timedelta(**delta))
        order.refresh_from_db()


# ============================================================
# API: My orders
# ============================================================
class MyOrdersAPITestCase(OrderFixtureMixin, TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = _make_user("mine@example.com")
        self.other = _make_user("other@example.com", phone_number="0987654321")
        self.url = reverse("orders-my")

    def test_requires_auth(self):
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_returns_only_own_orders_newest_first(self):
        older = self._make_order()
        newer = self._make_order()
        self._age(older, days=2)
        foreign = self._make_order(user=self.other)
        self._add_item(older)
        self._add_item(foreign)

        self.client.force_authenticate(user=self.user)
        resp = self.client.get(self.url)

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual([o["id"] for o in resp.data], [newer.id, older.id])
        self.assertNotIn(foreign.id, [o["id"] for o in resp.data])
        self.assertEqual(resp.data[1]["items"][0]["product_name"], "Corset")

    def test_user_without_orders_gets_empty_list(self):
        self._make_order(user=self.other)

        self.client.force_authenticate(user=self.user)
        resp = self.client.get(self.url)

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data, [])


# ============================================================
# API: Cancel order
# ============================================================
class CancelOrderAPITestCase(OrderFixtureMixin, TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = _make_user("cancel@example.com")
        self.other = _make_user("cancel-other@example.com", phone_number="0987654321")
        self.client.force_authenticate(user=self.user)

    def _url(self, order):
        return reverse("order-cancel", args=[order.id])

    @patch("orders.views.send_refund_initiated_email")
    @patch("orders.views.send_order_canceled_email")
    @patch("orders.views.stripe.Refund.create")
    def test_cancel_inside_window_refunds_and_marks_canceled(
        self, mock_refund, mock_canceled_email, mock_refund_email
    ):
        mock_refund.return_value = {"id": "re_cancel_1", "status": "pending"}
        order = self._make_order()
        self._add_item(order)
        self._age(order, hours=23)

        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["status"], "canceled")

        mock_refund.assert_called_once()
        kwargs = mock_refund.call_args.kwargs
        self.assertEqual(kwargs["payment_intent"], order.stripe_payment_intent)
        self.assertEqual(kwargs["metadata"]["reason"], "customer_cancellation")
        self.assertEqual(kwargs["metadata"]["order_id"], str(order.id))
        self.assertIn(order.stripe_payment_intent, kwargs["idempotency_key"])

        order.refresh_from_db()
        self.assertEqual(order.status, "canceled")
        self.assertEqual(order.stripe_refund_id, "re_cancel_1")
        self.assertEqual(order.refund_status, "pending")
        self.assertIsNotNone(order.refund_initiated_at)

        mock_canceled_email.assert_called_once()
        mock_refund_email.assert_called_once()

    @patch("orders.views.stripe.Refund.create")
    def test_cancel_outside_window_is_refused(self, mock_refund):
        order = self._make_order()
        self._age(order, hours=25)

        resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        mock_refund.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.status, "paid")
        self.assertEqual(order.stripe_refund_id, "")

    @patch("orders.views.stripe.Refund.create")
    def test_cancel_other_users_order_is_404(self, mock_refund):
        order = self._make_order(user=self.other)

        resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        mock_refund.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.status, "paid")

    def test_cancel_requires_auth(self):
        order = self._make_order()

        resp = APIClient().post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    @patch("orders.views.stripe.Refund.create")
    def test_cancel_refused_when_order_not_paid(self, mock_refund):
        order = self._make_order(status="canceled")

        resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        mock_refund.assert_not_called()

    @patch("orders.views.stripe.Refund.create")
    def test_cancel_refused_when_return_workflow_started(self, mock_refund):
        order = self._make_order(return_status="requested")

        resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        mock_refund.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.status, "paid")

    @patch("orders.views.stripe.Refund.create")
    def test_cancel_refused_when_refund_already_exists(self, mock_refund):
        order = self._make_order(stripe_refund_id="re_existing")

        resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        mock_refund.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.status, "paid")

    @patch("orders.views.stripe.Refund.create")
    def test_cancel_refused_without_payment_intent(self, mock_refund):
        order = self._make_order(stripe_payment_intent=None)

        resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        mock_refund.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.status, "paid")

    @patch("orders.views.stripe.Refund.create", side_effect=stripe.error.StripeError("boom"))
    def test_cancel_leaves_order_paid_when_stripe_fails(self, mock_refund):
        order = self._make_order()

        resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        self.assertEqual(order.status, "paid")
        self.assertEqual(order.stripe_refund_id, "")
        # A failed Stripe call clears the "initiating" marker phase 1 set,
        # so the customer can retry.
        self.assertEqual(order.refund_status, "")
        self.assertIsNone(order.refund_initiated_at)

    @patch("orders.views.stripe.Refund.create", return_value={"status": "pending"})
    def test_cancel_with_refund_response_missing_id_is_502(self, mock_refund):
        order = self._make_order()

        resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_502_BAD_GATEWAY)
        order.refresh_from_db()
        self.assertEqual(order.status, "paid")
        self.assertEqual(order.refund_status, "")
        self.assertIsNone(order.refund_initiated_at)

    @patch("orders.views.stripe.Refund.create")
    def test_cancel_refused_when_refund_already_initiating(self, mock_refund):
        order = self._make_order(refund_status="initiating", refund_initiated_at=timezone.now())

        resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        mock_refund.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.status, "paid")
        self.assertEqual(order.refund_status, "initiating")

    @patch("orders.views.send_refund_initiated_email")
    @patch("orders.views.send_order_canceled_email")
    @patch("orders.views.stripe.Refund.create")
    def test_cancel_stays_discoverable_when_recording_the_result_fails(
        self, mock_refund, mock_canceled_email, mock_refund_email
    ):
        mock_refund.return_value = {"id": "re_cancel_recordfail", "status": "succeeded"}
        order = self._make_order()
        self._add_item(order)

        # Simulate phase 3 (recording the already-issued refund) failing.
        # Phase 1 also calls order.save(), but only with the "initiating"
        # fields; phase 3's save is the one that includes "status", so only
        # that call is made to fail.
        original_save = Order.save

        def flaky_save(self_order, *args, **kwargs):
            update_fields = kwargs.get("update_fields") or (args[1] if len(args) > 1 else None)
            if update_fields and "status" in update_fields:
                raise RuntimeError("db exploded while recording the refund")
            return original_save(self_order, *args, **kwargs)

        with patch.object(Order, "save", flaky_save):
            resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        mock_canceled_email.assert_not_called()

        order.refresh_from_db()
        # The refund happened at Stripe (mock_refund was called), but
        # recording it failed, so the order is left showing "initiating"
        # rather than silently reverting to "no refund" — it stays
        # discoverable by reconciling against Stripe.
        mock_refund.assert_called_once()
        self.assertEqual(order.status, "paid")
        self.assertEqual(order.refund_status, "initiating")
        self.assertEqual(order.stripe_refund_id, "")

    @patch("orders.views.send_refund_initiated_email")
    @patch("orders.views.send_order_canceled_email")
    def test_cancel_calls_stripe_outside_the_views_own_atomic_block(
        self, mock_canceled_email, mock_refund_email
    ):
        order = self._make_order()
        self._add_item(order)

        baseline_depth = len(connection.savepoint_ids)
        observed_depth = {}

        def fake_refund_create(**kwargs):
            observed_depth["value"] = len(connection.savepoint_ids)
            return {"id": "re_depth_check", "status": "pending"}

        with patch("orders.views.stripe.Refund.create", side_effect=fake_refund_create):
            with self.captureOnCommitCallbacks(execute=True):
                resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # Phase 1's `transaction.atomic()` has already been left by the
        # time Stripe is called, so the Stripe call runs at the same
        # savepoint depth as before the request — not nested one deeper
        # inside that transaction.
        self.assertEqual(observed_depth["value"], baseline_depth)
        self.assertEqual(order.stripe_refund_id, "")


# ============================================================
# API: Request return
# ============================================================
class RequestReturnAPITestCase(OrderFixtureMixin, TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = _make_user("return@example.com")
        self.other = _make_user("return-other@example.com", phone_number="0987654321")
        self.client.force_authenticate(user=self.user)

    def _url(self, order):
        return reverse("order-return", args=[order.id])

    def _delivered_order(self, days_ago=1, **kwargs):
        return self._make_order(delivered_at=timezone.now() - timedelta(days=days_ago), **kwargs)

    def _assert_refused(self, order, resp):
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        self.assertEqual(order.return_status, "")
        self.assertIsNone(order.return_requested_at)

    def test_return_accepted_for_delivered_standard_order_in_window(self):
        order = self._delivered_order(days_ago=13)
        self._add_item(order)

        resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["return_status"], "requested")
        order.refresh_from_db()
        self.assertEqual(order.return_status, "requested")
        self.assertIsNotNone(order.return_requested_at)

    def test_return_refused_for_final_sale_item(self):
        order = self._delivered_order()
        self._add_item(order)
        self._add_item(order, return_policy=OrderItem.ReturnPolicy.FINAL_SALE)

        self._assert_refused(order, self.client.post(self._url(order)))

    def test_return_refused_for_hygiene_item(self):
        order = self._delivered_order()
        self._add_item(order, return_policy=OrderItem.ReturnPolicy.NON_RETURNABLE_HYGIENE)

        self._assert_refused(order, self.client.post(self._url(order)))

    def test_return_refused_for_custom_size_item(self):
        order = self._delivered_order()
        self._add_item(order, size="Custom Size")

        self._assert_refused(order, self.client.post(self._url(order)))

    def test_return_refused_for_custom_length_item(self):
        order = self._delivered_order()
        self._add_item(order, custom_length_selected=True, custom_length_cm=120)

        self._assert_refused(order, self.client.post(self._url(order)))

    def test_return_refused_without_delivered_at(self):
        order = self._make_order(delivered_at=None)
        self._add_item(order)

        self._assert_refused(order, self.client.post(self._url(order)))

    def test_return_refused_outside_window(self):
        order = self._delivered_order(days_ago=15)
        self._add_item(order)

        self._assert_refused(order, self.client.post(self._url(order)))

    def test_return_window_counts_from_delivery_not_purchase(self):
        order = self._delivered_order(days_ago=1)
        self._add_item(order)
        self._age(order, days=40)

        resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_return_refused_when_already_requested(self):
        order = self._delivered_order(return_status="requested")
        self._add_item(order)

        resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        self.assertIsNone(order.return_requested_at)

    def test_return_refused_when_order_not_paid(self):
        order = self._delivered_order(status="canceled")
        self._add_item(order)

        self._assert_refused(order, self.client.post(self._url(order)))

    def test_return_other_users_order_is_404(self):
        order = self._delivered_order(user=self.other)
        self._add_item(order)

        resp = self.client.post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        order.refresh_from_db()
        self.assertEqual(order.return_status, "")

    def test_return_requires_auth(self):
        order = self._delivered_order()

        resp = APIClient().post(self._url(order))

        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


# ============================================================
# Admin return / refund actions
# ============================================================
class OrderAdminReturnActionsTestCase(OrderFixtureMixin, TestCase):
    def setUp(self):
        self.user = _make_user("admin-returns@example.com")
        self.admin = OrderAdmin(Order, AdminSite())
        self.factory = RequestFactory()

    def _request(self):
        request = self.factory.post("/admin/orders/order/")
        request.session = {}
        request._messages = FallbackStorage(request)
        return request

    def _run(self, action, *orders):
        request = self._request()
        action(request, Order.objects.filter(pk__in=[o.pk for o in orders]))
        return [(m.level, m.message) for m in get_messages(request)]

    def _order_with_item(self, item_kwargs=None, **order_kwargs):
        order = self._make_order(**order_kwargs)
        self._add_item(order, **(item_kwargs or {}))
        return order

    def _status_of(self, *orders):
        result = []
        for order in orders:
            order.refresh_from_db()
            result.append(order.return_status)
        return result

    # ---------------- approve_return ----------------
    def test_approve_return_changes_only_qualifying_orders(self):
        ok = self._order_with_item(return_status="requested")
        final_sale = self._order_with_item(
            {"return_policy": OrderItem.ReturnPolicy.FINAL_SALE}, return_status="requested"
        )
        hygiene = self._order_with_item(
            {"return_policy": OrderItem.ReturnPolicy.NON_RETURNABLE_HYGIENE},
            return_status="requested",
        )
        custom = self._order_with_item({"size": "CUSTOM SIZE"}, return_status="requested")
        no_return = self._order_with_item(return_status="")
        already = self._order_with_item(return_status="approved")

        msgs = self._run(
            self.admin.approve_return, ok, final_sale, hygiene, custom, no_return, already
        )

        self.assertEqual(
            self._status_of(ok, final_sale, hygiene, custom, no_return, already),
            ["approved", "requested", "requested", "requested", "", "approved"],
        )
        ok.refresh_from_db()
        self.assertIsNotNone(ok.return_approved_at)
        already.refresh_from_db()
        self.assertIsNone(already.return_approved_at)

        self.assertIn((messages.SUCCESS, "1 return(s) approved."), msgs)
        self.assertTrue(
            any(lvl == messages.WARNING and "5 order(s) skipped" in m for lvl, m in msgs)
        )

    def test_approve_return_reports_no_success_when_nothing_qualifies(self):
        order = self._order_with_item(return_status="")

        msgs = self._run(self.admin.approve_return, order)

        self.assertEqual(self._status_of(order), [""])
        self.assertEqual([lvl for lvl, _ in msgs], [messages.WARNING])
        self.assertIn("1 order(s) skipped", msgs[0][1])

    # ---------------- mark_return_received ----------------
    def test_mark_return_received_changes_only_approved_orders(self):
        approved = self._order_with_item(return_status="approved")
        requested = self._order_with_item(return_status="requested")
        none = self._order_with_item(return_status="")
        received = self._order_with_item(return_status="received")

        msgs = self._run(self.admin.mark_return_received, approved, requested, none, received)

        self.assertEqual(
            self._status_of(approved, requested, none, received),
            ["received", "requested", "", "received"],
        )
        approved.refresh_from_db()
        self.assertIsNotNone(approved.return_received_at)
        received.refresh_from_db()
        self.assertIsNone(received.return_received_at)

        self.assertIn((messages.SUCCESS, "1 return(s) marked as received."), msgs)
        self.assertTrue(
            any(lvl == messages.WARNING and "3 order(s) skipped" in m for lvl, m in msgs)
        )

    # ---------------- reject_return ----------------
    def test_reject_return_changes_only_requested_or_approved_orders(self):
        requested = self._order_with_item(return_status="requested")
        approved = self._order_with_item(return_status="approved")
        received = self._order_with_item(return_status="received")
        refunded = self._order_with_item(return_status="refunded")
        none = self._order_with_item(return_status="")

        msgs = self._run(self.admin.reject_return, requested, approved, received, refunded, none)

        self.assertEqual(
            self._status_of(requested, approved, received, refunded, none),
            ["rejected", "rejected", "received", "refunded", ""],
        )
        requested.refresh_from_db()
        self.assertIsNotNone(requested.return_rejected_at)
        received.refresh_from_db()
        self.assertIsNone(received.return_rejected_at)

        self.assertIn((messages.SUCCESS, "2 return(s) rejected."), msgs)
        self.assertTrue(
            any(lvl == messages.WARNING and "3 order(s) skipped" in m for lvl, m in msgs)
        )

    # ---------------- issue_stripe_refund ----------------
    @patch("orders.admin.stripe.Refund.create")
    def test_issue_stripe_refund_refunds_only_qualifying_orders(self, mock_refund):
        mock_refund.side_effect = [
            {"id": "re_pending", "status": "pending"},
            {"id": "re_done", "status": "succeeded"},
        ]
        pending = self._order_with_item(return_status="received")
        instant = self._order_with_item(return_status="received")
        not_received = self._order_with_item(return_status="approved")
        final_sale = self._order_with_item(
            {"return_policy": OrderItem.ReturnPolicy.FINAL_SALE}, return_status="received"
        )
        custom = self._order_with_item({"size": "CUSTOM SIZE"}, return_status="received")
        has_refund = self._order_with_item(return_status="received", stripe_refund_id="re_old")
        no_intent = self._order_with_item(return_status="received", stripe_payment_intent=None)

        msgs = self._run(
            self.admin.issue_stripe_refund,
            pending,
            instant,
            not_received,
            final_sale,
            custom,
            has_refund,
            no_intent,
        )

        # Orders are processed in queryset (pk) order, so `pending` gets the first response.
        self.assertEqual(mock_refund.call_count, 2)
        called_intents = {c.kwargs["payment_intent"] for c in mock_refund.call_args_list}
        self.assertEqual(
            called_intents, {pending.stripe_payment_intent, instant.stripe_payment_intent}
        )
        for call in mock_refund.call_args_list:
            self.assertEqual(call.kwargs["metadata"]["reason"], "approved_customer_return")
            self.assertTrue(call.kwargs["idempotency_key"].startswith("return_refund_"))

        self.assertEqual(
            self._status_of(
                pending, instant, not_received, final_sale, custom, has_refund, no_intent
            ),
            [
                "refund_pending",
                "refunded",
                "approved",
                "received",
                "received",
                "received",
                "received",
            ],
        )
        pending.refresh_from_db()
        self.assertEqual(pending.stripe_refund_id, "re_pending")
        self.assertEqual(pending.refund_status, "pending")
        self.assertIsNotNone(pending.refund_initiated_at)
        self.assertIsNone(pending.return_refunded_at)
        instant.refresh_from_db()
        self.assertEqual(instant.stripe_refund_id, "re_done")
        self.assertIsNotNone(instant.return_refunded_at)
        has_refund.refresh_from_db()
        self.assertEqual(has_refund.stripe_refund_id, "re_old")

        self.assertIn((messages.SUCCESS, "2 Stripe refund(s) initiated."), msgs)
        self.assertTrue(
            any(lvl == messages.WARNING and "5 order(s) skipped" in m for lvl, m in msgs)
        )
        self.assertFalse(any(lvl == messages.ERROR for lvl, _ in msgs))

    @patch("orders.admin.stripe.Refund.create", side_effect=stripe.error.StripeError("boom"))
    def test_issue_stripe_refund_reports_stripe_failure_and_leaves_order_untouched(
        self, mock_refund
    ):
        order = self._order_with_item(return_status="received")

        msgs = self._run(self.admin.issue_stripe_refund, order)

        self.assertEqual(self._status_of(order), ["received"])
        order.refresh_from_db()
        self.assertEqual(order.stripe_refund_id, "")
        self.assertEqual([lvl for lvl, _ in msgs], [messages.ERROR])
        self.assertIn("1 Stripe refund(s) failed.", msgs[0][1])

    @patch("orders.admin.stripe.Refund.create", return_value={"status": "pending"})
    def test_issue_stripe_refund_reports_failure_when_response_has_no_id(self, mock_refund):
        order = self._order_with_item(return_status="received")

        msgs = self._run(self.admin.issue_stripe_refund, order)

        self.assertEqual(self._status_of(order), ["received"])
        order.refresh_from_db()
        self.assertEqual(order.stripe_refund_id, "")
        self.assertEqual([lvl for lvl, _ in msgs], [messages.ERROR])

    @patch("orders.admin.stripe.Refund.create", side_effect=stripe.error.StripeError("boom"))
    def test_issue_stripe_refund_stripe_failure_clears_initiating_marker(self, mock_refund):
        order = self._order_with_item(return_status="received")

        msgs = self._run(self.admin.issue_stripe_refund, order)

        mock_refund.assert_called_once()
        self.assertEqual([lvl for lvl, _ in msgs], [messages.ERROR])
        order.refresh_from_db()
        self.assertEqual(order.return_status, "received")
        self.assertEqual(order.refund_status, "")
        self.assertIsNone(order.refund_initiated_at)

    def test_issue_stripe_refund_skips_order_already_initiating(self):
        order = self._order_with_item(
            return_status="received",
            refund_status="initiating",
            refund_initiated_at=timezone.now(),
        )

        with patch("orders.admin.stripe.Refund.create") as mock_refund:
            msgs = self._run(self.admin.issue_stripe_refund, order)

        mock_refund.assert_not_called()
        self.assertEqual(self._status_of(order), ["received"])
        order.refresh_from_db()
        self.assertEqual(order.refund_status, "initiating")
        self.assertTrue(
            any(lvl == messages.WARNING and "1 order(s) skipped" in m for lvl, m in msgs)
        )

    @patch("orders.admin.stripe.Refund.create")
    def test_issue_stripe_refund_stays_discoverable_when_recording_the_result_fails(
        self, mock_refund
    ):
        mock_refund.return_value = {"id": "re_admin_recordfail", "status": "succeeded"}
        order = self._order_with_item(return_status="received")

        # Simulate phase 3 (recording the already-issued refund) failing.
        # Phase 1 also calls order.save(), but only with the "initiating"
        # fields; phase 3's save is the one that includes "stripe_refund_id",
        # so only that call is made to fail.
        original_save = Order.save

        def flaky_save(self_order, *args, **kwargs):
            update_fields = kwargs.get("update_fields") or (args[1] if len(args) > 1 else None)
            if update_fields and "stripe_refund_id" in update_fields:
                raise RuntimeError("db exploded while recording the refund")
            return original_save(self_order, *args, **kwargs)

        with patch.object(Order, "save", flaky_save):
            msgs = self._run(self.admin.issue_stripe_refund, order)

        mock_refund.assert_called_once()
        self.assertEqual([lvl for lvl, _ in msgs], [messages.ERROR])
        self.assertIn("1 Stripe refund(s) failed.", msgs[0][1])

        order.refresh_from_db()
        # The refund happened at Stripe, but recording it failed, so the
        # order is left showing "initiating" rather than silently reverting
        # to "no refund" — it stays discoverable by reconciling against
        # Stripe.
        self.assertEqual(order.return_status, "received")
        self.assertEqual(order.refund_status, "initiating")
        self.assertEqual(order.stripe_refund_id, "")

    def test_issue_stripe_refund_calls_stripe_outside_the_actions_own_atomic_block(self):
        order = self._order_with_item(return_status="received")

        baseline_depth = len(connection.savepoint_ids)
        observed_depth = {}

        def fake_refund_create(**kwargs):
            observed_depth["value"] = len(connection.savepoint_ids)
            return {"id": "re_admin_depth_check", "status": "pending"}

        with patch("orders.admin.stripe.Refund.create", side_effect=fake_refund_create):
            self._run(self.admin.issue_stripe_refund, order)

        # Phase 1's `transaction.atomic()` has already been left by the
        # time Stripe is called, so the Stripe call runs at the same
        # savepoint depth as before the action ran — not nested one deeper
        # inside that transaction.
        self.assertEqual(observed_depth["value"], baseline_depth)
