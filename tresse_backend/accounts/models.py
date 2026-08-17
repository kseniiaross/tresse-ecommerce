from __future__ import annotations

from django.contrib.auth.models import (
    AbstractBaseUser,
    BaseUserManager,
    Group,
    Permission,
    PermissionsMixin,
)
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    def create_user(
        self,
        email=None,
        phone_number=None,
        password=None,
        first_name=None,
        last_name=None,
        **extra_fields,
    ):
        if not email:
            raise ValueError("Email is required for registration.")
        if not phone_number:
            raise ValueError("Phone number is required for registration.")
        if not first_name or not last_name:
            raise ValueError("First name and last name are required for registration.")

        email = self.normalize_email(email).strip().lower()

        user = self.model(
            email=email,
            phone_number=str(phone_number).strip(),
            first_name=str(first_name).strip(),
            last_name=str(last_name).strip(),
            **extra_fields,
        )
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)

        extra_fields.setdefault("phone_number", "0000000000")
        extra_fields.setdefault("first_name", "Admin")
        extra_fields.setdefault("last_name", "User")

        email = self.normalize_email(email).strip().lower()

        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user


class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True, blank=False, null=False)
    phone_number = models.CharField(max_length=15, unique=False, blank=False, null=False)

    first_name = models.CharField(max_length=30, blank=False)
    last_name = models.CharField(max_length=30, blank=False)

    is_email = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    date_joined = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    groups = models.ManyToManyField(
        Group,
        related_name="custom_user_groups",
        blank=True,
    )
    user_permissions = models.ManyToManyField(
        Permission,
        related_name="custom_user_permissions",
        blank=True,
    )

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["phone_number", "first_name", "last_name"]

    def mark_deleted(self) -> None:
        self.is_active = False
        self.deleted_at = timezone.now()
        self.set_unusable_password()
        self.save(update_fields=["is_active", "deleted_at", "password"])

    def restore(self, new_password: str | None = None) -> None:
        self.is_active = True
        self.deleted_at = None

        if new_password:
            self.set_password(new_password)
            self.save(update_fields=["is_active", "deleted_at", "password"])
        else:
            self.save(update_fields=["is_active", "deleted_at"])

    def __str__(self):
        return f"{self.email} ({self.phone_number})"


class UserProfile(models.Model):
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="profile",
    )

    address_line1 = models.CharField(max_length=255, blank=True, default="")
    apartment = models.CharField(max_length=120, blank=True, default="")
    city = models.CharField(max_length=120, blank=True, default="")
    state = models.CharField(max_length=120, blank=True, default="")
    postal_code = models.CharField(max_length=40, blank=True, default="")
    country = models.CharField(max_length=120, blank=True, default="")

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"UserProfile(user_id={self.user_id})"
