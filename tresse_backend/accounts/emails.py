from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)
User = get_user_model()


def _from_email() -> str:
    return getattr(settings, "DEFAULT_FROM_EMAIL", "") or getattr(settings, "EMAIL_HOST_USER", "")


def send_account_welcome_email(user_id: int) -> None:
    try:
        user = User.objects.only("id", "email", "first_name", "last_name").get(id=user_id)
        to_email = (user.email or "").strip()
        if not to_email:
            return

        subject = "Welcome to TRESSE"
        display_name = (f"{user.first_name} {user.last_name}").strip() or to_email

        message = render_to_string(
            "emails/accounts/welcome.txt",
            {
                "name": display_name,
                "frontend_url": settings.FRONTEND_URL.rstrip("/"),
                "support_email": getattr(settings, "SUPPORT_EMAIL", ""),
            },
        )

        send_mail(subject, message, _from_email(), [to_email], fail_silently=False)
    except Exception:
        logger.exception("welcome_email_failed user_id=%s", user_id)


def send_account_deleted_email(email: str, first_name: str = "", restore_url: str = "") -> None:
    """
    Deactivation email. If restore_url is provided, email will include it.
    """
    try:
        subject = "TRESSE — Account deactivated"
        body = render_to_string(
            "emails/accounts/account_deactivated.txt",
            {
                "first_name": (first_name or "").strip(),
                "support_email": getattr(settings, "SUPPORT_EMAIL", ""),
                "help_url": settings.FRONTEND_URL.rstrip("/") + "/help",
                "restore_url": restore_url,
                "restore_window_days": getattr(settings, "ACCOUNT_RESTORE_WINDOW_DAYS", 30),
            },
        )

        send_mail(subject, body, _from_email(), [email], fail_silently=False)
    except Exception:
        logger.exception("account_deleted_email_failed email=%s", email)


def send_account_restore_email(email: str, first_name: str, restore_url: str) -> None:
    try:
        subject = "TRESSE — Restore your account"
        body = render_to_string(
            "emails/accounts/account_restore.txt",
            {
                "first_name": (first_name or "").strip(),
                "restore_url": restore_url,
                "support_email": getattr(settings, "SUPPORT_EMAIL", ""),
                "help_url": settings.FRONTEND_URL.rstrip("/") + "/help",
            },
        )
        send_mail(subject, body, _from_email(), [email], fail_silently=False)
    except Exception:
        logger.exception("account_restore_email_failed email=%s", email)
