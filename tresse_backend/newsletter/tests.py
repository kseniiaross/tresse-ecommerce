# tresse_backend/newsletter/tests.py
from unittest.mock import MagicMock, patch

from django.core import signing
from django.db import IntegrityError
from django.template.loader import render_to_string
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from newsletter.models import NewsletterSubscriber
from newsletter.tokens import build_unsubscribe_url, make_unsubscribe_token


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
        self.assertFalse(resp.data["email_sent"])
        mock_render.assert_not_called()
        mock_email_cls.assert_not_called()

    @patch("newsletter.views.EmailMultiAlternatives")
    @patch("newsletter.views.render_to_string", return_value="mocked content")
    def test_second_post_for_active_subscriber_does_not_send_email(
        self, mock_render, mock_email_cls
    ):
        mock_msg = MagicMock()
        mock_email_cls.return_value = mock_msg

        first = self.client.post(self.url, {"email": "twice@example.com", "source": "footer"})
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertTrue(first.data["email_sent"])
        mock_msg.send.assert_called_once()

        mock_email_cls.reset_mock()
        mock_render.reset_mock()

        second = self.client.post(self.url, {"email": "twice@example.com", "source": "footer"})
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertFalse(second.data["created"])
        self.assertFalse(second.data["email_sent"])
        mock_render.assert_not_called()
        mock_email_cls.assert_not_called()

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


class UnsubscribeAPITestCase(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _url(self, token):
        return reverse("newsletter_unsubscribe", args=[token])

    def test_valid_token_deactivates_subscriber(self):
        sub = NewsletterSubscriber.objects.create(email="active@example.com", is_active=True)
        token = make_unsubscribe_token(sub.email)

        resp = self.client.post(self._url(token))

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        sub.refresh_from_db()
        self.assertFalse(sub.is_active)

    def test_tampered_token_does_not_deactivate(self):
        sub = NewsletterSubscriber.objects.create(email="active2@example.com", is_active=True)
        token = make_unsubscribe_token(sub.email)
        tampered = token[:-1] + ("a" if token[-1] != "a" else "b")

        resp = self.client.post(self._url(tampered))

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", resp.data)
        sub.refresh_from_db()
        self.assertTrue(sub.is_active)

    def test_expired_token_returns_400(self):
        sub = NewsletterSubscriber.objects.create(email="expired@example.com", is_active=True)
        with patch("newsletter.tokens.UNSUBSCRIBE_TOKEN_MAX_AGE", -1):
            token = signing.dumps(sub.email, salt="newsletter.unsubscribe")
            resp = self.client.post(self._url(token))

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        sub.refresh_from_db()
        self.assertTrue(sub.is_active)

    def test_already_inactive_subscriber_stays_inactive_without_error(self):
        sub = NewsletterSubscriber.objects.create(email="inactive@example.com", is_active=False)
        token = make_unsubscribe_token(sub.email)

        resp = self.client.post(self._url(token))

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        sub.refresh_from_db()
        self.assertFalse(sub.is_active)

    def test_unknown_email_token_returns_400(self):
        token = make_unsubscribe_token("nosuchsubscriber@example.com")

        resp = self.client.post(self._url(token))

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_build_unsubscribe_url_points_to_frontend_route(self):
        url = build_unsubscribe_url("someone@example.com")
        token = make_unsubscribe_token("someone@example.com")
        # Tokens embed a timestamp, so compare structure rather than the
        # exact token string.
        self.assertTrue(url.startswith("http"))
        self.assertIn("/newsletter/unsubscribe/", url)
        self.assertEqual(
            signing.loads(url.rsplit("/", 2)[-2], salt="newsletter.unsubscribe"),
            signing.loads(token, salt="newsletter.unsubscribe"),
        )


class NewsletterWelcomeTemplateRenderTestCase(TestCase):
    """Renders the real templates (no render_to_string mock) with the exact
    context newsletter/views.py builds, to catch missing-variable bugs that
    a mocked render would hide."""

    def _context(self):
        return {
            "email": "new@example.com",
            "source": "footer",
            "brand": "TRESSE",
            "unsubscribe_url": build_unsubscribe_url("new@example.com"),
        }

    def test_txt_template_has_no_missing_substitutions(self):
        text_body = render_to_string("emails/accounts/newsletter_welcome.txt", self._context())
        self.assertNotIn("Hi ,", text_body)
        self.assertNotIn("{{", text_body)
        self.assertNotIn("}}", text_body)

    def test_html_template_has_no_missing_substitutions(self):
        html_body = render_to_string("emails/accounts/newsletter_welcome.html", self._context())
        self.assertNotIn("Hi ,", html_body)
        self.assertNotIn("{{", html_body)
        self.assertNotIn("}}", html_body)

    def test_txt_template_contains_unsubscribe_link(self):
        ctx = self._context()
        text_body = render_to_string("emails/accounts/newsletter_welcome.txt", ctx)
        self.assertIn(ctx["unsubscribe_url"], text_body)

    def test_html_template_contains_unsubscribe_link(self):
        ctx = self._context()
        html_body = render_to_string("emails/accounts/newsletter_welcome.html", ctx)
        self.assertIn(ctx["unsubscribe_url"], html_body)
