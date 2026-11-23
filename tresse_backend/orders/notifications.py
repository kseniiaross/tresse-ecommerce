"""Owner notifications: tell the shop owner about every new paid order.

Two independent channels, both optional:

* email to settings.OWNER_NOTIFICATION_EMAIL (sent through Resend like every
  other email in the project);
* a Telegram message to settings.TELEGRAM_CHAT_ID from the bot whose token is
  settings.TELEGRAM_BOT_TOKEN.

A channel with no configuration is skipped silently. A channel that fails is
logged (and therefore reaches Sentry) but never raises: this runs from the
Stripe webhook's on_commit hook, and the customer's order must not depend on
whether Telegram answered.
"""

from __future__ import annotations

import json
import logging
import urllib.request

from django.conf import settings
from django.core.mail import EmailMessage
from django.urls import reverse

from .models import Order, OrderItem

logger = logging.getLogger(__name__)

TELEGRAM_API_URL = "https://api.telegram.org/bot{token}/sendMessage"
TELEGRAM_TIMEOUT_SECONDS = 5
TELEGRAM_MAX_LENGTH = 4096

CUSTOM_MEASUREMENT_FIELDS = (
    ("custom_bust", "bust"),
    ("custom_underbust", "underbust"),
    ("custom_waist", "waist"),
    ("custom_hips", "hips"),
    ("custom_height", "height"),
    ("custom_cup", "cup"),
)


# ---------------------------------------------------------------------------
# Message
# ---------------------------------------------------------------------------


def _order_label(order: Order) -> str:
    public_id = (order.public_id or "").strip()
    return public_id or f"#{order.pk}"


def _admin_url(order: Order) -> str:
    path = reverse("admin:orders_order_change", args=[order.pk])
    base = (getattr(settings, "BACKEND_URL", "") or "").rstrip("/")
    return f"{base}{path}" if base else path


def _item_lines(item: OrderItem) -> tuple[list[str], bool]:
    """Return the lines describing one item and whether it is made to order."""
    line = f"• {item.product.name} × {item.quantity}"
    if item.size:
        line += f" — {item.size}"
    lines = [line]

    measurements = [
        f"{label} {value}"
        for field, label in CUSTOM_MEASUREMENT_FIELDS
        if (value := (getattr(item, field, "") or "").strip())
    ]
    is_custom = bool(measurements)
    if measurements:
        lines.append("   📏 " + ", ".join(measurements))
    if item.custom_fit_notes:
        lines.append(f"   📝 {item.custom_fit_notes.strip()}")
        is_custom = True
    if item.custom_length_selected:
        length = f"{item.custom_length_cm} cm" if item.custom_length_cm else "selected"
        lines.append(f"   ↕️ custom length: {length}")
        is_custom = True

    return lines, is_custom


def build_order_summary(order: Order) -> str:
    currency = (order.currency or "usd").upper()
    lines = [
        f"🧶 New order {_order_label(order)}",
        f"Total: {order.total_amount} {currency}",
        f"Customer: {order.full_name} <{order.email}>",
        f"Ship to: {order.city}, {order.state} {order.postal_code}".strip(),
        "",
    ]

    has_custom = False
    for item in order.items.all():
        item_lines, is_custom = _item_lines(item)
        lines.extend(item_lines)
        has_custom = has_custom or is_custom

    if has_custom:
        lines += ["", "⚠️ Made to order — check the measurements before you start."]

    lines += ["", _admin_url(order)]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------


def _send_email(order: Order, text: str) -> None:
    to_email = (getattr(settings, "OWNER_NOTIFICATION_EMAIL", "") or "").strip()
    if not to_email:
        return
    try:
        EmailMessage(
            subject=f"🧶 New order {_order_label(order)} — {order.total_amount}",
            body=text,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[to_email],
        ).send(fail_silently=False)
    except Exception:
        logger.exception("owner_order_email_failed order_id=%s", order.pk)


def _send_telegram(order: Order, text: str) -> None:
    token = (getattr(settings, "TELEGRAM_BOT_TOKEN", "") or "").strip()
    chat_id = (getattr(settings, "TELEGRAM_CHAT_ID", "") or "").strip()
    if not (token and chat_id):
        return
    try:
        request = urllib.request.Request(
            TELEGRAM_API_URL.format(token=token),
            data=json.dumps(
                {
                    "chat_id": chat_id,
                    "text": text[:TELEGRAM_MAX_LENGTH],
                    "disable_web_page_preview": True,
                }
            ).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=TELEGRAM_TIMEOUT_SECONDS):
            pass
    except Exception:
        # Never log the URL: it contains the bot token.
        logger.exception("owner_order_telegram_failed order_id=%s", order.pk)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def notify_owner_new_order(order_id: int) -> None:
    """Email and/or Telegram the owner about a new order. Never raises.

    Call it through transaction.on_commit, so nothing is sent for an order
    whose transaction rolled back.
    """
    try:
        order = Order.objects.prefetch_related("items", "items__product").get(id=order_id)
        text = build_order_summary(order)
    except Exception:
        logger.exception("owner_order_notification_build_failed order_id=%s", order_id)
        return

    _send_email(order, text)
    _send_telegram(order, text)
