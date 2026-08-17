from __future__ import annotations

import hashlib
import logging
from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal

import stripe
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from rest_framework import permissions, status
from rest_framework.decorators import (
    api_view,
    permission_classes,
)
from rest_framework.response import Response

from products.models import Cart, CartItem

from .emails import send_order_confirmation_email
from .models import Order, OrderItem

logger = logging.getLogger(__name__)

stripe.api_key = settings.STRIPE_SECRET_KEY

User = get_user_model()


WELCOME_PROMO_CODE = "TRESSE15"
POLICY_VERSION = "2026-06"
CUSTOM_SIZE_LABEL = "CUSTOM SIZE"


def _normalize_size_label(
    value: str | None,
) -> str:
    return " ".join(str(value or "").strip().upper().split())


def _safe_decimal(
    value: object,
) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except (
        TypeError,
        ValueError,
        ArithmeticError,
    ):
        return Decimal("0")


def _cart_has_custom_size(
    items: Iterable[CartItem],
) -> bool:
    return any(
        _normalize_size_label(
            getattr(
                getattr(
                    item.product_size,
                    "size",
                    None,
                ),
                "name",
                "",
            )
        )
        == CUSTOM_SIZE_LABEL
        for item in items
    )


def _cart_has_custom_length(
    items: Iterable[CartItem],
) -> bool:
    return any(
        bool(
            getattr(
                item,
                "custom_length_selected",
                False,
            )
        )
        for item in items
    )


def _metadata_is_true(
    value: object,
) -> bool:
    return str(value or "").strip().lower() == "true"


def _money_to_cents(
    amount: Decimal,
) -> int:
    cents = (amount * Decimal("100")).quantize(
        Decimal("1"),
        rounding=ROUND_HALF_UP,
    )

    return int(cents)


def _cents_to_money(
    cents: int,
) -> Decimal:
    return (Decimal(cents) / Decimal("100")).quantize(Decimal("0.01"))


def _item_unit_price(
    item: CartItem,
) -> Decimal:
    product_price = _safe_decimal(item.product_size.product.price)

    if not getattr(
        item,
        "custom_length_selected",
        False,
    ):
        return product_price

    surcharge = _safe_decimal(
        getattr(
            item,
            "custom_length_surcharge",
            "0",
        )
    )

    return product_price + surcharge


def _build_cart_signature(
    items: Iterable[CartItem],
) -> str:
    parts = []

    for item in items:
        parts.append(
            "|".join(
                [
                    str(item.product_size_id),
                    str(item.quantity),
                    str(
                        getattr(
                            item,
                            "custom_bust",
                            "",
                        )
                        or ""
                    ),
                    str(
                        getattr(
                            item,
                            "custom_underbust",
                            "",
                        )
                        or ""
                    ),
                    str(
                        getattr(
                            item,
                            "custom_waist",
                            "",
                        )
                        or ""
                    ),
                    str(
                        getattr(
                            item,
                            "custom_hips",
                            "",
                        )
                        or ""
                    ),
                    str(
                        getattr(
                            item,
                            "custom_height",
                            "",
                        )
                        or ""
                    ),
                    str(
                        getattr(
                            item,
                            "custom_cup",
                            "",
                        )
                        or ""
                    ),
                    str(
                        getattr(
                            item,
                            "custom_fit_notes",
                            "",
                        )
                        or ""
                    ),
                    str(
                        bool(
                            getattr(
                                item,
                                "custom_length_selected",
                                False,
                            )
                        )
                    ),
                    str(
                        getattr(
                            item,
                            "custom_length_cm",
                            "",
                        )
                        or ""
                    ),
                    str(
                        getattr(
                            item,
                            "custom_length_surcharge",
                            "0",
                        )
                        or "0"
                    ),
                ]
            )
        )

    raw = "||".join(sorted(parts))

    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _build_items_payload(
    order: Order,
) -> list[dict]:
    payload = []

    for item in order.items.all():
        payload.append(
            {
                "product_name": (item.product.name if item.product_id else ""),
                "quantity": (item.quantity),
                "size": (item.size),
                "unit_price": (item.unit_price),
                "custom_bust": (item.custom_bust),
                "custom_underbust": (item.custom_underbust),
                "custom_waist": (item.custom_waist),
                "custom_hips": (item.custom_hips),
                "custom_height": (item.custom_height),
                "custom_cup": (item.custom_cup),
                "custom_fit_notes": (item.custom_fit_notes),
                "custom_length_selected": (item.custom_length_selected),
                "custom_length_cm": (item.custom_length_cm),
                "custom_length_surcharge": (item.custom_length_surcharge),
            }
        )

    return payload


