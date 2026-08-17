from __future__ import annotations

import logging

import stripe
from django.conf import settings
from django.contrib import admin, messages
from django.db import transaction
from django.utils import timezone

from .models import Order, OrderItem

logger = logging.getLogger(__name__)

stripe.api_key = settings.STRIPE_SECRET_KEY


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    can_delete = False

    readonly_fields = (
        "product",
        "product_size",
        "quantity",
        "size",
        "unit_price",
        "return_policy",
        "custom_bust",
        "custom_underbust",
        "custom_waist",
        "custom_hips",
        "custom_height",
        "custom_cup",
        "custom_fit_notes",
    )

    fields = readonly_fields


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    actions = (
        "approve_return",
        "mark_return_received",
        "issue_stripe_refund",
        "reject_return",
    )

    list_display = (
        "public_id",
        "user",
        "email",
        "full_name",
        "status",
        "return_status",
        "subtotal_amount",
        "discount_code",
        "discount_amount",
        "tax_amount",
        "total_amount",
        "refund_status",
        "card_brand",
        "card_last4",
        "policy_accepted",
        "custom_size_final_sale_acknowledged",
        "delivered_at",
        "created_at",
    )

    list_filter = (
        "status",
        "return_status",
        "refund_status",
        "policy_accepted",
        "custom_size_final_sale_acknowledged",
        "discount_code",
        "card_brand",
        "created_at",
        "user",
    )

    search_fields = (
        "public_id",
        "email",
        "full_name",
        "user__email",
        "stripe_checkout_id",
        "stripe_payment_intent",
        "stripe_refund_id",
        "discount_code",
        "policy_version",
    )

    readonly_fields = (
        "public_id",
        "subtotal_amount",
        "discount_code",
        "discount_amount",
        "tax_amount",
        "total_amount",
        "stripe_checkout_id",
        "stripe_payment_intent",
        "stripe_refund_id",
        "refund_status",
        "refund_initiated_at",
        "return_status",
        "return_requested_at",
        "return_approved_at",
        "return_received_at",
        "return_refunded_at",
        "return_rejected_at",
        "policy_accepted",
        "policy_version",
        "policy_accepted_at",
        "custom_size_final_sale_acknowledged",
        "created_at",
    )

    fieldsets = (
        (
            "Order",
            {
                "fields": (
                    "public_id",
                    "user",
                    "email",
                    "full_name",
                    "status",
                )
            },
        ),
        (
            "Shipping",
            {
                "fields": (
                    "address",
                    "city",
                    "state",
                    "postal_code",
                    "country",
                    "delivered_at",
                )
            },
        ),
        (
            "Payment",
            {
                "fields": (
                    "payment_method",
                    "subtotal_amount",
                    "discount_code",
                    "discount_amount",
                    "tax_amount",
                    "total_amount",
                    "currency",
                    "card_brand",
                    "card_last4",
                    "cardholder_name",
                    "stripe_checkout_id",
                    "stripe_payment_intent",
                )
            },
        ),
        (
            "Return workflow",
            {
                "fields": (
                    "return_status",
                    "return_requested_at",
                    "return_approved_at",
                    "return_received_at",
                    "return_refunded_at",
                    "return_rejected_at",
                )
            },
        ),
        (
            "Refund",
            {
                "fields": (
                    "stripe_refund_id",
                    "refund_status",
                    "refund_initiated_at",
                )
            },
        ),
        (
            "Policy consent",
            {
                "fields": (
                    "policy_accepted",
                    "policy_version",
                    "policy_accepted_at",
                    "custom_size_final_sale_acknowledged",
                )
            },
        ),
        (
            "System",
            {"fields": ("created_at",)},
        ),
    )

    ordering = ("-created_at",)

    inlines = (OrderItemInline,)

    @admin.action(description=("Approve selected return requests"))
    def approve_return(
        self,
        request,
        queryset,
    ):
        approved = 0
        skipped = 0

        for selected_order in queryset:
            with transaction.atomic():
                order = Order.objects.select_for_update().get(pk=selected_order.pk)

                if order.return_status != "requested":
                    skipped += 1
                    continue

                has_non_returnable_item = order.items.exclude(
                    return_policy=(OrderItem.ReturnPolicy.STANDARD)
                ).exists()

                if has_non_returnable_item:
                    skipped += 1
                    continue

                has_custom_size = order.items.filter(size__iexact=("CUSTOM SIZE")).exists()

                if has_custom_size:
                    skipped += 1
                    continue

                order.return_status = "approved"
                order.return_approved_at = timezone.now()

                order.save(
                    update_fields=[
                        "return_status",
                        "return_approved_at",
                    ]
                )

                approved += 1

        if approved:
            self.message_user(
                request,
                (f"{approved} return(s) approved."),
                level=messages.SUCCESS,
            )

        if skipped:
            self.message_user(
                request,
                (f"{skipped} order(s) skipped. Only eligible requested returns can be approved."),
                level=messages.WARNING,
            )

    @admin.action(description=("Mark selected approved returns as received"))
    def mark_return_received(
        self,
        request,
        queryset,
    ):
        received = 0
        skipped = 0

        for selected_order in queryset:
            with transaction.atomic():
                order = Order.objects.select_for_update().get(pk=selected_order.pk)

                if order.return_status != "approved":
                    skipped += 1
                    continue

                order.return_status = "received"
                order.return_received_at = timezone.now()

                order.save(
                    update_fields=[
                        "return_status",
                        "return_received_at",
                    ]
                )

                received += 1

        if received:
            self.message_user(
                request,
                (f"{received} return(s) marked as received."),
                level=messages.SUCCESS,
            )

        if skipped:
            self.message_user(
                request,
                (f"{skipped} order(s) skipped. Only approved returns can be marked as received."),
                level=messages.WARNING,
            )

    @admin.action(description=("Issue Stripe refund for selected received returns"))
    def issue_stripe_refund(
        self,
        request,
        queryset,
    ):
        initiated = 0
        skipped = 0
        failed = 0

        for selected_order in queryset:
            try:
                with transaction.atomic():
                    order = Order.objects.select_for_update().get(pk=selected_order.pk)

                    if order.return_status != "received":
                        skipped += 1
                        continue

                    has_non_returnable_item = order.items.exclude(
                        return_policy=(OrderItem.ReturnPolicy.STANDARD)
                    ).exists()

                    if has_non_returnable_item:
                        skipped += 1
                        continue

                    has_custom_size = order.items.filter(size__iexact=("CUSTOM SIZE")).exists()

                    if has_custom_size:
                        skipped += 1
                        continue

                    if order.stripe_refund_id:
                        skipped += 1
                        continue

                    if not order.stripe_payment_intent:
                        logger.error(
                            "admin_return_refund_missing_payment_intent order_id=%s",
                            order.id,
                        )

                        skipped += 1
                        continue

                    idempotency_key = f"return_refund_{order.id}_{order.stripe_payment_intent}"

                    refund = stripe.Refund.create(
                        payment_intent=(order.stripe_payment_intent),
                        metadata={
                            "order_id": str(order.id),
                            "public_id": (order.public_id or ""),
                            "user_id": str(order.user_id),
                            "reason": ("approved_customer_return"),
                        },
                        idempotency_key=(idempotency_key),
                    )

                    refund_id = str(refund.get("id") or "").strip()

                    refund_status = str(refund.get("status") or "").strip()

                    if not refund_id:
                        raise ValueError("Stripe refund response did not contain an id")

                    now = timezone.now()

                    order.stripe_refund_id = refund_id

                    order.refund_status = refund_status

                    order.refund_initiated_at = now

                    update_fields = [
                        "stripe_refund_id",
                        "refund_status",
                        "refund_initiated_at",
                    ]

                    if refund_status == "succeeded":
                        order.return_status = "refunded"

                        order.return_refunded_at = now

                        update_fields.extend(
                            [
                                "return_status",
                                "return_refunded_at",
                            ]
                        )

                    else:
                        order.return_status = "refund_pending"

                        update_fields.append("return_status")

                    order.save(update_fields=(update_fields))

                    initiated += 1

            except stripe.error.StripeError:
                failed += 1

                logger.exception(
                    "admin_return_refund_failed order_id=%s",
                    selected_order.id,
                )

            except Exception:
                failed += 1

                logger.exception(
                    "admin_return_refund_unexpected order_id=%s",
                    selected_order.id,
                )

        if initiated:
            self.message_user(
                request,
                (f"{initiated} Stripe refund(s) initiated."),
                level=messages.SUCCESS,
            )

        if skipped:
            self.message_user(
                request,
                (
                    f"{skipped} order(s) skipped. "
                    "Refunds can only be issued "
                    "for eligible received returns "
                    "without an existing refund."
                ),
                level=messages.WARNING,
            )

        if failed:
            self.message_user(
                request,
                (f"{failed} Stripe refund(s) failed."),
                level=messages.ERROR,
            )

    @admin.action(description=("Reject selected return requests"))
    def reject_return(
        self,
        request,
        queryset,
    ):
        rejected = 0
        skipped = 0

        for selected_order in queryset:
            with transaction.atomic():
                order = Order.objects.select_for_update().get(pk=selected_order.pk)

                if order.return_status not in {
                    "requested",
                    "approved",
                }:
                    skipped += 1
                    continue

                order.return_status = "rejected"
                order.return_rejected_at = timezone.now()

                order.save(
                    update_fields=[
                        "return_status",
                        "return_rejected_at",
                    ]
                )

                rejected += 1

        if rejected:
            self.message_user(
                request,
                (f"{rejected} return(s) rejected."),
                level=messages.SUCCESS,
            )

        if skipped:
            self.message_user(
                request,
                (
                    f"{skipped} order(s) skipped. "
                    "Only requested or approved "
                    "returns can be rejected."
                ),
                level=messages.WARNING,
            )


@admin.register(OrderItem)
class OrderItemAdmin(admin.ModelAdmin):
    list_display = (
        "order",
        "product",
        "product_size",
        "quantity",
        "size",
        "unit_price",
        "return_policy",
        "custom_bust",
        "custom_waist",
        "custom_hips",
    )

    list_filter = (
        "return_policy",
        "product",
        "size",
        "order__status",
        "order__return_status",
        "order__created_at",
        "order__user",
    )

    search_fields = (
        "order__public_id",
        "product__name",
        "order__email",
        "order__user__email",
    )

    readonly_fields = (
        "order",
        "product",
        "product_size",
        "quantity",
        "size",
        "unit_price",
        "return_policy",
        "custom_bust",
        "custom_underbust",
        "custom_waist",
        "custom_hips",
        "custom_height",
        "custom_cup",
        "custom_fit_notes",
    )

    fields = readonly_fields
