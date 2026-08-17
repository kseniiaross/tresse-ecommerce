from __future__ import annotations

import logging
from datetime import timedelta

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .emails import (
    send_account_deleted_email,
    send_account_restore_email,
    send_account_welcome_email,
)
from .models import UserProfile
from .serializers import (
    ChangePasswordSerializer,
    CustomTokenObtainPairSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileSerializer,
    RegisterSerializer,
)

User = get_user_model()
logger = logging.getLogger(__name__)

RESTORE_WINDOW_DAYS = getattr(settings, "ACCOUNT_RESTORE_WINDOW_DAYS", 30)


# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------
def _recaptcha_enabled() -> bool:
    if getattr(settings, "DEBUG", False):
        return False
    return bool(getattr(settings, "RECAPTCHA_SECRET_KEY", ""))


def _verify_recaptcha(token: str) -> bool:
    if not _recaptcha_enabled():
        return True

    token = (token or "").strip()
    if not token:
        return False

    url = "https://www.google.com/recaptcha/api/siteverify"
    data = {"secret": settings.RECAPTCHA_SECRET_KEY, "response": token}

    try:
        r = requests.post(url, data=data, timeout=5)
        r.raise_for_status()
        payload = r.json()
    except Exception:
        return False

    return bool(payload.get("success"))


def _get_client_ip(request) -> str:
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def _mask_email(email: str) -> str:
    email = (email or "").strip()
    if "@" not in email:
        return "***"
    name, domain = email.split("@", 1)
    if len(name) <= 2:
        masked = name[:1] + "***"
    else:
        masked = name[:2] + "***"
    return f"{masked}@{domain}"


def _from_email() -> str:
    return getattr(settings, "DEFAULT_FROM_EMAIL", "") or getattr(settings, "EMAIL_HOST_USER", "")


def _generic_restore_message() -> str:
    return "If an account with that email exists, we sent a restore link."


# ------------------------------------------------------------
# Throttles
# ------------------------------------------------------------
class PasswordResetAnonThrottle(AnonRateThrottle):
    scope = "password_reset_anon"


class PasswordResetUserThrottle(UserRateThrottle):
    scope = "password_reset_user"


class LoginAnonThrottle(AnonRateThrottle):
    scope = "login_anon"


class LoginUserThrottle(UserRateThrottle):
    scope = "login_user"


class RegisterAnonThrottle(AnonRateThrottle):
    scope = "register_anon"


class RegisterUserThrottle(UserRateThrottle):
    scope = "register_user"


class RestoreAnonThrottle(AnonRateThrottle):
    scope = "restore_anon"


class RestoreUserThrottle(UserRateThrottle):
    scope = "restore_user"


# ------------------------------------------------------------
# Auth
# ------------------------------------------------------------
class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [LoginAnonThrottle, LoginUserThrottle]


