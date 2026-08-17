# tresse_backend/accounts/tests.py
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.template.loader import render_to_string
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import UserProfile
from accounts.serializers import ChangePasswordSerializer, RegisterSerializer

User = get_user_model()


def _make_user(email, **kwargs):
    defaults = dict(
        phone_number="1234567890",
        password="testpass123",
        first_name="Test",
        last_name="User",
    )
    defaults.update(kwargs)
    return User.objects.create_user(email=email, **defaults)


def _make_token_link(user):
    token = default_token_generator.make_token(user)
    uidb64 = urlsafe_base64_encode(force_bytes(user.pk))
    return uidb64, token


# ============================================================
# UserManager
# ============================================================
class UserManagerTestCase(TestCase):
    def test_create_user_requires_email(self):
        with self.assertRaises(ValueError):
            User.objects.create_user(
                email=None,
                phone_number="123",
                password="x",
                first_name="A",
                last_name="B",
            )

    def test_create_user_requires_phone(self):
        with self.assertRaises(ValueError):
            User.objects.create_user(
                email="a@example.com",
                phone_number=None,
                password="x",
                first_name="A",
                last_name="B",
            )

    def test_create_user_requires_names(self):
        with self.assertRaises(ValueError):
            User.objects.create_user(
                email="a@example.com",
                phone_number="123",
                password="x",
                first_name="",
                last_name="",
            )

    def test_create_user_normalizes_email(self):
        user = User.objects.create_user(
            email="  Anna@Example.COM ",
            phone_number="123",
            password="testpass123",
            first_name="Anna",
            last_name="Smith",
        )
        self.assertEqual(user.email, "anna@example.com")

    def test_create_user_sets_password_correctly(self):
        user = _make_user("a@example.com")
        self.assertTrue(user.check_password("testpass123"))

    def test_create_superuser_sets_flags(self):
        admin = User.objects.create_superuser(
            email="admin@example.com",
            password="testpass123",
        )
        self.assertTrue(admin.is_staff)
        self.assertTrue(admin.is_superuser)
        self.assertTrue(admin.is_active)


# ============================================================
# Soft delete / restore (model level)
# ============================================================
class UserSoftDeleteTestCase(TestCase):
    def setUp(self):
        self.user = _make_user("a@example.com")

    def test_mark_deleted_deactivates_and_unusable_password(self):
        self.user.mark_deleted()
        self.assertFalse(self.user.is_active)
        self.assertIsNotNone(self.user.deleted_at)
        self.assertFalse(self.user.has_usable_password())

    def test_restore_without_password_reactivates(self):
        self.user.mark_deleted()
        self.user.restore()
        self.assertTrue(self.user.is_active)
        self.assertIsNone(self.user.deleted_at)

    def test_restore_with_new_password_sets_it(self):
        self.user.mark_deleted()
        self.user.restore(new_password="newpass456")
        self.assertTrue(self.user.check_password("newpass456"))
        self.assertTrue(self.user.is_active)


