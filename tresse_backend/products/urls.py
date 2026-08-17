from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CartAPIView, CartItemAPIView, ProductViewSet, WishlistViewSet

router = DefaultRouter()
router.register(r"wishlist", WishlistViewSet, basename="wishlist")
router.register(r"", ProductViewSet, basename="product")

urlpatterns = [
    path("cart/", CartAPIView.as_view(), name="user-cart"),
    path("cart/items/", CartItemAPIView.as_view(), name="cart-items"),
    path("cart/items/<int:item_id>/", CartItemAPIView.as_view(), name="cart-item"),
    path("", include(router.urls)),
]
