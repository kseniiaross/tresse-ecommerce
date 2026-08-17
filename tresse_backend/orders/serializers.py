from rest_framework import serializers

from .models import Order, OrderItem


class OrderItemReadSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(
        source="product.name",
        read_only=True,
    )

    class Meta:
        model = OrderItem

        fields = [
            "id",
            "product_name",
            "size",
            "quantity",
            "unit_price",
            "return_policy",
            "custom_bust",
            "custom_underbust",
            "custom_waist",
            "custom_hips",
            "custom_height",
            "custom_cup",
            "custom_fit_notes",
        ]

        read_only_fields = fields


class OrderCreateSerializer(serializers.ModelSerializer):
    """
    Only shipping/contact fields.

    Client does not send:
    - items
    - subtotal
    - discount
    - tax
    - total
    - Stripe IDs
    - order status
    - return status
    """

    class Meta:
        model = Order

        fields = [
            "full_name",
            "address",
            "city",
            "state",
            "postal_code",
            "country",
            "payment_method",
        ]


class OrderReadSerializer(serializers.ModelSerializer):
    items = OrderItemReadSerializer(
        many=True,
        read_only=True,
    )

    class Meta:
        model = Order

        fields = [
            "id",
            "public_id",
            "full_name",
            "address",
            "city",
            "state",
            "postal_code",
            "country",
            "payment_method",
            "email",
            "subtotal_amount",
            "discount_code",
            "discount_amount",
            "tax_amount",
            "total_amount",
            "currency",
            "status",
            "created_at",
            "delivered_at",
            "return_status",
            "return_requested_at",
            "return_approved_at",
            "return_received_at",
            "return_refunded_at",
            "return_rejected_at",
            "refund_status",
            "refund_initiated_at",
            "card_brand",
            "card_last4",
            "cardholder_name",
            "items",
        ]

        read_only_fields = fields
