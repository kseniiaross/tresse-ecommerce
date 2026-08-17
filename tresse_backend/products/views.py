from __future__ import annotations

from django.core.validators import (
    validate_email,
)
from django.db import (
    transaction,
)
from django.db.models import (
    BooleanField,
    Exists,
    OuterRef,
    Value,
)
from django.shortcuts import (
    get_object_or_404,
)
from django_filters.rest_framework import (
    DjangoFilterBackend,
)
from rest_framework import (
    filters as drf_filters,
)
from rest_framework import (
    permissions,
    serializers,
    status,
    viewsets,
)
from rest_framework.decorators import (
    action,
)
from rest_framework.pagination import (
    PageNumberPagination,
)
from rest_framework.permissions import (
    IsAdminUser,
    IsAuthenticated,
)
from rest_framework.response import (
    Response,
)
from rest_framework.views import (
    APIView,
)

from .filters import (
    ProductFilter,
)
from .models import (
    Cart,
    CartItem,
    Product,
    ProductSize,
    ProductWishlist,
    StockSubscription,
)
from .serializers import (
    CartItemSerializer,
    CartSerializer,
    ProductSerializer,
)
from .throttles import (
    StockSubscribeAnonThrottle,
    StockSubscribeUserThrottle,
)


class ProductPagination(
    PageNumberPagination,
):
    page_size = 12

    page_size_query_param = "page_size"

    max_page_size = 100


class CartAPIView(
    APIView,
):
    permission_classes = [
        IsAuthenticated,
    ]

    def get(
        self,
        request,
    ):
        cart, _ = Cart.objects.get_or_create(
            user=request.user,
        )

        cart = (
            Cart.objects.filter(
                pk=cart.pk,
            )
            .select_related(
                "user",
            )
            .prefetch_related(
                "items__product_size__size",
                "items__product_size__product__images",
                "items__product_size__product__category",
                "items__product_size__product__collections",
            )
            .first()
        )

        serializer = CartSerializer(
            cart,
            context={
                "request": request,
            },
        )

        return Response(
            serializer.data,
            status=status.HTTP_200_OK,
        )


class CartItemAPIView(
    APIView,
):
    permission_classes = [
        IsAuthenticated,
    ]

    def post(
        self,
        request,
    ):
        raw_product_size_id = request.data.get(
            "product_size_id",
        )

        if raw_product_size_id is None:
            return Response(
                {"product_size_id": ["This field is required."]},
                status=(status.HTTP_400_BAD_REQUEST),
            )

        try:
            product_size_id = int(
                raw_product_size_id,
            )
        except (
            TypeError,
            ValueError,
        ):
            return Response(
                {"product_size_id": ["Invalid product size."]},
                status=(status.HTTP_400_BAD_REQUEST),
            )

        try:
            with transaction.atomic():
                cart, _ = Cart.objects.get_or_create(
                    user=request.user,
                )

                cart = Cart.objects.select_for_update().get(
                    pk=cart.pk,
                )

                product_size = (
                    ProductSize.objects.select_for_update()
                    .select_related(
                        "product",
                        "size",
                    )
                    .filter(
                        pk=product_size_id,
                    )
                    .first()
                )

                if product_size is None:
                    return Response(
                        {"product_size_id": ["Invalid product size."]},
                        status=(status.HTTP_400_BAD_REQUEST),
                    )

                payload = request.data.copy()

                payload["product_size_id"] = product_size.id

                if payload.get(
                    "quantity",
                ) in (
                    None,
                    "",
                ):
                    payload["quantity"] = 1

                serializer = CartItemSerializer(
                    data=payload,
                    context={
                        "request": request,
                        "cart": cart,
                    },
                )

                serializer.is_valid(
                    raise_exception=True,
                )

                item = serializer.save(
                    cart=cart,
                )

        except serializers.ValidationError:
            raise

        item = (
            CartItem.objects.select_related(
                "product_size__product",
                "product_size__size",
            )
            .prefetch_related(
                "product_size__product__images",
            )
            .get(
                pk=item.pk,
            )
        )

        return Response(
            CartItemSerializer(
                item,
                context={
                    "request": request,
                },
            ).data,
            status=status.HTTP_201_CREATED,
        )

    def put(
        self,
        request,
        item_id,
    ):
        try:
            with transaction.atomic():
                cart = (
                    Cart.objects.select_for_update()
                    .filter(
                        user=request.user,
                    )
                    .first()
                )

                if cart is None:
                    return Response(
                        {"detail": ("Cart not found.")},
                        status=(status.HTTP_404_NOT_FOUND),
                    )

                item = (
                    CartItem.objects.select_for_update()
                    .select_related(
                        "product_size__product",
                        "product_size__size",
                    )
                    .filter(
                        id=item_id,
                        cart=cart,
                    )
                    .first()
                )

                if item is None:
                    return Response(
                        {"detail": ("Cart item not found.")},
                        status=(status.HTTP_404_NOT_FOUND),
                    )

                product_size = (
                    ProductSize.objects.select_for_update()
                    .select_related(
                        "product",
                        "size",
                    )
                    .get(
                        pk=(item.product_size_id),
                    )
                )

                payload = request.data.copy()

                payload["product_size_id"] = product_size.id

                serializer = CartItemSerializer(
                    item,
                    data=payload,
                    partial=True,
                    context={
                        "request": request,
                        "cart": cart,
                    },
                )

                serializer.is_valid(
                    raise_exception=True,
                )

                item = serializer.save()

        except serializers.ValidationError:
            raise

        item = (
            CartItem.objects.select_related(
                "product_size__product",
                "product_size__size",
            )
            .prefetch_related(
                "product_size__product__images",
            )
            .get(
                pk=item.pk,
            )
        )

        return Response(
            CartItemSerializer(
                item,
                context={
                    "request": request,
                },
            ).data,
            status=status.HTTP_200_OK,
        )

    def delete(
        self,
        request,
        item_id,
    ):
        cart = get_object_or_404(
            Cart,
            user=request.user,
        )

        item = get_object_or_404(
            CartItem,
            id=item_id,
            cart=cart,
        )

        item.delete()

        return Response(
            status=(status.HTTP_204_NO_CONTENT),
        )


