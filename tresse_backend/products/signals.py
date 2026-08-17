from __future__ import annotations

from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from .emails import send_back_in_stock_email
from .models import ProductSize, StockSubscription


@receiver(post_save, sender=ProductSize)
def notify_when_back_in_stock(sender, instance: ProductSize, **kwargs):
    product = instance.product

    if instance.quantity <= 0:
        return

    subscriptions = StockSubscription.objects.filter(
        product=product,
        notified_at__isnull=True,
    )

    if not subscriptions.exists():
        return

    product_url = f"https://www.tresseknitting.com/product/{product.id}"

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

        except Exception as exc:
            print("RESTOCK EMAIL ERROR:", exc)
