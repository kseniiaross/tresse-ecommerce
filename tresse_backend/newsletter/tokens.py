# newsletter/tokens.py
"""Signed tokens for one-click newsletter unsubscribe links.

The token encodes the subscriber's email using django.core.signing (not a
raw id or email) so a third party can't unsubscribe someone else just by
guessing or enumerating identifiers.
"""
from __future__ import annotations

from django.conf import settings
from django.core import signing

UNSUBSCRIBE_SALT = "newsletter.unsubscribe"

# How long an unsubscribe link stays valid. Generous by default since these
# links live in emails people may not open right away.
UNSUBSCRIBE_TOKEN_MAX_AGE = getattr(
    settings, "NEWSLETTER_UNSUBSCRIBE_TOKEN_MAX_AGE", 60 * 60 * 24 * 30
)


def make_unsubscribe_token(email: str) -> str:
    return signing.dumps(email.lower().strip(), salt=UNSUBSCRIBE_SALT)


def read_unsubscribe_token(token: str) -> str:
    """Returns the email encoded in the token.

    Raises django.core.signing.SignatureExpired if the token is valid but
    past UNSUBSCRIBE_TOKEN_MAX_AGE, or django.core.signing.BadSignature if
    it was tampered with or is otherwise malformed.
    """
    return signing.loads(token, salt=UNSUBSCRIBE_SALT, max_age=UNSUBSCRIBE_TOKEN_MAX_AGE)


def build_unsubscribe_url(email: str) -> str:
    token = make_unsubscribe_token(email)
    return f"{settings.FRONTEND_URL.rstrip('/')}/newsletter/unsubscribe/{token}/"
