from __future__ import annotations

import secrets

from django.contrib.auth import get_user_model
from django.db import models

from products.models import Product, ProductSize

User = get_user_model()


def _gen_public_id(prefix: str = "TR") -> str:
    from django.utils import timezone

    date_part = timezone.localdate().strftime("%Y%m%d")

    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    suffix = "".join(secrets.choice(alphabet) for _ in range(6))

    return f"{prefix}-{date_part}-{suffix}"


class Order(models.Model):
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="orders",
    )

    public_id = models.CharField(
        max_length=24,
        unique=True,
        db_index=True,
        blank=True,
        null=True,
    )

    # -------------------------------------------------------------------------
    # CUSTOMER / SHIPPING
    # -------------------------------------------------------------------------

    full_name = models.CharField(
        max_length=100,
    )

    address = models.CharField(
        max_length=255,
    )

    city = models.CharField(
        max_length=100,
    )

    state = models.CharField(
        max_length=100,
        blank=True,
        default="",
    )

    postal_code = models.CharField(
        max_length=20,
    )

    country = models.CharField(
        max_length=100,
    )

    email = models.EmailField(
        blank=True,
        null=True,
    )

    # -------------------------------------------------------------------------
    # PAYMENT METHOD
    # -------------------------------------------------------------------------

    payment_method = models.CharField(
        max_length=20,
        choices=[
            ("card", "Card"),
            ("paypal", "PayPal"),
        ],
        default="card",
    )

    # -------------------------------------------------------------------------
    # PAYMENT AMOUNTS
    # -------------------------------------------------------------------------

    subtotal_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
    )

    discount_code = models.CharField(
        max_length=50,
        blank=True,
        default="",
    )

    discount_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
    )

    tax_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
    )

    total_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        blank=True,
        null=True,
    )

    currency = models.CharField(
        max_length=10,
        default="usd",
    )

    # -------------------------------------------------------------------------
    # STRIPE PAYMENT
    # -------------------------------------------------------------------------

    stripe_checkout_id = models.CharField(
        max_length=255,
        blank=True,
        null=True,
    )

    stripe_payment_intent = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        unique=True,
    )

    # -------------------------------------------------------------------------
    # STRIPE REFUND
    # -------------------------------------------------------------------------

    stripe_refund_id = models.CharField(
        max_length=255,
        blank=True,
        default="",
        db_index=True,
    )

    refund_status = models.CharField(
        max_length=32,
        blank=True,
        default="",
    )

    refund_initiated_at = models.DateTimeField(
        blank=True,
        null=True,
    )

    # -------------------------------------------------------------------------
    # ORDER STATUS
    # -------------------------------------------------------------------------

    status = models.CharField(
        max_length=32,
        default="pending",
        choices=[
            ("pending", "Pending"),
            ("paid", "Paid"),
            ("canceled", "Canceled"),
        ],
    )

    # -------------------------------------------------------------------------
    # DELIVERY
    # -------------------------------------------------------------------------

    delivered_at = models.DateTimeField(
        blank=True,
        null=True,
    )

    # -------------------------------------------------------------------------
    # RETURN WORKFLOW
    # -------------------------------------------------------------------------

    return_status = models.CharField(
        max_length=32,
        blank=True,
        default="",
        choices=[
            ("", "No return"),
            ("requested", "Requested"),
            ("approved", "Approved"),
            ("received", "Received"),
            (
                "refund_pending",
                "Refund pending",
            ),
            ("refunded", "Refunded"),
            ("rejected", "Rejected"),
        ],
    )

    return_requested_at = models.DateTimeField(
        blank=True,
        null=True,
    )

    return_approved_at = models.DateTimeField(
        blank=True,
        null=True,
    )

    return_received_at = models.DateTimeField(
        blank=True,
        null=True,
    )

    return_refunded_at = models.DateTimeField(
        blank=True,
        null=True,
    )

    return_rejected_at = models.DateTimeField(
        blank=True,
        null=True,
    )

    # -------------------------------------------------------------------------
    # CARD DETAILS
    # -------------------------------------------------------------------------

    card_brand = models.CharField(
        max_length=32,
        blank=True,
        default="",
    )

    card_last4 = models.CharField(
        max_length=4,
        blank=True,
        null=True,
    )

    cardholder_name = models.CharField(
        max_length=100,
        blank=True,
        default="",
    )

    # -------------------------------------------------------------------------
    # POLICY CONSENT AUDIT TRAIL
    # -------------------------------------------------------------------------

    policy_accepted = models.BooleanField(
        default=False,
    )

    policy_version = models.CharField(
        max_length=20,
        blank=True,
        default="",
    )

    policy_accepted_at = models.DateTimeField(
        blank=True,
        null=True,
    )

    custom_size_final_sale_acknowledged = models.BooleanField(
        default=False,
    )

    # -------------------------------------------------------------------------
    # TIMESTAMPS
    # -------------------------------------------------------------------------

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    def __str__(self):
        shown = self.public_id or f"#{self.id}"

        return f"Order {shown}"

    def save(self, *args, **kwargs):
        if self.user_id and not self.email:
            self.email = self.user.email

        if self.total_amount is not None and not self.subtotal_amount:
            self.subtotal_amount = self.total_amount

        if not self.public_id:
            while True:
                candidate = _gen_public_id()

                exists = Order.objects.filter(public_id=candidate).exists()

                if not exists:
                    self.public_id = candidate
                    break

        super().save(*args, **kwargs)


class OrderItem(models.Model):
    class ReturnPolicy(models.TextChoices):
        STANDARD = (
            "standard",
            "Standard return",
        )

        FINAL_SALE = (
            "final_sale",
            "Final sale",
        )

        NON_RETURNABLE_HYGIENE = (
            "non_returnable_hygiene",
            "Non-returnable for hygiene reasons",
        )

    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name="items",
    )

    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
    )

    product_size = models.ForeignKey(
        ProductSize,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
    )

    size = models.CharField(
        max_length=50,
        blank=True,
        default="",
    )

    quantity = models.PositiveIntegerField(
        default=1,
    )

    unit_price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
    )

    custom_length_selected = models.BooleanField(
        default=False,
    )

    custom_length_cm = models.PositiveIntegerField(
        blank=True,
        null=True,
    )

    custom_length_surcharge = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
    )

    # -------------------------------------------------------------------------
    # RETURN POLICY SNAPSHOT
    # -------------------------------------------------------------------------

    return_policy = models.CharField(
        max_length=40,
        choices=ReturnPolicy.choices,
        default=ReturnPolicy.STANDARD,
        db_index=True,
        help_text=("Snapshot of the product return policy at the time of purchase."),
    )

    # -------------------------------------------------------------------------
    # CUSTOM SIZE MEASUREMENTS
    # -------------------------------------------------------------------------

    custom_bust = models.CharField(
        max_length=20,
        blank=True,
        default="",
    )

    custom_underbust = models.CharField(
        max_length=20,
        blank=True,
        default="",
    )

    custom_waist = models.CharField(
        max_length=20,
        blank=True,
        default="",
    )

    custom_hips = models.CharField(
        max_length=20,
        blank=True,
        default="",
    )

    custom_height = models.CharField(
        max_length=20,
        blank=True,
        default="",
    )

    custom_cup = models.CharField(
        max_length=40,
        blank=True,
        default="",
    )

    custom_fit_notes = models.TextField(
        blank=True,
        default="",
    )

    def __str__(self):
        return f"{self.quantity} × {self.product.name}"