class RegisterAPIView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [RegisterAnonThrottle, RegisterUserThrottle]

    def post(self, request):
        captcha_token = str((request.data or {}).get("captcha_token") or "").strip()
        if _recaptcha_enabled() and not _verify_recaptcha(captcha_token):
            return Response(
                {"detail": "reCAPTCHA validation failed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = serializer.save()

        transaction.on_commit(lambda: send_account_welcome_email(user.id))

        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "refresh": str(refresh),
                "access": str(refresh.access_token),
                "message": "User registered successfully.",
                "user": {
                    "id": user.id,
                    "email": user.email,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class ChangePasswordAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        if not user.check_password(serializer.validated_data["current_password"]):
            return Response(
                {"detail": "Current password is not correct."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer.save(user=user)
        return Response({"message": "Password changed successfully."}, status=status.HTTP_200_OK)


# ------------------------------------------------------------
# Password reset
# ------------------------------------------------------------
class PasswordResetRequestAPIView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [PasswordResetAnonThrottle, PasswordResetUserThrottle]

    def post(self, request):
        captcha_token = str((request.data or {}).get("captcha_token") or "").strip()
        if _recaptcha_enabled() and not _verify_recaptcha(captcha_token):
            return Response(
                {"detail": "reCAPTCHA validation failed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data["email"].strip().lower()
        generic_msg = "If an account with that email exists, a password reset link has been sent."

        ip = _get_client_ip(request)
        ua = request.META.get("HTTP_USER_AGENT", "")
        logger.info(
            "password_reset_request ip=%s email=%s ua=%s",
            ip,
            _mask_email(email),
            ua[:200],
        )

        user = User.objects.filter(email__iexact=email).only("id", "email").first()
        if user:
            token = default_token_generator.make_token(user)
            uidb64 = urlsafe_base64_encode(force_bytes(user.pk))
            reset_link = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password/{uidb64}/{token}/"

            subject = "Password Reset Request"
            message = f"Click the link below to reset your password:\n\n{reset_link}"

            try:
                send_mail(subject, message, _from_email(), [user.email], fail_silently=False)
            except Exception:
                logger.exception(
                    "password_reset_email_failed ip=%s email=%s", ip, _mask_email(email)
                )

        return Response({"message": generic_msg}, status=status.HTTP_200_OK)


class PasswordResetConfirmAPIView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [PasswordResetAnonThrottle, PasswordResetUserThrottle]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        uidb64 = serializer.validated_data["uidb64"]
        token = serializer.validated_data["token"]
        new_password = serializer.validated_data["new_password"]

        ip = _get_client_ip(request)
        ua = request.META.get("HTTP_USER_AGENT", "")
        logger.info(
            "password_reset_confirm_attempt ip=%s uidb64=%s ua=%s",
            ip,
            uidb64[:24],
            ua[:200],
        )

        generic_err = {"detail": "Invalid or expired reset link."}

        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
        except Exception:
            return Response(generic_err, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(pk=uid).only("id", "password").first()
        if not user:
            return Response(generic_err, status=status.HTTP_400_BAD_REQUEST)

        if not default_token_generator.check_token(user, token):
            return Response(generic_err, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.is_active = True
        user.deleted_at = None
        user.save(update_fields=["password", "is_active", "deleted_at"])

        return Response(
            {"message": "Password has been reset successfully."},
            status=status.HTTP_200_OK,
        )


# ------------------------------------------------------------
# Account restore (request / confirm)
# ------------------------------------------------------------
class AccountRestoreRequestAPIView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [RestoreAnonThrottle, RestoreUserThrottle]

    def post(self, request):
        captcha_token = str((request.data or {}).get("captcha_token") or "").strip()
        if _recaptcha_enabled() and not _verify_recaptcha(captcha_token):
            return Response(
                {"detail": "reCAPTCHA validation failed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email = str((request.data or {}).get("email") or "").strip().lower()
        if not email:
            return Response({"detail": "Email is required."}, status=status.HTTP_400_BAD_REQUEST)

        ip = _get_client_ip(request)
        ua = request.META.get("HTTP_USER_AGENT", "")
        logger.info(
            "account_restore_request ip=%s email=%s ua=%s",
            ip,
            _mask_email(email),
            ua[:200],
        )

        user = (
            User.objects.filter(email__iexact=email)
            .only("id", "email", "first_name", "is_active", "deleted_at")
            .first()
        )

        msg = _generic_restore_message()
        if not user:
            return Response({"message": msg}, status=status.HTTP_200_OK)

        if getattr(user, "is_active", True):
            return Response({"message": msg}, status=status.HTTP_200_OK)

        if user.deleted_at:
            cutoff = timezone.now() - timedelta(days=RESTORE_WINDOW_DAYS)
            if user.deleted_at < cutoff:
                logger.info(
                    "account_restore_expired email=%s deleted_at=%s",
                    _mask_email(email),
                    user.deleted_at,
                )
                return Response({"message": msg}, status=status.HTTP_200_OK)

        token = default_token_generator.make_token(user)
        uidb64 = urlsafe_base64_encode(force_bytes(user.pk))
        restore_url = f"{settings.FRONTEND_URL.rstrip('/')}/account/restore/{uidb64}/{token}/"

        transaction.on_commit(
            lambda: send_account_restore_email(
                email=user.email,
                first_name=(user.first_name or ""),
                restore_url=restore_url,
            )
        )

        return Response({"message": msg}, status=status.HTTP_200_OK)


class AccountRestoreConfirmAPIView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [RestoreAnonThrottle, RestoreUserThrottle]

    def post(self, request):
        uidb64 = str((request.data or {}).get("uidb64") or "").strip()
        token = str((request.data or {}).get("token") or "").strip()
        new_password = str((request.data or {}).get("new_password") or "").strip()

        if not uidb64 or not token:
            return Response({"detail": "Invalid restore link."}, status=status.HTTP_400_BAD_REQUEST)

        if new_password and len(new_password) < 8:
            return Response(
                {"detail": "Password must be at least 8 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        generic_err = {"detail": "Invalid or expired restore link."}

        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
        except Exception:
            return Response(generic_err, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(pk=uid).only("id", "is_active", "deleted_at").first()
        if not user:
            return Response(generic_err, status=status.HTTP_400_BAD_REQUEST)

        if not default_token_generator.check_token(user, token):
            return Response(generic_err, status=status.HTTP_400_BAD_REQUEST)

        if user.deleted_at:
            cutoff = timezone.now() - timedelta(days=RESTORE_WINDOW_DAYS)
            if user.deleted_at < cutoff:
                return Response(generic_err, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            user.is_active = True
            user.deleted_at = None
            if new_password:
                user.set_password(new_password)
                user.save(update_fields=["is_active", "deleted_at", "password"])
            else:
                user.save(update_fields=["is_active", "deleted_at"])

        return Response({"message": "Account restored successfully."}, status=status.HTTP_200_OK)


# ------------------------------------------------------------
# Profile
# ------------------------------------------------------------
class ProfileAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        profile, _ = UserProfile.objects.get_or_create(user=user)

        data = {
            "firstName": user.first_name or "",
            "lastName": user.last_name or "",
            "email": user.email or "",
            "addressLine1": profile.address_line1 or "",
            "apartment": profile.apartment or "",
            "city": profile.city or "",
            "state": profile.state or "",
            "postalCode": profile.postal_code or "",
            "country": profile.country or "",
        }
        return Response(data, status=status.HTTP_200_OK)

    def put(self, request):
        serializer = ProfileSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        user = request.user
        profile, _ = UserProfile.objects.get_or_create(user=user)
        v = serializer.validated_data

        with transaction.atomic():
            user_update_fields: list[str] = []

            if "firstName" in v:
                user.first_name = v.get("firstName", "") or ""
                user_update_fields.append("first_name")

            if "lastName" in v:
                user.last_name = v.get("lastName", "") or ""
                user_update_fields.append("last_name")

            if "email" in v:
                new_email = (v.get("email", "") or "").strip().lower()
                if new_email:
                    user.email = new_email
                    user_update_fields.append("email")

            if user_update_fields:
                try:
                    user.save(update_fields=user_update_fields)
                except IntegrityError:
                    return Response(
                        {"detail": "This email is already in use."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            if "addressLine1" in v:
                profile.address_line1 = v.get("addressLine1", "") or ""
            if "apartment" in v:
                profile.apartment = v.get("apartment", "") or ""
            if "city" in v:
                profile.city = v.get("city", "") or ""
            if "state" in v:
                profile.state = v.get("state", "") or ""
            if "postalCode" in v:
                profile.postal_code = v.get("postalCode", "") or ""
            if "country" in v:
                profile.country = v.get("country", "") or ""

            profile.save()

        refreshed = {
            "firstName": user.first_name or "",
            "lastName": user.last_name or "",
            "email": user.email or "",
            "addressLine1": profile.address_line1 or "",
            "apartment": profile.apartment or "",
            "city": profile.city or "",
            "state": profile.state or "",
            "postalCode": profile.postal_code or "",
            "country": profile.country or "",
        }
        return Response(
            {"message": "Profile updated.", "profile": refreshed},
            status=status.HTTP_200_OK,
        )


# ------------------------------------------------------------
# Deactivate account (soft delete) + email with restore link
# ------------------------------------------------------------
class DeleteAccountAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        confirm = bool((request.data or {}).get("confirm", False))
        if not confirm:
            return Response(
                {"detail": "Confirmation is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        email = (getattr(user, "email", "") or "").strip()
        first_name = (getattr(user, "first_name", "") or "").strip()

        with transaction.atomic():
            user.is_active = False
            user.deleted_at = timezone.now()
            user.set_unusable_password()
            user.save(update_fields=["is_active", "deleted_at", "password"])

            UserProfile.objects.filter(user=user).update(
                address_line1="",
                apartment="",
                city="",
                state="",
                postal_code="",
                country="",
            )

            restore_url = ""
            if email:
                token = default_token_generator.make_token(user)
                uidb64 = urlsafe_base64_encode(force_bytes(user.pk))
                restore_url = (
                    f"{settings.FRONTEND_URL.rstrip('/')}/account/restore/{uidb64}/{token}/"
                )

            transaction.on_commit(
                lambda: (
                    send_account_deleted_email(
                        email=email,
                        first_name=first_name,
                        restore_url=restore_url,
                    )
                    if email
                    else None
                )
            )

        return Response({"message": "Account has been deactivated."}, status=status.HTTP_200_OK)