def _user_has_paid_order(
    user,
) -> bool:
    return Order.objects.filter(
        user=user,
        status="paid",
    ).exists()


def _extract_card_details_from_payment_intent(
    payment_intent_id: str,
) -> tuple[str, str]:
    card_brand = ""
    card_last4 = ""

    if not payment_intent_id:
        return (
            card_brand,
            card_last4,
        )

    try:
        intent = stripe.PaymentIntent.retrieve(
            payment_intent_id,
            expand=[
                "latest_charge",
            ],
        )

        latest_charge = intent.get("latest_charge")

        if isinstance(
            latest_charge,
            dict,
        ):
            payment_details = latest_charge.get("payment_method_details") or {}

            card = payment_details.get("card") or {}

            card_brand = str(card.get("brand") or "").strip()

            card_last4 = str(card.get("last4") or "").strip()

    except Exception:
        logger.exception(
            "stripe_card_details_extract_failed payment_intent_id=%s",
            payment_intent_id,
        )

    return (
        card_brand,
        card_last4,
    )


def _sync_refund_event(
    refund: dict,
) -> None:
    refund_id = str(refund.get("id") or "").strip()

    refund_status = str(refund.get("status") or "").strip()

    if not refund_id:
        logger.warning("refund_event_missing_id")
        return

    try:
        with transaction.atomic():
            order = Order.objects.select_for_update().filter(stripe_refund_id=(refund_id)).first()

            if not order:
                logger.warning(
                    "refund_order_not_found refund_id=%s",
                    refund_id,
                )
                return

            order.refund_status = refund_status

            update_fields = [
                "refund_status",
            ]

            if refund_status == "succeeded" and order.return_status == "refund_pending":
                order.return_status = "refunded"

                order.return_refunded_at = timezone.now()

                update_fields.extend(
                    [
                        "return_status",
                        "return_refunded_at",
                    ]
                )

            order.save(update_fields=(update_fields))

    except Exception:
        logger.exception(
            "refund_event_sync_failed refund_id=%s",
            refund_id,
        )

        raise


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def create_checkout_session(
    request,
):
    cart, _ = Cart.objects.get_or_create(user=request.user)

    items = list(
        CartItem.objects.filter(cart=cart).select_related(
            "product_size__product",
            "product_size__size",
        )
    )

    if not items:
        return Response(
            {"detail": ("Cart is empty")},
            status=(status.HTTP_400_BAD_REQUEST),
        )

    # -------------------------------------------------------------------------
    # POLICY CONSENT
    # -------------------------------------------------------------------------

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
            status=(status.HTTP_400_BAD_REQUEST),
        )

    has_custom_size = _cart_has_custom_size(items)

    has_custom_length = _cart_has_custom_length(items)

    if (has_custom_size or has_custom_length) and not (custom_size_final_sale_acknowledged):
        return Response(
            {
                "detail": (
                    "You must separately "
                    "acknowledge that custom "
                    "items are final sale before "
                    "continuing to payment."
                )
            },
            status=(status.HTTP_400_BAD_REQUEST),
        )

    # -------------------------------------------------------------------------
    # BUILD STRIPE LINE ITEMS
    # -------------------------------------------------------------------------

    line_items = []

    for item in items:
        product_size = item.product_size

        product = product_size.product

        size_name = getattr(
            product_size.size,
            "name",
            "",
        )

        if product_size.quantity < item.quantity:
            return Response(
                {"detail": (f"Not enough stock for {product.name} / {size_name}.")},
                status=(status.HTTP_400_BAD_REQUEST),
            )

        unit_price = _item_unit_price(item)

        unit_amount = _money_to_cents(unit_price)

        first_image = product.images.order_by(
            "sort_order",
            "id",
        ).first()

        image_url = ""

        if first_image and first_image.image:
            image_url = request.build_absolute_uri(first_image.image.url)

        description_parts = [f"Size: {size_name}"]

        if getattr(
            item,
            "custom_length_selected",
            False,
        ):
            custom_length_cm = getattr(
                item,
                "custom_length_cm",
                None,
            )

            if custom_length_cm is not None:
                description_parts.append(f"Custom length: {custom_length_cm} cm")
            else:
                description_parts.append("Custom length selected")

        line_items.append(
            {
                "price_data": {
                    "currency": "usd",
                    "product_data": {
                        "name": (product.name),
                        "description": (" / ".join(description_parts)),
                        "images": ([image_url] if image_url else []),
                        "metadata": {
                            "product_id": str(product.id),
                            "product_size_id": str(product_size.id),
                            "size": (size_name),
                            "custom_length_selected": (
                                "true"
                                if getattr(
                                    item,
                                    "custom_length_selected",
                                    False,
                                )
                                else "false"
                            ),
                            "custom_length_cm": str(
                                getattr(
                                    item,
                                    "custom_length_cm",
                                    "",
                                )
                                or ""
                            ),
                            "custom_length_surcharge": str(
                                getattr(
                                    item,
                                    "custom_length_surcharge",
                                    "0",
                                )
                                or "0"
                            ),
                        },
                    },
                    "unit_amount": (unit_amount),
                },
                "quantity": (item.quantity),
            }
        )

    frontend_url = getattr(
        settings,
        "FRONTEND_URL",
        "https://www.tresseknitting.com",
    )

    cart_sig = _build_cart_signature(items)

    has_paid_order = _user_has_paid_order(request.user)

    # -------------------------------------------------------------------------
    # CREATE STRIPE CHECKOUT SESSION
    # -------------------------------------------------------------------------

    session_kwargs = {
        "mode": "payment",
        "line_items": (line_items),
        "customer_email": (
            getattr(
                request.user,
                "email",
                "",
            )
            or None
        ),
        "automatic_tax": {
            "enabled": True,
        },
        "billing_address_collection": ("required"),
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
        "cancel_url": (f"{frontend_url}/order"),
        "metadata": {
            "user_id": str(request.user.id),
            "cart_id": str(cart.id),
            "cart_sig": (cart_sig),
            "is_first_order": ("true" if not has_paid_order else "false"),
            "welcome_code": (WELCOME_PROMO_CODE if not has_paid_order else ""),
            "policy_accepted": ("true"),
            "policy_version": (POLICY_VERSION),
            "custom_size_final_sale_acknowledged": (
                "true"
                if (
                    (has_custom_size or has_custom_length) and (custom_size_final_sale_acknowledged)
                )
                else "false"
            ),
        },
    }

    try:
        session = stripe.checkout.Session.create(**session_kwargs)

        return Response(
            {"url": (session.url)},
            status=(status.HTTP_200_OK),
        )

    except stripe.error.StripeError:
        logger.exception(
            "stripe_checkout_session_create_failed user_id=%s cart_id=%s",
            request.user.id,
            cart.id,
        )

        return Response(
            {"detail": ("Checkout could not be prepared.")},
            status=(status.HTTP_400_BAD_REQUEST),
        )


