from .settings import *  # noqa: F401, F403

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
