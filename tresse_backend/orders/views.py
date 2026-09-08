from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

import stripe
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .emails import (
    send_order_canceled_email,
    send_refund_initiated_email,
)
from .models import Order, OrderItem
from .serializers import OrderReadSerializer

logger = logging.getLogger(__name__)

stripe.api_key = settings.STRIPE_SECRET_KEY

CUSTOM_SIZE_LABEL = "CUSTOM SIZE"

CANCEL_WINDOW = timedelta(hours=24)
RETURN_WINDOW = timedelta(days=14)


def _safe_str(value: Any) -> str:
    return str(value or "").strip()


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