@csrf_exempt
@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def stripe_webhook(
    request,
):
    payload = request.body

    sig_header = request.META.get("HTTP_STRIPE_SIGNATURE")

    webhook_secret = settings.STRIPE_WEBHOOK_SECRET

    if not webhook_secret:
        return Response(
            {"detail": ("Webhook secret not set")},
            status=(status.HTTP_500_INTERNAL_SERVER_ERROR),
        )

    # -------------------------------------------------------------------------
    # VERIFY STRIPE SIGNATURE
    # -------------------------------------------------------------------------

    try:
        event = stripe.Webhook.construct_event(
            payload,
            sig_header,
            webhook_secret,
        )

    except Exception:
        logger.warning("stripe_webhook_invalid_signature")

        return Response(
            {"detail": ("Invalid webhook")},
            status=(status.HTTP_400_BAD_REQUEST),
        )

    event_type = str(event.get("type") or "").strip()

    # -------------------------------------------------------------------------
    # REFUND STATUS SYNC
    # -------------------------------------------------------------------------

    if event_type in {
        "refund.created",
        "refund.updated",
        "refund.failed",
    }:
        refund = event.get(
            "data",
            {},
        ).get(
            "object",
            {},
        )

        try:
            _sync_refund_event(refund)

        except Exception:
            return Response(
                {"detail": ("Refund event processing failed")},
                status=(status.HTTP_500_INTERNAL_SERVER_ERROR),
            )

        return Response(
            {"ok": True},
            status=(status.HTTP_200_OK),
        )

    # -------------------------------------------------------------------------
    # IGNORE OTHER EVENTS
    # -------------------------------------------------------------------------

    if event_type != "checkout.session.completed":
        return Response(
            {"ok": True},
            status=(status.HTTP_200_OK),
        )

    # -------------------------------------------------------------------------
    # CHECKOUT COMPLETED
    # -------------------------------------------------------------------------

    session = event.get(
        "data",
        {},
    ).get(
        "object",
        {},
    )

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

        return Response(
            {"ok": True},
            status=(status.HTTP_200_OK),
        )

    # -------------------------------------------------------------------------
    # USER
    # -------------------------------------------------------------------------

    try:
        user = User.objects.get(id=user_id)

    except User.DoesNotExist:
        logger.error(
            "checkout_user_not_found user_id=%s session_id=%s",
            user_id,
            session_id,
        )

        return Response(
            {"ok": True},
            status=(status.HTTP_200_OK),
        )

    # -------------------------------------------------------------------------
    # CART
    # -------------------------------------------------------------------------

    cart = Cart.objects.filter(
        id=cart_id,
        user=user,
    ).first()

    if not cart:
        logger.error(
            "checkout_cart_not_found cart_id=%s user_id=%s",
            cart_id,
            user_id,
        )

        return Response(
            {"ok": True},
            status=(status.HTTP_200_OK),
        )

    cart_items = list(
        CartItem.objects.filter(cart=cart).select_related(
            "product_size__product",
            "product_size__size",
        )
    )

    if not cart_items:
        return Response(
            {"ok": True},
            status=(status.HTTP_200_OK),
        )

    has_custom_size = _cart_has_custom_size(cart_items)

    has_custom_length = _cart_has_custom_length(cart_items)

    # -------------------------------------------------------------------------
    # VERIFY POLICY CONSENT
    # -------------------------------------------------------------------------

    if not policy_accepted or not policy_version:
        logger.error(
            "checkout_policy_consent_missing session_id=%s user_id=%s",
            session_id,
            user_id,
        )

        return Response(
            {"ok": True},
            status=(status.HTTP_200_OK),
        )

    if (has_custom_size or has_custom_length) and not (custom_size_final_sale_acknowledged):
        logger.error(
            "checkout_custom_ack_missing session_id=%s user_id=%s",
            session_id,
            user_id,
        )

        return Response(
            {"ok": True},
            status=(status.HTTP_200_OK),
        )

    # -------------------------------------------------------------------------
    # VERIFY CART SNAPSHOT
    # -------------------------------------------------------------------------

    current_cart_sig = _build_cart_signature(cart_items)

    if expected_cart_sig and current_cart_sig != expected_cart_sig:
        logger.error(
            "checkout_cart_signature_mismatch cart_id=%s expected=%s current=%s",
            cart_id,
            expected_cart_sig,
            current_cart_sig,
        )

        return Response(
            {"ok": True},
            status=(status.HTTP_200_OK),
        )

    # -------------------------------------------------------------------------
    # IDEMPOTENT ORDER CHECK
    # -------------------------------------------------------------------------

    existing = Order.objects.filter(
        user=user,
        stripe_payment_intent=(payment_intent_id),
    ).first()

    if existing:
        return Response(
            {"ok": True},
            status=(status.HTTP_200_OK),
        )

    # -------------------------------------------------------------------------
    # CUSTOMER DETAILS
    # -------------------------------------------------------------------------

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

    # -------------------------------------------------------------------------
    # PAYMENT AMOUNTS
    # -------------------------------------------------------------------------

    amount_total = int(session.get("amount_total") or 0)

    total_amount = _cents_to_money(amount_total)

    amount_subtotal = int(session.get("amount_subtotal") or 0)

    subtotal_amount = _cents_to_money(amount_subtotal)

    total_details = session.get("total_details") or {}

    amount_discount = int(total_details.get("amount_discount") or 0)

    discount_amount = _cents_to_money(amount_discount)

    amount_tax = int(total_details.get("amount_tax") or 0)

    tax_amount = _cents_to_money(amount_tax)

    (
        card_brand,
        card_last4,
    ) = _extract_card_details_from_payment_intent(payment_intent_id)

    # -------------------------------------------------------------------------
    # CREATE ORDER
    # -------------------------------------------------------------------------

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

                    return Response(
                        {"ok": True},
                        status=(status.HTTP_200_OK),
                    )

                locked_items.append(
                    (
                        cart_item,
                        locked_product_size,
                    )
                )

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
                subtotal_amount=(subtotal_amount),
                discount_code=(
                    metadata.get(
                        "welcome_code",
                        "",
                    )
                ),
                discount_amount=(discount_amount),
                tax_amount=(tax_amount),
                total_amount=(total_amount),
                stripe_checkout_id=(session_id),
                stripe_payment_intent=(payment_intent_id),
                card_brand=(card_brand),
                card_last4=(card_last4),
                policy_accepted=(policy_accepted),
                policy_version=(policy_version),
                policy_accepted_at=(timezone.now()),
                custom_size_final_sale_acknowledged=(custom_size_final_sale_acknowledged),
            )

            for (
                cart_item,
                product_size,
            ) in locked_items:
                product = product_size.product

                size_name = getattr(
                    product_size.size,
                    "name",
                    "",
                )

                unit_price = _item_unit_price(cart_item)

                OrderItem.objects.create(
                    order=order,
                    product=product,
                    product_size=(product_size),
                    size=(size_name),
                    quantity=(cart_item.quantity),
                    unit_price=(unit_price),
                    return_policy=(product.return_policy),
                    custom_bust=(cart_item.custom_bust),
                    custom_underbust=(cart_item.custom_underbust),
                    custom_waist=(cart_item.custom_waist),
                    custom_hips=(cart_item.custom_hips),
                    custom_height=(cart_item.custom_height),
                    custom_cup=(cart_item.custom_cup),
                    custom_fit_notes=(cart_item.custom_fit_notes),
                    custom_length_selected=(cart_item.custom_length_selected),
                    custom_length_cm=(cart_item.custom_length_cm),
                    custom_length_surcharge=(cart_item.custom_length_surcharge),
                )

                product_size.quantity -= cart_item.quantity

                product_size.save(update_fields=["quantity"])

            CartItem.objects.filter(cart=cart).delete()

            def _send_email_after_commit(
                order_id: int,
            ) -> None:
                try:
                    fresh = (
                        Order.objects.select_related("user")
                        .prefetch_related(
                            "items",
                            "items__product",
                        )
                        .get(id=order_id)
                    )

                    send_order_confirmation_email(
                        order=fresh,
                        items=(_build_items_payload(fresh)),
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
            {"detail": ("Order creation failed")},
            status=(status.HTTP_500_INTERNAL_SERVER_ERROR),
        )

    return Response(
        {"ok": True},
        status=(status.HTTP_200_OK),
    )
