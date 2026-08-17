from __future__ import annotations

import hashlib
import logging
from collections.abc import Iterable
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import stripe
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView

from products.models import Cart, CartItem

from .emails import (
    send_order_canceled_email,
    send_order_confirmation_email,
    send_refund_initiated_email,
)
from .models import Order, OrderItem
from .serializers import OrderReadSerializer

logger = logging.getLogger(__name__)

stripe.api_key = settings.STRIPE_SECRET_KEY

User = get_user_model()

WELCOME_PROMO_CODE = "TRESSE15"
POLICY_VERSION = "2026-06"
CUSTOM_SIZE_LABEL = "CUSTOM SIZE"

CANCEL_WINDOW = timedelta(hours=24)
RETURN_WINDOW = timedelta(days=14)


def _safe_str(value: Any) -> str:
    return str(value or "").strip()


def _safe_decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except Exception:
        return Decimal("0")


def _normalize_size_label(value: str | None) -> str:
    return " ".join(str(value or "").strip().upper().split())


def _metadata_is_true(value: object) -> bool:
    return str(value or "").strip().lower() == "true"


def _money_to_cents(amount: Decimal) -> int:
    cents = (amount * Decimal("100")).quantize(
        Decimal("1"),
        rounding=ROUND_HALF_UP,
    )
    return int(cents)


def _cents_to_money(cents: int) -> Decimal:
    return (Decimal(cents) / Decimal("100")).quantize(Decimal("0.01"))


def _item_unit_price(item: CartItem) -> Decimal:
    product_price = _safe_decimal(item.product_size.product.price)
    surcharge = _safe_decimal(getattr(item, "custom_length_surcharge", "0"))
    return product_price + surcharge


def _cart_has_custom_size(items: Iterable[CartItem]) -> bool:
    return any(
        _normalize_size_label(getattr(getattr(item.product_size, "size", None), "name", ""))
        == CUSTOM_SIZE_LABEL
        for item in items
    )


def _cart_has_custom_length(items: Iterable[CartItem]) -> bool:
    return any(bool(getattr(item, "custom_length_selected", False)) for item in items)


def _build_cart_signature(items: Iterable[CartItem]) -> str:
    parts: list[str] = []

    for item in items:
        parts.append(
            "|".join(
                [
                    str(item.product_size_id),
                    str(item.quantity),
                    _safe_str(getattr(item, "custom_bust", "")),
                    _safe_str(getattr(item, "custom_underbust", "")),
                    _safe_str(getattr(item, "custom_waist", "")),
                    _safe_str(getattr(item, "custom_hips", "")),
                    _safe_str(getattr(item, "custom_height", "")),
                    _safe_str(getattr(item, "custom_cup", "")),
                    _safe_str(getattr(item, "custom_fit_notes", "")),
                    str(getattr(item, "custom_length_selected", False)),
                    _safe_str(getattr(item, "custom_length_cm", "")),
                    str(getattr(item, "custom_length_surcharge", "0")),
                ]
            )
        )

    raw = "||".join(sorted(parts))

    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _build_items_payload(order: Order) -> list[dict[str, Any]]:
    payload = []

    for item in order.items.all():
        payload.append(
            {
                "product_name": item.product.name if item.product_id else "",
                "quantity": item.quantity,
                "size": item.size,
                "unit_price": item.unit_price,
                "custom_bust": item.custom_bust,
                "custom_underbust": item.custom_underbust,
                "custom_waist": item.custom_waist,
                "custom_hips": item.custom_hips,
                "custom_height": item.custom_height,
                "custom_cup": item.custom_cup,
                "custom_fit_notes": item.custom_fit_notes,
                "custom_length_selected": item.custom_length_selected,
                "custom_length_cm": item.custom_length_cm,
                "custom_length_surcharge": item.custom_length_surcharge,
            }
        )

    return payload


def _user_has_paid_order(user) -> bool:
    return Order.objects.filter(user=user, status="paid").exists()


