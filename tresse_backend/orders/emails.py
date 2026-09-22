from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

import sentry_sdk
from django.conf import settings
from django.core.mail import EmailMessage
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)

TPL_ORDER_CONFIRMATION = "emails/orders/order_confirmation.txt"
TPL_ORDER_CANCELED = "emails/orders/order_canceled.txt"
TPL_REFUND_INITIATED = "emails/orders/refund_initiated.txt"
TPL_SHIPPING_CONFIRMATION = "emails/orders/shipping_confirmation.txt"
TPL_DELIVERED = "emails/orders/delivered.txt"
TPL_CHECKOUT_STOCK_SOLD_OUT = "emails/orders/checkout_stock_sold_out.txt"


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


def send_checkout_stock_sold_out_email(
    *, to_email: str, amount: Decimal, session_id: str = ""
) -> None:
    """Told to the customer when Stripe captured their payment but an item
    they were buying sold out before the order could be created, so the
    charge was refunded in full."""
    to_email = (to_email or "").strip()
    if not to_email:
        return

    _send_txt_email(
        subject="TRESSE — Your payment was refunded",
        to_email=to_email,
        template=TPL_CHECKOUT_STOCK_SOLD_OUT,
        context={"amount": amount, "session_id": session_id, **_support_context()},
    )


def send_checkout_webhook_alert(
    *,
    reason: str,
    session_id: str = "",
    payment_intent_id: str = "",
    amount: Decimal | None = None,
    customer_email: str = "",
) -> None:
    """Tells support and Sentry that a Stripe checkout webhook hit a branch
    where the customer's payment may have been captured but no order could
    be created (or, for a stock shortage, was deliberately abandoned).

    Must never raise and must never affect the webhook's response — every
    failure here is logged and swallowed.
    """
    try:
        sentry_sdk.capture_message(
            f"checkout_webhook_alert reason={reason} session_id={session_id or ''}",
            level="error",
            fingerprint=["checkout-webhook-alert", reason],
        )
    except Exception:
        logger.exception("checkout_webhook_alert_sentry_failed reason=%s", reason)

    support_email = (getattr(settings, "SUPPORT_EMAIL", "") or "").strip()
    if not support_email:
        return

    try:
        body = "\n".join(
            [
                "A Stripe checkout webhook hit a branch where the customer's "
                "payment may have been captured but no order was created.",
                "",
                f"Reason: {reason}",
                f"Checkout session id: {session_id or ''}",
                f"Payment intent id: {payment_intent_id or ''}",
                f"Amount: {amount if amount is not None else ''}",
                f"Customer email: {customer_email or ''}",
            ]
        )

        msg = EmailMessage(
            subject=f"[TRESSE] Checkout webhook alert: {reason}",
            body=body,
            from_email=_from_email(),
            to=[support_email],
        )
        msg.send(fail_silently=False)
    except Exception:
        logger.exception("checkout_webhook_alert_email_failed reason=%s", reason)