class ProductViewSet(
    viewsets.ReadOnlyModelViewSet,
):
    serializer_class = ProductSerializer

    permission_classes = [
        permissions.AllowAny,
    ]

    filter_backends = [
        DjangoFilterBackend,
        drf_filters.SearchFilter,
        drf_filters.OrderingFilter,
    ]

    filterset_class = ProductFilter

    pagination_class = ProductPagination

    search_fields = [
        "name",
        "description",
    ]

    ordering_fields = [
        "price",
        "created_at",
        "name",
        "sort_order",
    ]

    ordering = [
        "sort_order",
        "-created_at",
        "id",
    ]

    def get_queryset(
        self,
    ):
        user = getattr(
            self.request,
            "user",
            None,
        )

        queryset = (
            Product.objects.select_related(
                "category",
                "group",
            )
            .prefetch_related(
                "images",
                "sizes",
                "collections",
                "group__products",
                "group__products__images",
            )
            .annotate(
                _in_stock=Exists(
                    ProductSize.objects.filter(
                        product_id=(OuterRef("pk")),
                        quantity__gt=0,
                    )
                )
            )
        )

        category_slug = self.request.query_params.get(
            "category",
        )

        if category_slug:
            queryset = queryset.filter(
                category__slug=(category_slug),
            )

        collection_slug = self.request.query_params.get(
            "collection",
        )

        if collection_slug:
            queryset = queryset.filter(
                collections__slug=(collection_slug),
            )

        if user and user.is_authenticated:
            queryset = queryset.annotate(
                _is_in_wishlist=Exists(
                    ProductWishlist.objects.filter(
                        product_id=(OuterRef("pk")),
                        user=user,
                    )
                )
            )

        return queryset.distinct()

    def get_serializer_context(
        self,
    ):
        ctx = super().get_serializer_context()

        ctx["request"] = self.request

        return ctx

    @action(
        methods=[
            "post",
            "delete",
        ],
        detail=True,
        url_path="wishlist",
        permission_classes=[
            IsAuthenticated,
        ],
    )
    def wishlist(
        self,
        request,
        pk=None,
    ):
        product = get_object_or_404(
            Product,
            pk=pk,
        )

        if request.method == "POST":
            (
                ProductWishlist.objects.get_or_create(
                    user=request.user,
                    product=product,
                )
            )

            return Response(
                {
                    "is_in_wishlist": True,
                },
                status=(status.HTTP_200_OK),
            )

        (
            ProductWishlist.objects.filter(
                user=request.user,
                product=product,
            ).delete()
        )

        return Response(
            {
                "is_in_wishlist": False,
            },
            status=status.HTTP_200_OK,
        )

    @action(
        methods=[
            "post",
        ],
        detail=True,
        url_path=("subscribe_back_in_stock"),
        permission_classes=[
            permissions.AllowAny,
        ],
        throttle_classes=[
            StockSubscribeAnonThrottle,
            StockSubscribeUserThrottle,
        ],
    )
    def subscribe_back_in_stock(
        self,
        request,
        pk=None,
    ):
        product = get_object_or_404(
            Product,
            pk=pk,
        )

        if request.user.is_authenticated:
            email = (request.user.email or "").strip()
        else:
            email = (
                request.data.get(
                    "email",
                )
                or ""
            ).strip()

        if not email:
            return Response(
                {"email": ("This field is required.")},
                status=(status.HTTP_400_BAD_REQUEST),
            )

        try:
            validate_email(
                email,
            )
        except Exception:
            return Response(
                {"email": ("Invalid email.")},
                status=(status.HTTP_400_BAD_REQUEST),
            )

        subscription, _ = StockSubscription.objects.get_or_create(
            product=product,
            email=email,
            defaults={
                "user": (request.user if request.user.is_authenticated else None),
            },
        )

        if request.user.is_authenticated and subscription.user_id is None:
            subscription.user = request.user

            subscription.save(
                update_fields=[
                    "user",
                ],
            )

        return Response(
            {
                "ok": True,
                "subscribed": True,
                "email": email,
            },
            status=status.HTTP_200_OK,
        )

    @action(
        methods=[
            "patch",
        ],
        detail=False,
        url_path="reorder",
        permission_classes=[
            IsAdminUser,
        ],
    )
    def reorder(
        self,
        request,
    ):
        items = request.data.get(
            "items",
        )

        if not isinstance(
            items,
            list,
        ):
            return Response(
                {"detail": ("Expected items list.")},
                status=(status.HTTP_400_BAD_REQUEST),
            )

        with transaction.atomic():
            for (
                index,
                item,
            ) in enumerate(items):
                product_id = (
                    item.get("id")
                    if isinstance(
                        item,
                        dict,
                    )
                    else None
                )

                if not product_id:
                    continue

                (
                    Product.objects.filter(
                        id=product_id,
                    ).update(
                        sort_order=index,
                    )
                )

        return Response(
            {
                "ok": True,
            },
            status=status.HTTP_200_OK,
        )