# ============================================================
# Serializers
# ============================================================
class RegisterSerializerTestCase(TestCase):
    def test_duplicate_email_rejected(self):
        _make_user("a@example.com")
        serializer = RegisterSerializer(
            data={
                "email": "A@Example.com",
                "phone_number": "456",
                "password": "testpass123",
                "first_name": "C",
                "last_name": "D",
            }
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("email", serializer.errors)

    def test_valid_registration_creates_user(self):
        serializer = RegisterSerializer(
            data={
                "email": "new@example.com",
                "phone_number": "789",
                "password": "testpass123",
                "first_name": "New",
                "last_name": "User",
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        user = serializer.save()
        self.assertEqual(user.email, "new@example.com")

    def test_weak_password_rejected(self):
        serializer = RegisterSerializer(
            data={
                "email": "weak@example.com",
                "phone_number": "789",
                "password": "123",
                "first_name": "New",
                "last_name": "User",
            }
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("password", serializer.errors)


class ChangePasswordSerializerTestCase(TestCase):
    def test_mismatched_passwords_rejected(self):
        serializer = ChangePasswordSerializer(
            data={
                "current_password": "old123456",
                "new_password": "newpass123",
                "confirm_password": "different123",
            }
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("confirm_password", serializer.errors)

    def test_matching_passwords_valid(self):
        serializer = ChangePasswordSerializer(
            data={
                "current_password": "old123456",
                "new_password": "newpass123",
                "confirm_password": "newpass123",
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)


# ============================================================
# API: Register
# ============================================================
class RegisterAPITestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.url = reverse("register")

    @patch("accounts.views.send_account_welcome_email")
    @patch("accounts.views._verify_recaptcha", return_value=True)
    def test_register_success_returns_tokens(self, mock_recaptcha, mock_email):
        resp = self.client.post(
            self.url,
            {
                "email": "new@example.com",
                "phone_number": "123456",
                "password": "StrongPass123",
                "first_name": "New",
                "last_name": "User",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn("access", resp.data)
        self.assertIn("refresh", resp.data)
        self.assertTrue(User.objects.filter(email="new@example.com").exists())

    @patch("accounts.views._verify_recaptcha", return_value=True)
    def test_register_duplicate_email_rejected(self, mock_recaptcha):
        _make_user("dup@example.com")
        resp = self.client.post(
            self.url,
            {
                "email": "dup@example.com",
                "phone_number": "123456",
                "password": "StrongPass123",
                "first_name": "New",
                "last_name": "User",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(DEBUG=False, RECAPTCHA_SECRET_KEY="fake-key")
    @patch("accounts.views._verify_recaptcha", return_value=False)
    def test_register_fails_recaptcha(self, mock_verify):
        resp = self.client.post(
            self.url,
            {
                "email": "captcha@example.com",
                "phone_number": "123456",
                "password": "StrongPass123",
                "first_name": "New",
                "last_name": "User",
                "captcha_token": "bad",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(email="captcha@example.com").exists())


# ============================================================
# API: Login
# ============================================================
class LoginAPITestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.url = reverse("token_obtain_pair")
        self.user = _make_user("anna@example.com", password="StrongPass123")

    def test_login_success(self):
        resp = self.client.post(
            self.url,
            {
                "email": "anna@example.com",
                "password": "StrongPass123",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("access", resp.data)
        self.assertEqual(resp.data["user"]["email"], "anna@example.com")

    def test_login_wrong_password_rejected(self):
        resp = self.client.post(
            self.url,
            {
                "email": "anna@example.com",
                "password": "WrongPass",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_deactivated_account_rejected(self):
        self.user.mark_deleted()
        resp = self.client.post(
            self.url,
            {
                "email": "anna@example.com",
                "password": "StrongPass123",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


# ============================================================
# API: Change password
# ============================================================
class ChangePasswordAPITestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.url = reverse("change-password")
        self.user = _make_user("a@example.com", password="OldPass123")
        self.client.force_authenticate(user=self.user)

    def test_change_password_wrong_current_rejected(self):
        resp = self.client.post(
            self.url,
            {
                "current_password": "WrongOld123",
                "new_password": "NewPass123",
                "confirm_password": "NewPass123",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_change_password_success(self):
        resp = self.client.post(
            self.url,
            {
                "current_password": "OldPass123",
                "new_password": "NewPass123",
                "confirm_password": "NewPass123",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("NewPass123"))

    def test_change_password_requires_auth(self):
        self.client.force_authenticate(user=None)
        resp = self.client.post(
            self.url,
            {
                "current_password": "OldPass123",
                "new_password": "NewPass123",
                "confirm_password": "NewPass123",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


# ============================================================
# API: Password reset
# ============================================================
class PasswordResetFlowTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = _make_user("reset@example.com", password="OldPass123")

    @patch("accounts.views.send_mail")
    @patch("accounts.views._verify_recaptcha", return_value=True)
    def test_request_reset_always_returns_generic_message(self, mock_recaptcha, mock_send):
        resp = self.client.post(
            reverse("password-reset-request"),
            {
                "email": "doesnotexist@example.com",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("If an account", resp.data["message"])
        mock_send.assert_not_called()

    @patch("accounts.views.send_mail")
    @patch("accounts.views._verify_recaptcha", return_value=True)
    def test_request_reset_sends_email_for_existing_user(self, mock_recaptcha, mock_send):
        resp = self.client.post(
            reverse("password-reset-request"),
            {
                "email": "reset@example.com",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        mock_send.assert_called_once()

    def test_confirm_reset_with_valid_token_changes_password(self):
        uidb64, token = _make_token_link(self.user)
        resp = self.client.post(
            reverse("password-reset-confirm"),
            {
                "uidb64": uidb64,
                "token": token,
                "new_password": "BrandNewPass123",
                "confirm_password": "BrandNewPass123",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("BrandNewPass123"))

    def test_confirm_reset_reactivates_deactivated_account(self):
        """Флагуем как важное поведение: сброс пароля реактивирует soft-deleted юзера."""
        self.user.mark_deleted()
        uidb64, token = _make_token_link(self.user)
        resp = self.client.post(
            reverse("password-reset-confirm"),
            {
                "uidb64": uidb64,
                "token": token,
                "new_password": "BrandNewPass123",
                "confirm_password": "BrandNewPass123",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)
        self.assertIsNone(self.user.deleted_at)

    def test_confirm_reset_invalid_token_rejected(self):
        uidb64, _ = _make_token_link(self.user)
        resp = self.client.post(
            reverse("password-reset-confirm"),
            {
                "uidb64": uidb64,
                "token": "garbage-token",
                "new_password": "BrandNewPass123",
                "confirm_password": "BrandNewPass123",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_reset_mismatched_passwords_rejected(self):
        uidb64, token = _make_token_link(self.user)
        resp = self.client.post(
            reverse("password-reset-confirm"),
            {
                "uidb64": uidb64,
                "token": token,
                "new_password": "BrandNewPass123",
                "confirm_password": "Different123",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ============================================================
# API: Delete / Restore account
# ============================================================
class AccountDeleteAndRestoreFlowTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = _make_user("del@example.com", password="OldPass123", first_name="Del")
        self.client.force_authenticate(user=self.user)

    def test_delete_requires_confirm_flag(self):
        resp = self.client.post(reverse("delete-account"), {})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    @patch("accounts.views.send_account_deleted_email")
    def test_delete_deactivates_account_and_clears_profile(self, mock_email):
        UserProfile.objects.create(user=self.user, city="Kyiv")
        resp = self.client.post(reverse("delete-account"), {"confirm": True})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)
        self.assertIsNotNone(self.user.deleted_at)
        self.assertFalse(self.user.has_usable_password())

        profile = UserProfile.objects.get(user=self.user)
        self.assertEqual(profile.city, "")

    @patch("accounts.views.send_account_restore_email")
    @patch("accounts.views._verify_recaptcha", return_value=True)
    def test_restore_request_for_deactivated_account_sends_email(self, mock_recaptcha, mock_email):
        self.user.mark_deleted()
        client = APIClient()
        with self.captureOnCommitCallbacks(execute=True):
            resp = client.post(reverse("restore-request"), {"email": "del@example.com"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        mock_email.assert_called_once()

    @patch("accounts.views.send_account_restore_email")
    @patch("accounts.views._verify_recaptcha", return_value=True)
    def test_restore_request_for_active_account_does_not_send_email(
        self, mock_recaptcha, mock_email
    ):
        client = APIClient()
        resp = client.post(reverse("restore-request"), {"email": "del@example.com"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        mock_email.assert_not_called()

    @patch("accounts.views._verify_recaptcha", return_value=True)
    def test_restore_request_expired_window_returns_generic_message(self, mock_recaptcha):
        self.user.mark_deleted()
        self.user.deleted_at = timezone.now() - timedelta(days=31)
        self.user.save(update_fields=["deleted_at"])

        client = APIClient()
        with patch("accounts.views.send_account_restore_email") as mock_email:
            resp = client.post(reverse("restore-request"), {"email": "del@example.com"})
            self.assertEqual(resp.status_code, status.HTTP_200_OK)
            mock_email.assert_not_called()

    def test_restore_confirm_with_valid_token_reactivates(self):
        self.user.mark_deleted()
        uidb64, token = _make_token_link(self.user)

        client = APIClient()
        resp = client.post(reverse("restore-confirm"), {"uidb64": uidb64, "token": token})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)
        self.assertIsNone(self.user.deleted_at)

    def test_restore_confirm_expired_window_rejected(self):
        self.user.mark_deleted()
        self.user.deleted_at = timezone.now() - timedelta(days=31)
        self.user.save(update_fields=["deleted_at"])
        uidb64, token = _make_token_link(self.user)

        client = APIClient()
        resp = client.post(reverse("restore-confirm"), {"uidb64": uidb64, "token": token})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_restore_confirm_short_password_rejected(self):
        self.user.mark_deleted()
        uidb64, token = _make_token_link(self.user)

        client = APIClient()
        resp = client.post(
            reverse("restore-confirm"),
            {
                "uidb64": uidb64,
                "token": token,
                "new_password": "short",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ============================================================
# API: Profile
# ============================================================
class ProfileAPITestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = _make_user(
            "profile@example.com",
            password="OldPass123",
            first_name="Pro",
            last_name="File",
        )
        self.client.force_authenticate(user=self.user)

    def test_get_profile_creates_if_missing(self):
        resp = self.client.get(reverse("profile"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["firstName"], "Pro")
        self.assertTrue(UserProfile.objects.filter(user=self.user).exists())

    def test_put_profile_updates_fields(self):
        resp = self.client.put(
            reverse("profile"),
            {
                "firstName": "Updated",
                "city": "Kyiv",
                "postalCode": "01001",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "Updated")

        profile = UserProfile.objects.get(user=self.user)
        self.assertEqual(profile.city, "Kyiv")

    def test_put_profile_duplicate_email_rejected(self):
        _make_user("taken@example.com")
        resp = self.client.put(reverse("profile"), {"email": "taken@example.com"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ============================================================
# Email templates render (smoke test)
# ============================================================
class AccountEmailTemplatesRenderTestCase(TestCase):
    def test_welcome_renders(self):
        html = render_to_string(
            "emails/accounts/welcome.txt",
            {
                "name": "Anna",
                "frontend_url": "https://www.tresseknitting.com",
                "support_email": "support@tresseknitting.com",
            },
        )
        self.assertIn("TRESSE15", html)

    def test_account_deactivated_renders(self):
        html = render_to_string(
            "emails/accounts/account_deactivated.txt",
            {
                "first_name": "Anna",
                "support_email": "support@tresseknitting.com",
                "help_url": "https://www.tresseknitting.com/help",
                "restore_url": "https://www.tresseknitting.com/restore/abc/xyz/",
                "restore_window_days": 30,
            },
        )
        self.assertIn("30 days", html)
