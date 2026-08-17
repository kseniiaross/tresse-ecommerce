from __future__ import annotations

from urllib.parse import (
    urlparse,
    urlunparse,
)

from rest_framework import (
    serializers,
)

from .models import (
    Cart,
    CartItem,
    Category,
    Collection,
    Product,
    ProductGroup,
    ProductImage,
    ProductSize,
    ProductWishlist,
    Size,
)


def force_https(
    url: str,
) -> str:
    if not url:
        return url

    parsed = urlparse(url)

    if not parsed.scheme:
        return url

    if parsed.scheme == "http":
        parsed = parsed._replace(
            scheme="https",
        )

        return urlunparse(parsed)

    return url


def build_abs_https(
    request,
    url: str,
) -> str:
    if not url:
        return url

    if request and url.startswith("/"):
        url = request.build_absolute_uri(
            url,
        )

    return force_https(url)


def get_product_main_image_url(
    obj: Product,
    request,
) -> str | None:
    first_image = obj.images.order_by(
        "sort_order",
        "id",
    ).first()

    if first_image and first_image.image:
        try:
            return build_abs_https(
                request,
                first_image.image.url,
            )
        except Exception:
            pass

    main_image = getattr(
        obj,
        "main_image",
        None,
    )

    if main_image:
        try:
            return build_abs_https(
                request,
                main_image.url,
            )
        except Exception:
            pass

    return None


class ProductImageSerializer(
    serializers.ModelSerializer,
):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ProductImage

        fields = [
            "id",
            "image_url",
            "sort_order",
            "alt_text",
            "is_primary",
        ]

    def get_image_url(
        self,
        obj,
    ):
        if not obj.image:
            return None

        request = self.context.get(
            "request",
        )

        return build_abs_https(
            request,
            obj.image.url,
        )


class CategorySerializer(
    serializers.ModelSerializer,
):
    class Meta:
        model = Category

        fields = [
            "id",
            "name",
            "slug",
        ]


class CollectionSerializer(
    serializers.ModelSerializer,
):
    class Meta:
        model = Collection

        fields = [
            "id",
            "name",
            "slug",
        ]


class ProductGroupSerializer(
    serializers.ModelSerializer,
):
    class Meta:
        model = ProductGroup

        fields = [
            "id",
            "name",
            "slug",
        ]


class SizeSerializer(
    serializers.ModelSerializer,
):
    class Meta:
        model = Size

        fields = [
            "id",
            "name",
        ]


class ProductSizeInlineSerializer(
    serializers.ModelSerializer,
):
    size = SizeSerializer(
        read_only=True,
    )

    class Meta:
        model = ProductSize

        fields = [
            "id",
            "size",
            "quantity",
        ]


class ProductMiniSerializer(
    serializers.ModelSerializer,
):
    main_image_url = serializers.SerializerMethodField()

    class Meta:
        model = Product

        fields = [
            "id",
            "name",
            "price",
            "return_policy",
            "allows_custom_length",
            "custom_length_cm",
            "custom_length_surcharge",
            "main_image_url",
        ]

    def get_main_image_url(
        self,
        obj,
    ):
        request = self.context.get(
            "request",
        )

        return get_product_main_image_url(
            obj,
            request,
        )


class ProductColorVariantSerializer(
    serializers.ModelSerializer,
):
    main_image_url = serializers.SerializerMethodField()

    color_swatch_url = serializers.SerializerMethodField()

    class Meta:
        model = Product

        fields = [
            "id",
            "name",
            "color_name",
            "color_hex",
            "color_swatch_url",
            "main_image_url",
            "return_policy",
        ]

    def get_main_image_url(
        self,
        obj,
    ):
        request = self.context.get(
            "request",
        )

        return get_product_main_image_url(
            obj,
            request,
        )

    def get_color_swatch_url(
        self,
        obj,
    ):
        if not obj.color_swatch_image:
            return None

        request = self.context.get(
            "request",
        )

        return build_abs_https(
            request,
            obj.color_swatch_image.url,
        )


