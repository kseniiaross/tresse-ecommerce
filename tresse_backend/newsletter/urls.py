from django.urls import path

from .views import SubscribeAPIView, UnsubscribeAPIView

urlpatterns = [
    path("subscribe/", SubscribeAPIView.as_view(), name="newsletter_subscribe"),
    path(
        "unsubscribe/<str:token>/",
        UnsubscribeAPIView.as_view(),
        name="newsletter_unsubscribe",
    ),
]
