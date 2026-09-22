import pytest
import stripe
from django.conf import settings as django_settings


@pytest.mark.django_db
def test_home_page_returns_success(client, settings):
    settings.SECURE_SSL_REDIRECT = False

    response = client.get("/")

    assert response.status_code == 200
    assert b"Welcome to the Tresse Backend API!" in response.content


def test_test_settings_never_use_live_secrets():
    # settings_test.py sets these in os.environ before settings.py is
    # imported, so python-decouple never falls through to the real .env —
    # a test run must never be able to reach Stripe's live API or the real
    # Sentry project with the developer's own secrets.
    assert not django_settings.STRIPE_SECRET_KEY.startswith("sk_live_")
    assert stripe.api_key == django_settings.STRIPE_SECRET_KEY
    assert django_settings.SENTRY_DSN == ""
