from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    AccountRestoreConfirmAPIView,
    AccountRestoreRequestAPIView,
    ChangePasswordAPIView,
    CustomTokenObtainPairView,
    DeleteAccountAPIView,
    PasswordResetConfirmAPIView,
    PasswordResetRequestAPIView,
    ProfileAPIView,
    RegisterAPIView,
)

urlpatterns = [
    path("register/", RegisterAPIView.as_view(), name="register"),
    path("token/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("change-password/", ChangePasswordAPIView.as_view(), name="change-password"),
    path(
        "request-password-reset/",
        PasswordResetRequestAPIView.as_view(),
        name="password-reset-request",
    ),
    path(
        "reset-password/confirm/",
        PasswordResetConfirmAPIView.as_view(),
        name="password-reset-confirm",
    ),
    path(
        "restore/request/",
        AccountRestoreRequestAPIView.as_view(),
        name="restore-request",
    ),
    path(
        "restore/confirm/",
        AccountRestoreConfirmAPIView.as_view(),
        name="restore-confirm",
    ),
    path("profile/", ProfileAPIView.as_view(), name="profile"),
    path("delete-account/", DeleteAccountAPIView.as_view(), name="delete-account"),
]
