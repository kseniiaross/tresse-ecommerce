# tresse_backend/orders/tests.py
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.template.loader import render_to_string
from django.test import Client, TestCase
from django.urls import reverse

from orders.models import Order
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

    @patch("orders.views_stripe._extract_card_details_from_payment_intent", return_value=("", ""))
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

    def test_insufficient_stock_does_not_create_order(self):
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
