import os

# python-decouple gives environment variables precedence over .env, so
# setting these here — before settings.py is imported — keeps the real
# secrets in tresse_backend/.env (a live Stripe secret key, a real Sentry
# DSN, a live Resend API key) out of test runs entirely. settings.py reads
# these dummies instead: sentry_sdk.init() never runs (SENTRY_DSN is
# falsy), and stripe.api_key — assigned from settings.STRIPE_SECRET_KEY at
# import time in orders/views_stripe.py, orders/views.py and
# orders/admin.py — gets the dummy too.
#
# This must be an unconditional overwrite, not os.environ.setdefault():
# pytest-dotenv already loads tresse_backend/.env into os.environ before
# this module runs, so by this point the real secrets are already there
# and setdefault() would leave them untouched.
os.environ["STRIPE_SECRET_KEY"] = "sk_test_dummy"
os.environ["STRIPE_PUBLIC_KEY"] = "pk_test_dummy"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_dummy"
os.environ["RESEND_API_KEY"] = "dummy"
os.environ["SENTRY_DSN"] = ""
os.environ["RECAPTCHA_SECRET_KEY"] = "dummy"

from .settings import *  # noqa: E402, F401, F403

DEBUG = True
SECURE_SSL_REDIRECT = False
ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
FRONTEND_URL = "http://testserver"

DATABASES["default"]["NAME"] = "tresse_test"
DATABASES["default"]["HOST"] = "127.0.0.1"
DATABASES["default"]["USER"] = "postgres"
DATABASES["default"]["PASSWORD"] = "postgres"
DATABASES["default"]["PORT"] = "5432"

CORS_ALLOW_CREDENTIALS = True

# Never send real email through Resend during test runs.
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
