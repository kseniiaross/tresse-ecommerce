# tresse_backend/newsletter/tests.py
from unittest.mock import MagicMock, patch

from django.db import IntegrityError
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from newsletter.models import NewsletterSubscriber


class NewsletterModelTestCase(TestCase):
    def test_email_is_unique(self):
        NewsletterSubscriber.objects.create(email="a@example.com")
        with self.assertRaises(IntegrityError):
            NewsletterSubscriber.objects.create(email="a@example.com")

    def test_str_returns_email(self):
        sub = NewsletterSubscriber.objects.create(email="a@example.com")
        self.assertEqual(str(sub), "a@example.com")

    def test_default_source_is_unknown(self):
        sub = NewsletterSubscriber.objects.create(email="a@example.com")
        self.assertEqual(sub.source, "unknown")

    def test_default_is_active_true(self):
        sub = NewsletterSubscriber.objects.create(email="a@example.com")
        self.assertTrue(sub.is_active)


class SubscribeAPITestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.url = reverse("newsletter_subscribe")

    def _mock_render_to_string(self, template, ctx):
        return "mocked content"

    @patch("newsletter.views.EmailMultiAlternatives")
    @patch("newsletter.views.render_to_string", return_value="mocked content")
    def test_new_subscriber_created(self, mock_render, mock_email_cls):
        mock_msg = MagicMock()
        mock_email_cls.return_value = mock_msg

        resp = self.client.post(self.url, {"email": "new@example.com", "source": "footer"})

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(resp.data["created"])
        self.assertTrue(resp.data["email_sent"])
        sub = NewsletterSubscriber.objects.get(email="new@example.com")
        self.assertEqual(sub.source, "footer")
        mock_msg.send.assert_called_once()

    @patch("newsletter.views.EmailMultiAlternatives")
    @patch("newsletter.views.render_to_string", return_value="mocked content")
    def test_email_normalized_to_lowercase(self, mock_render, mock_email_cls):
        mock_email_cls.return_value = MagicMock()

        resp = self.client.post(self.url, {"email": "  Test@Example.COM "})

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(NewsletterSubscriber.objects.filter(email="test@example.com").exists())

    @patch("newsletter.views.EmailMultiAlternatives")
    @patch("newsletter.views.render_to_string", return_value="mocked content")
    def test_resubscribing_existing_inactive_reactivates(self, mock_render, mock_email_cls):
        mock_email_cls.return_value = MagicMock()
        NewsletterSubscriber.objects.create(
            email="old@example.com",
            is_active=False,
            source="modal",
        )

        resp = self.client.post(self.url, {"email": "old@example.com", "source": "footer"})

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data["created"])
        sub = NewsletterSubscriber.objects.get(email="old@example.com")
        self.assertTrue(sub.is_active)
        self.assertEqual(sub.source, "footer")

    @patch("newsletter.views.EmailMultiAlternatives")
    @patch("newsletter.views.render_to_string", return_value="mocked content")
    def test_resubscribing_active_no_changes_returns_200(self, mock_render, mock_email_cls):
        mock_email_cls.return_value = MagicMock()
        NewsletterSubscriber.objects.create(
            email="same@example.com",
            is_active=True,
            source="footer",
        )

        resp = self.client.post(self.url, {"email": "same@example.com", "source": "footer"})

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data["created"])

    def test_invalid_email_rejected(self):
        resp = self.client.post(self.url, {"email": "not-an-email"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_email_rejected(self):
        resp = self.client.post(self.url, {})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    @patch("newsletter.views.EmailMultiAlternatives")
    @patch("newsletter.views.render_to_string", return_value="mocked content")
    def test_missing_source_defaults_to_unknown(self, mock_render, mock_email_cls):
        mock_email_cls.return_value = MagicMock()
        resp = self.client.post(self.url, {"email": "nosource@example.com"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        sub = NewsletterSubscriber.objects.get(email="nosource@example.com")
        self.assertEqual(sub.source, "unknown")

    @patch("newsletter.views.render_to_string", side_effect=Exception("template missing"))
    def test_email_send_failure_does_not_break_subscription(self, mock_render):
        """Подписка сохраняется в БД, даже если письмо не отправилось."""
        resp = self.client.post(self.url, {"email": "resilient@example.com"})

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertFalse(resp.data["email_sent"])
        self.assertTrue(NewsletterSubscriber.objects.filter(email="resilient@example.com").exists())
