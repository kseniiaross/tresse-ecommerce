from django.urls import path

from .views import (
    CancelOrderAPIView,
    MyOrdersAPIView,
    RequestReturnAPIView,
)
from .views_stripe import (
    create_checkout_session,
    stripe_webhook,
)

urlpatterns = [
    path(
        "my/",
        MyOrdersAPIView.as_view(),
        name="orders-my",
    ),
    path(
        "<int:order_id>/cancel/",
        CancelOrderAPIView.as_view(),
        name="order-cancel",
    ),
    path(
        "<int:order_id>/return/",
        RequestReturnAPIView.as_view(),
        name="order-return",
    ),
    path(
        "create-checkout-session/",
        create_checkout_session,
        name="create-checkout-session",
    ),
    path(
        "webhook/",
        stripe_webhook,
        name="stripe-webhook",
    ),
]