def _extract_card_details_from_payment_intent(
    payment_intent_id: str,
) -> tuple[str, str]:
    card_brand = ""
    card_last4 = ""

    if not payment_intent_id:
        return card_brand, card_last4

    try:
        intent = stripe.PaymentIntent.retrieve(
            payment_intent_id,
            expand=["latest_charge"],
        )

        latest_charge = intent.get("latest_charge")

        if isinstance(latest_charge, dict):
            payment_details = latest_charge.get("payment_method_details") or {}
            card = payment_details.get("card") or {}

            card_brand = str(card.get("brand") or "").strip()
            card_last4 = str(card.get("last4") or "").strip()

    except Exception:
        logger.exception(
            "stripe_card_details_extract_failed payment_intent_id=%s",
            payment_intent_id,
        )

    return card_brand, card_last4


def _sync_refund_event(refund: dict) -> None:
    refund_id = str(refund.get("id") or "").strip()
    refund_status = str(refund.get("status") or "").strip()

    if not refund_id:
        logger.warning("refund_event_missing_id")
        return

    with transaction.atomic():
        order = Order.objects.select_for_update().filter(stripe_refund_id=refund_id).first()

        if not order:
            logger.warning("refund_order_not_found refund_id=%s", refund_id)
            return

        order.refund_status = refund_status
        update_fields = ["refund_status"]

        if refund_status == "succeeded" and order.return_status == "refund_pending":
            order.return_status = "refunded"
            order.return_refunded_at = timezone.now()
            update_fields.extend(["return_status", "return_refunded_at"])

        order.save(update_fields=update_fields)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def create_checkout_session(request):
    cart, _ = Cart.objects.get_or_create(user=request.user)

    items = list(
        CartItem.objects.filter(cart=cart)
        .select_related(
            "product_size__product",
            "product_size__size",
        )
        .prefetch_related("product_size__product__images")
    )

    if not items:
        return Response(
            {"detail": "Cart is empty"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    policy_accepted = request.data.get("policy_accepted") is True

    custom_size_final_sale_acknowledged = (
        request.data.get("custom_size_final_sale_acknowledged") is True
    )

    if not policy_accepted:
        return Response(
            {
                "detail": (
                    "You must review and accept the Return Policy before continuing to payment."
                )
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    has_custom_size = _cart_has_custom_size(items)
    has_custom_length = _cart_has_custom_length(items)

    if (has_custom_size or has_custom_length) and not custom_size_final_sale_acknowledged:
        return Response(
            {
                "detail": (
                    "You must separately acknowledge that custom items are "
                    "final sale before continuing to payment."
                )
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    line_items = []

    for item in items:
        product_size = item.product_size
        product = product_size.product
        size_name = getattr(product_size.size, "name", "")

        if product_size.quantity < item.quantity:
            return Response(
                {"detail": (f"Not enough stock for {product.name} / {size_name}.")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        unit_price = _item_unit_price(item)
        unit_amount = _money_to_cents(unit_price)

        first_image = product.images.order_by("sort_order", "id").first()
        image_url = ""

        if first_image and first_image.image:
            image_url = request.build_absolute_uri(first_image.image.url)

        description_parts = [f"Size: {size_name}"]

        if getattr(item, "custom_length_selected", False):
            description_parts.append(f"Custom length: {item.custom_length_cm} cm")

        line_items.append(
            {
                "price_data": {
                    "currency": "usd",
                    "product_data": {
                        "name": product.name,
                        "description": " / ".join(description_parts),
                        "images": [image_url] if image_url else [],
                        "metadata": {
                            "product_id": str(product.id),
                            "product_size_id": str(product_size.id),
                            "size": size_name,
                            "custom_length_selected": str(
                                getattr(item, "custom_length_selected", False)
                            ),
                            "custom_length_cm": _safe_str(getattr(item, "custom_length_cm", "")),
                            "custom_length_surcharge": str(
                                getattr(item, "custom_length_surcharge", "0")
                            ),
                        },
                    },
                    "unit_amount": unit_amount,
                },
                "quantity": item.quantity,
            }
        )

    frontend_url = getattr(
        settings,
        "FRONTEND_URL",
        "https://www.tresseknitting.com",
    )

    cart_sig = _build_cart_signature(items)
    has_paid_order = _user_has_paid_order(request.user)

    session_kwargs = {
        "mode": "payment",
        "line_items": line_items,
        "customer_email": getattr(request.user, "email", "") or None,
        "automatic_tax": {"enabled": True},
        "billing_address_collection": "required",
        "allow_promotion_codes": True,
        "shipping_address_collection": {
            "allowed_countries": [
                "US",
                "CA",
                "GB",
                "IE",
                "DE",
                "FR",
                "IT",
                "ES",
                "PT",
                "NL",
                "BE",
                "LU",
                "AT",
                "CH",
                "SE",
                "NO",
                "DK",
                "FI",
                "PL",
                "CZ",
                "SK",
                "HU",
                "RO",
                "BG",
                "HR",
                "SI",
                "EE",
                "LV",
                "LT",
                "GR",
                "CY",
                "MT",
                "AU",
                "NZ",
                "JP",
                "SG",
                "KR",
                "AE",
                "IL",
            ]
        },
        "success_url": (f"{frontend_url}/order/success?session_id={{CHECKOUT_SESSION_ID}}"),
        "cancel_url": f"{frontend_url}/order",
        "metadata": {
            "user_id": str(request.user.id),
            "cart_id": str(cart.id),
            "cart_sig": cart_sig,
            "is_first_order": "true" if not has_paid_order else "false",
            "welcome_code": WELCOME_PROMO_CODE if not has_paid_order else "",
            "policy_accepted": "true",
            "policy_version": POLICY_VERSION,
            "custom_size_final_sale_acknowledged": (
                "true"
                if ((has_custom_size or has_custom_length) and custom_size_final_sale_acknowledged)
                else "false"
            ),
        },
    }

    try:
        session = stripe.checkout.Session.create(**session_kwargs)

        return Response(
            {"url": session.url},
            status=status.HTTP_200_OK,
        )

    except stripe.error.StripeError:
        logger.exception(
            "stripe_checkout_session_create_failed user_id=%s cart_id=%s",
            request.user.id,
            cart.id,
        )

        return Response(
            {"detail": "Checkout could not be prepared."},
            status=status.HTTP_400_BAD_REQUEST,
        )


@csrf_exempt
@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def stripe_webhook(request):
    payload = request.body
    sig_header = request.META.get("HTTP_STRIPE_SIGNATURE")
    webhook_secret = settings.STRIPE_WEBHOOK_SECRET

    if not webhook_secret:
        return Response(
            {"detail": "Webhook secret not set"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    try:
        event = stripe.Webhook.construct_event(
            payload,
            sig_header,
            webhook_secret,
        )

    except Exception:
        logger.warning("stripe_webhook_invalid_signature")
        return Response(
            {"detail": "Invalid webhook"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    event_type = str(event.get("type") or "").strip()

    if event_type in {"refund.created", "refund.updated", "refund.failed"}:
        refund = event.get("data", {}).get("object", {})

        try:
            _sync_refund_event(refund)
        except Exception:
            logger.exception("refund_event_processing_failed")
            return Response(
                {"detail": "Refund event processing failed"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({"ok": True}, status=status.HTTP_200_OK)

    if event_type != "checkout.session.completed":
        return Response({"ok": True}, status=status.HTTP_200_OK)

    session = event.get("data", {}).get("object", {})

    session_id = session.get("id")
    payment_intent_id = session.get("payment_intent")
    metadata = session.get("metadata") or {}

    user_id = metadata.get("user_id")
    cart_id = metadata.get("cart_id")
    expected_cart_sig = metadata.get("cart_sig")

    policy_accepted = _metadata_is_true(metadata.get("policy_accepted"))
    policy_version = str(metadata.get("policy_version") or "").strip()

    custom_size_final_sale_acknowledged = _metadata_is_true(
        metadata.get("custom_size_final_sale_acknowledged")
    )

    if not user_id or not cart_id or not payment_intent_id:
        logger.error(
            "checkout_session_missing_metadata session_id=%s",
            session_id,
        )
        return Response({"ok": True}, status=status.HTTP_200_OK)

    try:
        user = User.objects.get(id=user_id)

    except User.DoesNotExist:
        logger.error(
            "checkout_user_not_found user_id=%s session_id=%s",
            user_id,
            session_id,
        )
        return Response({"ok": True}, status=status.HTTP_200_OK)

    cart = Cart.objects.filter(id=cart_id, user=user).first()

    if not cart:
        logger.error(
            "checkout_cart_not_found cart_id=%s user_id=%s",
            cart_id,
            user_id,
        )
        return Response({"ok": True}, status=status.HTTP_200_OK)

    cart_items = list(
        CartItem.objects.filter(cart=cart)
        .select_related(
            "product_size__product",
            "product_size__size",
        )
        .order_by("id")
    )

    if not cart_items:
        return Response({"ok": True}, status=status.HTTP_200_OK)

    has_custom_size = _cart_has_custom_size(cart_items)
    has_custom_length = _cart_has_custom_length(cart_items)

    if not policy_accepted or not policy_version:
        logger.error(
            "checkout_policy_consent_missing session_id=%s user_id=%s",
            session_id,
            user_id,
        )
        return Response({"ok": True}, status=status.HTTP_200_OK)

    if (has_custom_size or has_custom_length) and not custom_size_final_sale_acknowledged:
        logger.error(
            "checkout_custom_ack_missing session_id=%s user_id=%s",
            session_id,
            user_id,
        )
        return Response({"ok": True}, status=status.HTTP_200_OK)

    current_cart_sig = _build_cart_signature(cart_items)

    if expected_cart_sig and current_cart_sig != expected_cart_sig:
        logger.error(
            "checkout_cart_signature_mismatch cart_id=%s expected=%s current=%s",
            cart_id,
            expected_cart_sig,
            current_cart_sig,
        )
        return Response({"ok": True}, status=status.HTTP_200_OK)

    existing = Order.objects.filter(
        user=user,
        stripe_payment_intent=payment_intent_id,
    ).first()

    if existing:
        return Response({"ok": True}, status=status.HTTP_200_OK)

    customer_details = session.get("customer_details") or {}
    address_data = customer_details.get("address") or {}

    full_name = customer_details.get("name") or (f"{user.first_name} {user.last_name}").strip()

    email = customer_details.get("email") or user.email

    line1 = address_data.get("line1") or ""
    line2 = address_data.get("line2") or ""

    address = f"{line1}, {line2}".strip(", ")
    city = address_data.get("city") or ""
    state_value = address_data.get("state") or ""
    postal_code = address_data.get("postal_code") or ""
    country = address_data.get("country") or "US"

    amount_total = int(session.get("amount_total") or 0)
    total_amount = _cents_to_money(amount_total)

    amount_subtotal = int(session.get("amount_subtotal") or 0)
    subtotal_amount = _cents_to_money(amount_subtotal)

    total_details = session.get("total_details") or {}

    amount_discount = int(total_details.get("amount_discount") or 0)
    discount_amount = _cents_to_money(amount_discount)

    amount_tax = int(total_details.get("amount_tax") or 0)
    tax_amount = _cents_to_money(amount_tax)

    card_brand, card_last4 = _extract_card_details_from_payment_intent(payment_intent_id)

    try:
        with transaction.atomic():
            locked_items = []

            for cart_item in cart_items:
                product_size = cart_item.product_size

                locked_product_size = (
                    type(product_size).objects.select_for_update().get(pk=product_size.pk)
                )

                if locked_product_size.quantity < cart_item.quantity:
                    logger.error(
                        "checkout_stock_insufficient product_size_id=%s requested=%s available=%s",
                        locked_product_size.id,
                        cart_item.quantity,
                        locked_product_size.quantity,
                    )
                    return Response({"ok": True}, status=status.HTTP_200_OK)

                locked_items.append((cart_item, locked_product_size))

            order = Order.objects.create(
                user=user,
                email=email,
                full_name=full_name,
                address=address,
                city=city,
                state=state_value,
                postal_code=postal_code,
                country=country,
                payment_method="card",
                currency="usd",
                status="paid",
                subtotal_amount=subtotal_amount,
                discount_code=metadata.get("welcome_code", ""),
                discount_amount=discount_amount,
                tax_amount=tax_amount,
                total_amount=total_amount,
                stripe_checkout_id=session_id,
                stripe_payment_intent=payment_intent_id,
                card_brand=card_brand,
                card_last4=card_last4,
                policy_accepted=policy_accepted,
                policy_version=policy_version,
                policy_accepted_at=timezone.now(),
                custom_size_final_sale_acknowledged=(custom_size_final_sale_acknowledged),
            )

            for cart_item, product_size in locked_items:
                product = product_size.product
                size_name = getattr(product_size.size, "name", "")

                unit_price = _item_unit_price(cart_item)

                OrderItem.objects.create(
                    order=order,
                    product=product,
                    product_size=product_size,
                    size=size_name,
                    quantity=cart_item.quantity,
                    unit_price=unit_price,
                    return_policy=product.return_policy,
                    custom_bust=cart_item.custom_bust,
                    custom_underbust=cart_item.custom_underbust,
                    custom_waist=cart_item.custom_waist,
                    custom_hips=cart_item.custom_hips,
                    custom_height=cart_item.custom_height,
                    custom_cup=cart_item.custom_cup,
                    custom_fit_notes=cart_item.custom_fit_notes,
                    custom_length_selected=cart_item.custom_length_selected,
                    custom_length_cm=cart_item.custom_length_cm,
                    custom_length_surcharge=cart_item.custom_length_surcharge,
                )

                product_size.quantity -= cart_item.quantity
                product_size.save(update_fields=["quantity"])

            CartItem.objects.filter(cart=cart).delete()

            def _send_email_after_commit(order_id: int) -> None:
                try:
                    fresh = (
                        Order.objects.select_related("user")
                        .prefetch_related("items", "items__product")
                        .get(id=order_id)
                    )

                    send_order_confirmation_email(
                        order=fresh,
                        items=_build_items_payload(fresh),
                    )

                except Exception:
                    logger.exception(
                        "order_confirmation_email_failed order_id=%s",
                        order_id,
                    )

            transaction.on_commit(lambda: _send_email_after_commit(order.id))

    except Exception:
        logger.exception(
            "checkout_order_creation_failed session_id=%s payment_intent_id=%s",
            session_id,
            payment_intent_id,
        )

        return Response(
            {"detail": "Order creation failed"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return Response({"ok": True}, status=status.HTTP_200_OK)


class MyOrdersAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        qs = (
            Order.objects.filter(user=request.user)
            .order_by("-created_at")
            .prefetch_related(
                "items",
                "items__product",
                "items__product_size",
                "items__product_size__product",
                "items__product_size__size",
            )
        )

        return Response(
            OrderReadSerializer(qs, many=True).data,
            status=status.HTTP_200_OK,
        )


class CancelOrderAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, order_id: int):
        try:
            with transaction.atomic():
                order = (
                    Order.objects.select_for_update().filter(id=order_id, user=request.user).first()
                )

                if not order:
                    return Response(
                        {"detail": "Order not found"},
                        status=status.HTTP_404_NOT_FOUND,
                    )

                if order.status != "paid":
                    return Response(
                        {"detail": "Only paid orders can be canceled"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if timezone.now() > order.created_at + CANCEL_WINDOW:
                    return Response(
                        {"detail": "Cancellation window has expired"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if order.return_status:
                    return Response(
                        {"detail": "This order already has a return workflow."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if order.stripe_refund_id:
                    return Response(
                        {"detail": "A refund already exists for this order"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if not order.stripe_payment_intent:
                    return Response(
                        {"detail": "This order cannot be refunded automatically."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                refund = stripe.Refund.create(
                    payment_intent=order.stripe_payment_intent,
                    metadata={
                        "order_id": str(order.id),
                        "public_id": order.public_id or "",
                        "user_id": str(request.user.id),
                        "reason": "customer_cancellation",
                    },
                    idempotency_key=(f"cancel_order_{order.id}_{order.stripe_payment_intent}"),
                )

                refund_id = _safe_str(refund.get("id"))
                refund_status = _safe_str(refund.get("status"))

                if not refund_id:
                    return Response(
                        {"detail": "Refund response was invalid."},
                        status=status.HTTP_502_BAD_GATEWAY,
                    )

                order.status = "canceled"
                order.stripe_refund_id = refund_id
                order.refund_status = refund_status
                order.refund_initiated_at = timezone.now()

                order.save(
                    update_fields=[
                        "status",
                        "stripe_refund_id",
                        "refund_status",
                        "refund_initiated_at",
                    ]
                )

                transaction.on_commit(
                    lambda: send_order_canceled_email(
                        order=order,
                        items=_build_items_payload(order),
                    )
                )

                transaction.on_commit(lambda: send_refund_initiated_email(order=order))

        except stripe.error.StripeError:
            logger.exception("stripe_cancel_refund_failed order_id=%s", order_id)
            return Response(
                {"detail": "Refund could not be initiated. Please try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        except Exception:
            logger.exception("cancel_order_transaction_failed order_id=%s", order_id)
            return Response(
                {"detail": "Unable to cancel the order."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            OrderReadSerializer(order).data,
            status=status.HTTP_200_OK,
        )


class RequestReturnAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, order_id: int):
        try:
            with transaction.atomic():
                order = (
                    Order.objects.select_for_update().filter(id=order_id, user=request.user).first()
                )

                if not order:
                    return Response(
                        {"detail": "Order not found"},
                        status=status.HTTP_404_NOT_FOUND,
                    )

                if order.status != "paid":
                    return Response(
                        {"detail": "Only paid orders can be returned"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if not order.delivered_at:
                    return Response(
                        {"detail": ("Return is not available until the order has been delivered")},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if timezone.now() > order.delivered_at + RETURN_WINDOW:
                    return Response(
                        {"detail": "Return window has expired"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if order.return_status:
                    return Response(
                        {"detail": "A return request already exists for this order"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if order.items.filter(size__iexact=CUSTOM_SIZE_LABEL).exists():
                    return Response(
                        {"detail": "Custom-sized items are final sale."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if order.items.filter(custom_length_selected=True).exists():
                    return Response(
                        {"detail": "Custom-length items are final sale."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if order.items.filter(return_policy=OrderItem.ReturnPolicy.FINAL_SALE).exists():
                    return Response(
                        {
                            "detail": (
                                "This order contains a final sale item and is "
                                "not eligible for return."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if order.items.filter(
                    return_policy=OrderItem.ReturnPolicy.NON_RETURNABLE_HYGIENE
                ).exists():
                    return Response(
                        {
                            "detail": (
                                "This order contains an item that is non-returnable "
                                "for hygiene reasons."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                order.return_status = "requested"
                order.return_requested_at = timezone.now()

                order.save(
                    update_fields=[
                        "return_status",
                        "return_requested_at",
                    ]
                )

        except Exception:
            logger.exception("return_request_failed order_id=%s", order_id)
            return Response(
                {"detail": "Unable to request a return."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            OrderReadSerializer(order).data,
            status=status.HTTP_200_OK,
        )
