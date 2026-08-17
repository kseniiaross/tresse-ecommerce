from datetime import timedelta
from pathlib import Path

import dj_database_url
import sentry_sdk
from decouple import config

BASE_DIR = Path(__file__).resolve().parent.parent

CLOUDINARY_URL = config("CLOUDINARY_URL", default="").strip()
# ------------------------------------------------------------
# Core security
# ------------------------------------------------------------
SECRET_KEY = config("SECRET_KEY")
DEBUG = config("DEBUG", default=False, cast=bool)
SENTRY_DSN = config("SENTRY_DSN", default="").strip()
SENTRY_ENVIRONMENT = config(
    "SENTRY_ENVIRONMENT",
    default="production" if not DEBUG else "local",
).strip()
SENTRY_TRACES_SAMPLE_RATE = config(
    "SENTRY_TRACES_SAMPLE_RATE",
    default=0.0,
    cast=float,
)

if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=SENTRY_ENVIRONMENT,
        traces_sample_rate=SENTRY_TRACES_SAMPLE_RATE,
        send_default_pii=False,
        shutdown_timeout=2,
    )

ALLOWED_HOSTS = [
    h.strip()
    for h in config("ALLOWED_HOSTS", default="127.0.0.1,localhost").split(",")
    if h.strip()
]

AUTH_USER_MODEL = "accounts.User"

# ------------------------------------------------------------
# Frontend / CORS / CSRF
# ------------------------------------------------------------
FRONTEND_URL = config("FRONTEND_URL").rstrip("/")

CORS_ALLOWED_ORIGINS = [
    FRONTEND_URL,
    FRONTEND_URL.replace("://www.", "://"),
    FRONTEND_URL.replace("://", "://www."),
]

CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^https:\/\/.*\.vercel\.app$",
]

CORS_ALLOW_CREDENTIALS = config("CORS_ALLOW_CREDENTIALS", default=False, cast=bool)

CSRF_TRUSTED_ORIGINS = [
    FRONTEND_URL,
    FRONTEND_URL.replace("://www.", "://"),
    FRONTEND_URL.replace("://", "://www."),
]

# ------------------------------------------------------------
# Apps
# ------------------------------------------------------------
INSTALLED_APPS = [
    "django_otp",
    "django_otp.plugins.otp_totp",
    "django_otp.plugins.otp_static",
    "two_factor",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "django_filters",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "anymail",
    "adminsortable2",
    "cloudinary",
    "cloudinary_storage",
    "accounts",
    "cart",
    "orders",
    "products.apps.ProductsConfig",
    "newsletter",
]

# ------------------------------------------------------------
# Middleware
# ------------------------------------------------------------
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django_otp.middleware.OTPMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "tresse.urls"

# ------------------------------------------------------------
# Templates (for email templates too)
# ------------------------------------------------------------
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

WSGI_APPLICATION = "tresse.wsgi.application"

# ------------------------------------------------------------
# Database
# ------------------------------------------------------------
DATABASE_URL = config("DATABASE_URL", default="", cast=str).strip()

if DATABASE_URL:
    DATABASES = {
        "default": dj_database_url.config(
            default=DATABASE_URL,
            conn_max_age=config("DB_CONN_MAX_AGE", default=60, cast=int),
            ssl_require=True,
        )
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": config("DB_NAME"),
            "USER": config("DB_USER"),
            "PASSWORD": config("DB_PASSWORD"),
            "HOST": config("DB_HOST", default="127.0.0.1"),
            "PORT": config("DB_PORT", default="5432"),
            "CONN_MAX_AGE": config("DB_CONN_MAX_AGE", default=60, cast=int),
        }
    }

# ------------------------------------------------------------
# Password validation
# ------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"
    },
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ------------------------------------------------------------
# I18N / TZ
# ------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True


STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