class ProductSerializer(
    serializers.ModelSerializer,
):
    images = ProductImageSerializer(
        many=True,
        read_only=True,
    )

    sizes = ProductSizeInlineSerializer(
        many=True,
        read_only=True,
    )

    category = CategorySerializer(
        read_only=True,
    )

    collections = CollectionSerializer(
        many=True,
        read_only=True,
    )

    group = ProductGroupSerializer(
        read_only=True,
    )

    color_swatch_url = serializers.SerializerMethodField()

    variants = serializers.SerializerMethodField()

    main_image_url = serializers.SerializerMethodField()

    collections_slugs = serializers.SerializerMethodField()

    collections_names = serializers.SerializerMethodField()

    is_in_wishlist = serializers.SerializerMethodField()

    in_stock = serializers.SerializerMethodField()

    class Meta:
        model = Product

        fields = [
            "id",
            "category",
            "collections",
            "collections_slugs",
            "collections_names",
            "name",
            "group",
            "color_name",
            "color_hex",
            "color_swatch_url",
            "variants",
            "description",
            "care_instructions",
            "price",
            "available",
            "sort_order",
            "main_image_url",
            "images",
            "sizes",
            "is_in_wishlist",
            "in_stock",
            "allows_custom_sizing",
            "allows_custom_length",
            "custom_length_cm",
            "custom_length_surcharge",
            "return_policy",
        ]

    def get_main_image_url(
        self,
        obj,
    ):
        request = self.context.get(
            "request",
        )

        return get_product_main_image_url(
            obj,
            request,
        )

    def get_color_swatch_url(
        self,
        obj,
    ):
        if not obj.color_swatch_image:
            return None

        request = self.context.get(
            "request",
        )

        return build_abs_https(
            request,
            obj.color_swatch_image.url,
        )

    def get_variants(
        self,
        obj,
    ):
        if obj.group_id:
            variants = obj.group.products.filter(
                available=True,
            ).order_by(
                "id",
            )
        else:
            variants = Product.objects.filter(
                id=obj.id,
            )

        return ProductColorVariantSerializer(
            variants,
            many=True,
            context=self.context,
        ).data

    def get_collections_slugs(
        self,
        obj,
    ):
        return [collection.slug for collection in obj.collections.all()]

    def get_collections_names(
        self,
        obj,
    ):
        return [collection.name for collection in obj.collections.all()]

    def get_is_in_wishlist(
        self,
        obj,
    ):
        annotated = getattr(
            obj,
            "_is_in_wishlist",
            None,
        )

        if annotated is not None:
            return annotated

        request = self.context.get(
            "request",
        )

        user = getattr(
            request,
            "user",
            None,
        )

        if user and user.is_authenticated:
            return ProductWishlist.objects.filter(
                user=user,
                product=obj,
            ).exists()

        return False

    def get_in_stock(
        self,
        obj,
    ):
        annotated = getattr(
            obj,
            "_in_stock",
            None,
        )

        if annotated is not None:
            return annotated

        return obj.sizes.filter(
            quantity__gt=0,
        ).exists()


class ProductSizeSerializer(
    serializers.ModelSerializer,
):
    product = ProductMiniSerializer(
        read_only=True,
    )

    size = SizeSerializer(
        read_only=True,
    )

    class Meta:
        model = ProductSize

        fields = [
            "id",
            "product",
            "size",
            "quantity",
        ]


