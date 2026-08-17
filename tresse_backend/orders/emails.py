from __future__ import annotations

from typing import Any

from django.conf import settings
from django.core.mail import EmailMessage
from django.template.loader import render_to_string

TPL_ORDER_CONFIRMATION = "emails/orders/order_confirmation.txt"
TPL_ORDER_CANCELED = "emails/orders/order_canceled.txt"
TPL_REFUND_INITIATED = "emails/orders/refund_initiated.txt"
TPL_SHIPPING_CONFIRMATION = "emails/orders/shipping_confirmation.txt"
TPL_DELIVERED = "emails/orders/delivered.txt"


def _from_email() -> str:
    return (
        getattr(settings, "DEFAULT_FROM_EMAIL", "")
        or getattr(settings, "EMAIL_HOST_USER", "")
        or "no-reply@tresse.com"
    )


def _reply_to() -> list[str]:
    support = getattr(settings, "SUPPORT_EMAIL", "") or ""
    default_from = getattr(settings, "DEFAULT_FROM_EMAIL", "") or ""
    return [support or default_from or _from_email()]


def _support_context() -> dict[str, str]:
    support_email = getattr(settings, "SUPPORT_EMAIL", "") or ""
    frontend = getattr(settings, "FRONTEND_URL", "").rstrip("/")
    support_url = f"{frontend}/help" if frontend else ""
    return {"support_email": support_email, "support_url": support_url}


def _send_txt_email(*, subject: str, to_email: str, template: str, context: dict[str, Any]) -> None:
    body = render_to_string(template, context)

    msg = EmailMessage(
        subject=subject,
        body=body,
        from_email=_from_email(),
        to=[to_email],
        reply_to=_reply_to(),
    )
    msg.send(fail_silently=False)


def _order_label(order) -> str:
    public_id = (getattr(order, "public_id", "") or "").strip()
    return public_id or f"#{getattr(order, 'id', '')}"


def send_order_confirmation_email(*, order, items: list[dict[str, Any]]) -> None:
    to_email = (getattr(order, "email", "") or "").strip()
    if not to_email:
        return

    _send_txt_email(
        subject=f"TRESSE — Order Confirmation {_order_label(order)}",
        to_email=to_email,
        template=TPL_ORDER_CONFIRMATION,
        context={"order": order, "items": items, **_support_context()},
    )


def send_order_canceled_email(*, order, items: list[dict[str, Any]] | None = None) -> None:
    to_email = (getattr(order, "email", "") or "").strip()
    if not to_email:
        return

    _send_txt_email(
        subject=f"TRESSE — Order Canceled {_order_label(order)}",
        to_email=to_email,
        template=TPL_ORDER_CANCELED,
        context={"order": order, "items": items or [], **_support_context()},
    )


def send_refund_initiated_email(*, order) -> None:
    to_email = (getattr(order, "email", "") or "").strip()
    if not to_email:
        return

    _send_txt_email(
        subject=f"TRESSE — Refund Initiated {_order_label(order)}",
        to_email=to_email,
        template=TPL_REFUND_INITIATED,
        context={"order": order, **_support_context()},
    )


def send_shipping_confirmation_email(
    *, order, tracking_url: str = "", tracking_number: str = ""
) -> None:
    to_email = (getattr(order, "email", "") or "").strip()
    if not to_email:
        return

    _send_txt_email(
        subject=f"TRESSE — Shipping Confirmation {_order_label(order)}",
        to_email=to_email,
        template=TPL_SHIPPING_CONFIRMATION,
        context={
            "order": order,
            "tracking_url": tracking_url,
            "tracking_number": tracking_number,
            **_support_context(),
        },
    )


def send_delivered_email(*, order) -> None:
    to_email = (getattr(order, "email", "") or "").strip()
    if not to_email:
        return

    _send_txt_email(
        subject=f"TRESSE — Delivered {_order_label(order)}",
        to_email=to_email,
        template=TPL_DELIVERED,
        context={"order": order, **_support_context()},
    )