STORAGES = {
    "default": {
        "BACKEND": "cloudinary_storage.storage.MediaCloudinaryStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

WHITENOISE_MANIFEST_STRICT = False


DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ------------------------------------------------------------
# DRF
# ------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticatedOrReadOnly",
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        # Global
        "anon": config("THROTTLE_ANON", default="60/min"),
        "user": config("THROTTLE_USER", default="300/min"),
        # Password reset
        "password_reset_anon": config("THROTTLE_PASSWORD_RESET_ANON", default="5/min"),
        "password_reset_user": config("THROTTLE_PASSWORD_RESET_USER", default="10/min"),
        # Login brute-force
        "login_anon": config("THROTTLE_LOGIN_ANON", default="10/min"),
        "login_user": config("THROTTLE_LOGIN_USER", default="20/min"),
        # Register spam
        "register_anon": config("THROTTLE_REGISTER_ANON", default="5/min"),
        "register_user": config("THROTTLE_REGISTER_USER", default="10/min"),
        # Account restore
        "restore_anon": config("THROTTLE_RESTORE_ANON", default="5/min"),
        "restore_user": config("THROTTLE_RESTORE_USER", default="10/min"),
        # Stripe intent spam / abuse
        "stripe_intent_anon": config("THROTTLE_STRIPE_INTENT_ANON", default="5/min"),
        "stripe_intent_user": config("THROTTLE_STRIPE_INTENT_USER", default="20/min"),
        # Back-in-stock subscription spam
        "stock_subscribe_anon": config(
            "THROTTLE_STOCK_SUBSCRIBE_ANON", default="5/min"
        ),
        "stock_subscribe_user": config(
            "THROTTLE_STOCK_SUBSCRIBE_USER", default="20/min"
        ),
    },
}

# ------------------------------------------------------------
# JWT (SimpleJWT)
# ------------------------------------------------------------
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(
        minutes=config("ACCESS_TOKEN_MINUTES", default=15, cast=int)
    ),
    "REFRESH_TOKEN_LIFETIME": timedelta(
        days=config("REFRESH_TOKEN_DAYS", default=7, cast=int)
    ),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# ------------------------------------------------------------
# Email / Resend
# ------------------------------------------------------------
EMAIL_BACKEND = "anymail.backends.resend.EmailBackend"
ANYMAIL = {
    "RESEND_API_KEY": config("RESEND_API_KEY", default="").strip(),
}

DEFAULT_FROM_EMAIL = config(
    "DEFAULT_FROM_EMAIL",
    default="TRESSE <support@tresseknitting.com>",
).strip()

SUPPORT_EMAIL = config(
    "SUPPORT_EMAIL",
    default="support@tresseknitting.com",
).strip()

EMAIL_TIMEOUT = config("EMAIL_TIMEOUT", default=10, cast=int)
EMAIL_TIMEOUT = config("EMAIL_TIMEOUT", default=10, cast=int)

# ------------------------------------------------------------
# Stripe
# ------------------------------------------------------------
USE_STRIPE = config("USE_STRIPE", default=False, cast=bool)
STRIPE_PUBLIC_KEY = config("STRIPE_PUBLIC_KEY", default="")
STRIPE_SECRET_KEY = config("STRIPE_SECRET_KEY", default="")
STRIPE_WEBHOOK_SECRET = config("STRIPE_WEBHOOK_SECRET", default="")
STRIPE_FIRST_ORDER_COUPON_ID = config(
    "STRIPE_FIRST_ORDER_COUPON_ID", default=""
).strip()

# ------------------------------------------------------------
# reCAPTCHA
# ------------------------------------------------------------
RECAPTCHA_SECRET_KEY = config("RECAPTCHA_SECRET_KEY", default="")
RECAPTCHA_SITE_KEY = config("RECAPTCHA_SITE_KEY", default="")

# ------------------------------------------------------------
# Production security headers (only when DEBUG=False)
# ------------------------------------------------------------
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = True

    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

    SESSION_COOKIE_HTTPONLY = True
    CSRF_COOKIE_HTTPONLY = False

    X_FRAME_OPTIONS = "DENY"

    SECURE_HSTS_SECONDS = config("SECURE_HSTS_SECONDS", default=3600, cast=int)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = False

    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"

# ------------------------------------------------------------
# Logging (minimal, no secrets)
# ------------------------------------------------------------
LOG_LEVEL = config("LOG_LEVEL", default="INFO")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {"class": "logging.StreamHandler"},
    },
    "root": {
        "handlers": ["console"],
        "level": LOG_LEVEL,
    },
}

# Account restore window
ACCOUNT_RESTORE_WINDOW_DAYS = config(
    "ACCOUNT_RESTORE_WINDOW_DAYS", default=30, cast=int
)

LOGIN_URL = "two_factor:login"
LOGIN_REDIRECT_URL = "/admin/"
TWO_FACTOR_LOGIN_REDIRECT_URL = "/admin/"
TWO_FACTOR_PATCH_ADMIN = True
