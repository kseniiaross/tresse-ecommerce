from __future__ import annotations

import logging

from django.conf import settings
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from .emails import send_back_in_stock_email
from .models import ProductSize, StockSubscription

logger = logging.getLogger(__name__)


@receiver(post_save, sender=ProductSize)
def notify_when_back_in_stock(sender, instance: ProductSize, **kwargs):
    # Name-mangled by ProductSize.__init__/from_db, not by this function
    # (mangling only applies inside the class body that wrote it), so it
    # has to be read/written under its mangled name here.
    previous_quantity = getattr(instance, "_ProductSize__original_quantity", None)
    instance._ProductSize__original_quantity = instance.quantity

    if instance.quantity <= 0:
        return

    if previous_quantity is None or previous_quantity > 0:
        # Not a genuine restock: either there's no prior value to compare
        # against, or the quantity was already positive before this save
        # (e.g. a purchase decrementing stock, or an admin edit that
        # doesn't cross zero).
        return

    product = instance.product

    subscriptions = StockSubscription.objects.filter(
        product=product,
        notified_at__isnull=True,
    )

    if not subscriptions.exists():
        return

    product_url = f"{settings.FRONTEND_URL.rstrip('/')}/product/{product.id}"

    def _send_after_commit() -> None:
        for sub in subscriptions:
            try:
                send_back_in_stock_email(
                    to_email=sub.email,
                    product_name=product.name,
                    product_url=product_url,
                    product=product,
                )

                sub.notified_at = timezone.now()
                sub.save(update_fields=["notified_at"])

            except Exception:
                logger.exception(
                    "restock_email_failed product_id=%s subscription_id=%s",
                    product.id,
                    sub.id,
                )

    transaction.on_commit(_send_after_commit)
