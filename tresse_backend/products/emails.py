from __future__ import annotations

from django.conf import settings
from django.core.mail import EmailMessage
from django.template.loader import render_to_string

from .models import EmailLog, Product


def send_email_with_log(
    *,
    email_type: str,
    to_email: str,
    subject: str,
    body: str,
    product: Product | None = None,
) -> None:
    if not to_email:
        return

    msg = EmailMessage(
        subject=subject,
        body=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[to_email],
        reply_to=[getattr(settings, "SUPPORT_EMAIL", settings.DEFAULT_FROM_EMAIL)],
    )

    try:
        result = msg.send(fail_silently=False)

        EmailLog.objects.create(
            email_type=email_type,
            status="sent" if result else "failed",
            to_email=to_email,
            subject=subject,
            product=product,
            error_message="" if result else "Email backend returned 0.",
        )

    except Exception as exc:
        EmailLog.objects.create(
            email_type=email_type,
            status="failed",
            to_email=to_email,
            subject=subject,
            product=product,
            error_message=str(exc),
        )
        raise


def send_back_in_stock_email(
    *,
    to_email: str,
    product_name: str,
    product_url: str = "",
    product: Product | None = None,
) -> None:
    subject = f"TRESSE — Back in stock: {product_name}"

    body = render_to_string(
        "emails/products/back_in_stock.txt",
        {
            "product_name": product_name,
            "product_url": product_url,
            "support_email": getattr(settings, "SUPPORT_EMAIL", ""),
        },
    )

    send_email_with_log(
        email_type="back_in_stock",
        to_email=to_email,
        subject=subject,
        body=body,
        product=product,
    )


def send_cart_reminder_email(
    *,
    to_email: str,
    first_name: str = "",
    cart_count: int = 0,
    cart_url: str = "https://www.tresseknitting.com/cart",
) -> None:
    name = first_name.strip() or "there"
    subject = "TRESSE — Your pieces are waiting"

    body = (
        f"Hi {name},\n\n"
        f"You have {cart_count} item(s) waiting in your shopping bag.\n\n"
        f"Complete your order here:\n"
        f"{cart_url}\n\n"
        f"Need help?\n"
        f"Contact us at {getattr(settings, 'SUPPORT_EMAIL', '')}.\n\n"
        f"— TRESSE"
    )

    send_email_with_log(
        email_type="cart_reminder",
        to_email=to_email,
        subject=subject,
        body=body,
    )


def send_wishlist_reminder_email(
    *,
    to_email: str,
    first_name: str = "",
    wishlist_count: int = 0,
    wishlist_url: str = "https://www.tresseknitting.com/wishlist",
) -> None:
    name = first_name.strip() or "there"
    subject = "TRESSE — Your wishlist is waiting"

    body = (
        f"Hi {name},\n\n"
        f"You have {wishlist_count} saved piece(s) in your wishlist.\n\n"
        f"View your wishlist here:\n"
        f"{wishlist_url}\n\n"
        f"Need help?\n"
        f"Contact us at {getattr(settings, 'SUPPORT_EMAIL', '')}.\n\n"
        f"— TRESSE"
    )

    send_email_with_log(
        email_type="wishlist_reminder",
        to_email=to_email,
        subject=subject,
        body=body,
    )