class WishlistViewSet(
    viewsets.ReadOnlyModelViewSet,
):
    permission_classes = [
        IsAuthenticated,
    ]

    serializer_class = ProductSerializer

    pagination_class = ProductPagination

    filter_backends = [
        DjangoFilterBackend,
        drf_filters.OrderingFilter,
    ]

    filterset_class = ProductFilter

    ordering_fields = [
        "price",
        "created_at",
        "name",
    ]

    ordering = [
        "-created_at",
    ]

    @action(
        detail=False,
        methods=[
            "get",
        ],
    )
    def count(
        self,
        request,
    ):
        n = ProductWishlist.objects.filter(
            user=request.user,
        ).count()

        return Response(
            {
                "count": n,
            },
            status=status.HTTP_200_OK,
        )

    def get_queryset(
        self,
    ):
        wish_ids = ProductWishlist.objects.filter(
            user=self.request.user,
        ).values_list(
            "product_id",
            flat=True,
        )

        return (
            Product.objects.filter(
                id__in=wish_ids,
            )
            .select_related(
                "category",
                "group",
            )
            .prefetch_related(
                "images",
                "sizes",
                "collections",
                "group__products",
                "group__products__images",
            )
            .annotate(
                _in_stock=Exists(
                    ProductSize.objects.filter(
                        product_id=(OuterRef("pk")),
                        quantity__gt=0,
                    )
                ),
                _is_in_wishlist=Value(
                    True,
                    output_field=(BooleanField()),
                ),
            )
            .distinct()
        )

    def get_serializer_context(
        self,
    ):
        ctx = super().get_serializer_context()

        ctx["request"] = self.request

        return ctx