class CartItemSerializer(
    serializers.ModelSerializer,
):
    product_size = ProductSizeSerializer(
        read_only=True,
    )

    product_size_id = serializers.PrimaryKeyRelatedField(
        queryset=(
            ProductSize.objects.select_related(
                "product",
                "size",
            ).all()
        ),
        source="product_size",
        write_only=True,
        required=False,
    )

    custom_length_cm = serializers.IntegerField(
        read_only=True,
    )

    custom_length_surcharge = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = CartItem

        fields = [
            "id",
            "product_size",
            "product_size_id",
            "quantity",
            "custom_length_selected",
            "custom_length_cm",
            "custom_length_surcharge",
            "custom_bust",
            "custom_underbust",
            "custom_waist",
            "custom_hips",
            "custom_height",
            "custom_cup",
            "custom_fit_notes",
        ]

        extra_kwargs = {
            "quantity": {
                "required": False,
                "min_value": 1,
            },
        }

    def _get_cart(
        self,
    ) -> Cart | None:
        cart = self.context.get(
            "cart",
        )

        if cart is not None:
            return cart

        if self.instance is not None:
            return getattr(
                self.instance,
                "cart",
                None,
            )

        return None

    def _get_product_size(
        self,
        attrs,
    ) -> ProductSize | None:
        product_size = attrs.get(
            "product_size",
        )

        if product_size is not None:
            return product_size

        if self.instance is not None:
            return getattr(
                self.instance,
                "product_size",
                None,
            )

        return None

    def _get_requested_quantity(
        self,
        attrs,
    ) -> int:
        raw_quantity = attrs.get(
            "quantity",
            getattr(
                self.instance,
                "quantity",
                1,
            ),
        )

        try:
            quantity = int(
                raw_quantity,
            )
        except (
            TypeError,
            ValueError,
        ) as exc:
            raise serializers.ValidationError({"quantity": ["Enter a valid quantity."]}) from exc

        if quantity < 1:
            raise serializers.ValidationError({"quantity": ["Quantity must be at least 1."]})

        return quantity

    def _get_other_cart_quantity(
        self,
        *,
        cart: Cart,
        product_size: ProductSize,
    ) -> int:
        queryset = CartItem.objects.filter(
            cart=cart,
            product_size=product_size,
        )

        if self.instance is not None:
            queryset = queryset.exclude(
                pk=self.instance.pk,
            )

        total = 0

        for item in queryset.only(
            "quantity",
        ):
            total += int(
                item.quantity or 0,
            )

        return total

    def validate(
        self,
        attrs,
    ):
        attrs = super().validate(
            attrs,
        )

        cart = self._get_cart()

        product_size = self._get_product_size(
            attrs,
        )

        quantity = self._get_requested_quantity(
            attrs,
        )

        if product_size is None:
            raise serializers.ValidationError({"product_size_id": ["This field is required."]})

        if not product_size.product.available:
            raise serializers.ValidationError(
                {"product_size_id": ["This product is not available."]}
            )

        available_quantity = int(
            product_size.quantity or 0,
        )

        if available_quantity <= 0:
            raise serializers.ValidationError({"quantity": ["This size is out of stock."]})

        other_cart_quantity = 0

        if cart is not None:
            other_cart_quantity = self._get_other_cart_quantity(
                cart=cart,
                product_size=product_size,
            )

        requested_cart_total = other_cart_quantity + quantity

        if requested_cart_total > available_quantity:
            raise serializers.ValidationError(
                {
                    "quantity": [
                        (
                            f"Only "
                            f"{available_quantity} "
                            f"item"
                            f"{'' if available_quantity == 1 else 's'} "
                            f"is available in this size."
                        )
                    ]
                }
            )

        custom_length_selected = attrs.get(
            "custom_length_selected",
            getattr(
                self.instance,
                "custom_length_selected",
                False,
            ),
        )

        if custom_length_selected and not (product_size.product.allows_custom_length):
            raise serializers.ValidationError(
                {"custom_length_selected": [("Custom length is not available for this product.")]}
            )

        attrs["quantity"] = quantity

        return attrs

    def _apply_custom_length_snapshot(
        self,
        validated_data,
    ):
        product_size = validated_data.get(
            "product_size",
        )

        if product_size is None and self.instance is not None:
            product_size = self.instance.product_size

        selected = validated_data.get(
            "custom_length_selected",
            getattr(
                self.instance,
                "custom_length_selected",
                False,
            ),
        )

        if selected and product_size is not None:
            product = product_size.product

            if not product.allows_custom_length:
                raise serializers.ValidationError(
                    {
                        "custom_length_selected": [
                            ("Custom length is not available for this product.")
                        ]
                    }
                )

            validated_data["custom_length_cm"] = product.custom_length_cm

            validated_data["custom_length_surcharge"] = product.custom_length_surcharge

        else:
            validated_data["custom_length_selected"] = False

            validated_data["custom_length_cm"] = None

            validated_data["custom_length_surcharge"] = 0

        return validated_data

    def create(
        self,
        validated_data,
    ):
        validated_data = self._apply_custom_length_snapshot(
            validated_data,
        )

        return super().create(
            validated_data,
        )

    def update(
        self,
        instance,
        validated_data,
    ):
        validated_data = self._apply_custom_length_snapshot(
            validated_data,
        )

        return super().update(
            instance,
            validated_data,
        )


class CartSerializer(
    serializers.ModelSerializer,
):
    items = CartItemSerializer(
        many=True,
        read_only=True,
    )

    class Meta:
        model = Cart

        fields = [
            "id",
            "user",
            "created_at",
            "items",
        ]

        read_only_fields = [
            "user",
        ]
