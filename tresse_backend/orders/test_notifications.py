# tresse_backend/orders/test_notifications.py
"""Owner notifications on a new order (orders/notifications.py).

The webhook tests here must fail when the on_commit hook is removed from
orders/views_stripe.py; the unit tests pin each channel's behaviour,
including that a Telegram or email failure never escapes.
"""

import json
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.core import mail
from django.test import TestCase, override_settings

from orders import tests as order_tests
from orders.models import Order, OrderItem
from orders.notifications import build_order_summary, notify_owner_new_order
from products.models import Product, ProductSize, Size

TELEGRAM_SETTINGS = {
    "TELEGRAM_BOT_TOKEN": "123:TEST",
    "TELEGRAM_CHAT_ID": "549534430",
    "OWNER_NOTIFICATION_EMAIL": "",
    "BACKEND_URL": "https://api.example.com",
}


def _make_order(*, custom=False):
    user = order_tests._make_user("owner_notify@example.com")
    size, _ = Size.objects.get_or_create(name="M")
    product = Product.objects.create(name="Cloud Sweater", price=Decimal("180.00"))
    product_size = ProductSize.objects.create(product=product, size=size, quantity=3)
    order = Order.objects.create(
        user=user,
        full_name="Anna Smith",
        email="anna@example.com",
        city="Washington",
        state="DC",
        postal_code="20001",
        total_amount=Decimal("180.00"),
        public_id="TR-TEST1",
    )
    item = OrderItem.objects.create(
        order=order,
        product=product,
        product_size=product_size,
        size="M",
        quantity=1,
        unit_price=Decimal("180.00"),
    )
    if custom:
        item.custom_bust = "92"
        item.custom_waist = "70"
        item.custom_fit_notes = "Slightly cropped please"
        item.save()
    return order


# ============================================================
# Webhook wiring
# ============================================================
class WebhookNotifiesOwnerTestCase(order_tests.StripeWebhookBaseTestCase):
    def _session(self):
        from orders.views_stripe import _build_cart_signature

        return order_tests.CheckoutSessionCompletedTestCase._build_session(
            self, _build_cart_signature([self.cart_item])
        )

    def _post_completed(self):
        event = order_tests._fake_stripe_event("checkout.session.completed", self._session())
        return self._post_event(event)

    @patch("orders.views_stripe._extract_applied_discount_code", return_value="")
    @patch(
        "orders.views_stripe._extract_card_details_from_payment_intent",
        return_value=("visa", "4242"),
    )
    @patch("orders.views_stripe.send_order_confirmation_email")
    @patch("orders.views_stripe.notify_owner_new_order")
    def test_new_order_notifies_owner_after_commit(self, mock_notify, *_):
        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            resp = self._post_completed()

        self.assertEqual(resp.status_code, 200)
        # Scheduled, not sent: nothing goes out before the transaction commits.
        mock_notify.assert_not_called()

        for callback in callbacks:
            callback()

        order = Order.objects.get(stripe_payment_intent="pi_test_123")
        mock_notify.assert_called_once_with(order.id)

    @patch("orders.views_stripe._extract_applied_discount_code", return_value="")
    @patch(
        "orders.views_stripe._extract_card_details_from_payment_intent",
        return_value=("", ""),
    )
    @patch("orders.views_stripe.send_order_confirmation_email")
    @patch("orders.views_stripe.notify_owner_new_order")
    def test_duplicate_webhook_notifies_owner_once(self, mock_notify, *_):
        with self.captureOnCommitCallbacks(execute=True):
            self._post_completed()
        with self.captureOnCommitCallbacks(execute=True):
            self._post_completed()

        mock_notify.assert_called_once()

    @patch("orders.views_stripe._extract_applied_discount_code", return_value="")
    @patch(
        "orders.views_stripe._extract_card_details_from_payment_intent",
        return_value=("", ""),
    )
    @patch("orders.views_stripe.send_order_confirmation_email")
    @patch("orders.notifications.urllib.request.urlopen", side_effect=OSError("down"))
    @override_settings(**TELEGRAM_SETTINGS)
    def test_telegram_outage_does_not_break_the_webhook(self, mock_urlopen, *_):
        with self.captureOnCommitCallbacks(execute=True):
            resp = self._post_completed()

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(Order.objects.filter(stripe_payment_intent="pi_test_123").exists())
        mock_urlopen.assert_called_once()


# ============================================================
# Message and channels
# ============================================================
@override_settings(BACKEND_URL="https://api.example.com")
class OrderSummaryTestCase(TestCase):
    def test_summary_has_order_customer_items_and_admin_link(self):
        order = _make_order()
        text = build_order_summary(order)

        self.assertIn("TR-TEST1", text)
        self.assertIn("180.00 USD", text)
        self.assertIn("anna@example.com", text)
        self.assertIn("Cloud Sweater × 1 — M", text)
        self.assertIn(f"https://api.example.com/admin/orders/order/{order.pk}/change/", text)
        self.assertNotIn("Made to order", text)

    def test_custom_measurements_are_listed_and_flagged(self):
        text = build_order_summary(_make_order(custom=True))

        self.assertIn("bust 92", text)
        self.assertIn("waist 70", text)
        self.assertIn("Slightly cropped please", text)
        self.assertIn("Made to order", text)


class ChannelsTestCase(TestCase):
    @override_settings(**TELEGRAM_SETTINGS)
    @patch("orders.notifications.urllib.request.urlopen")
    def test_telegram_message_goes_to_the_configured_chat(self, mock_urlopen):
        mock_urlopen.return_value.__enter__.return_value = MagicMock()
        order = _make_order()

        notify_owner_new_order(order.id)

        request = mock_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.telegram.org/bot123:TEST/sendMessage")
        payload = json.loads(request.data)
        self.assertEqual(payload["chat_id"], "549534430")
        self.assertIn("TR-TEST1", payload["text"])

    @override_settings(OWNER_NOTIFICATION_EMAIL="owner@example.com", TELEGRAM_BOT_TOKEN="")
    def test_owner_email_is_sent(self):
        order = _make_order()

        notify_owner_new_order(order.id)

        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["owner@example.com"])
        self.assertIn("TR-TEST1", mail.outbox[0].subject)

    @override_settings(
        OWNER_NOTIFICATION_EMAIL="owner@example.com",
        **{k: v for k, v in TELEGRAM_SETTINGS.items() if k != "OWNER_NOTIFICATION_EMAIL"},
    )
    @patch("orders.notifications.urllib.request.urlopen", side_effect=OSError("down"))
    def test_telegram_failure_does_not_stop_the_email_or_raise(self, _):
        order = _make_order()

        notify_owner_new_order(order.id)  # must not raise

        self.assertEqual(len(mail.outbox), 1)

    @override_settings(OWNER_NOTIFICATION_EMAIL="owner@example.com", TELEGRAM_BOT_TOKEN="")
    @patch("orders.notifications.EmailMessage.send", side_effect=RuntimeError("resend down"))
    def test_email_failure_does_not_raise(self, _):
        notify_owner_new_order(_make_order().id)  # must not raise

    @override_settings(OWNER_NOTIFICATION_EMAIL="", TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="")
    @patch("orders.notifications.urllib.request.urlopen")
    def test_nothing_is_sent_when_unconfigured(self, mock_urlopen):
        notify_owner_new_order(_make_order().id)

        mock_urlopen.assert_not_called()
        self.assertEqual(len(mail.outbox), 0)

    def test_missing_order_does_not_raise(self):
        notify_owner_new_order(999_999)
