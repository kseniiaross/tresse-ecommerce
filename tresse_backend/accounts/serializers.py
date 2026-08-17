from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

User = get_user_model()


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    username_field = "email"

    def validate(self, attrs):
        email = (attrs.get("email") or "").strip().lower()
        password = attrs.get("password")

        attrs["username"] = email
        attrs["password"] = password

        data = super().validate(attrs)

        user = self.user
        if hasattr(user, "is_active") and not user.is_active:
            raise serializers.ValidationError(
                {"detail": "Account is deactivated. Please restore it via email."}
            )

        data["user"] = {
            "id": user.id,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
        }
        return data


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    email = serializers.EmailField()
    phone_number = serializers.CharField()

    class Meta:
        model = User
        fields = ["email", "phone_number", "password", "first_name", "last_name"]

    def validate_email(self, value: str):
        email = value.strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("User with this email already exists.")
        return email

    def validate_phone_number(self, value: str):
        phone = (value or "").strip()
        if not phone:
            raise serializers.ValidationError("Phone number is required.")
        return phone

    def validate_password(self, value: str):
        validate_password(value)
        return value

    def create(self, validated_data):
        validated_data["email"] = validated_data["email"].strip().lower()
        validated_data["phone_number"] = validated_data["phone_number"].strip()

        user = User.objects.create_user(
            email=validated_data["email"],
            phone_number=validated_data["phone_number"],
            password=validated_data["password"],
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
        )
        return user


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True, min_length=8)

    def validate(self, attrs):
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        return attrs

    def validate_new_password(self, value: str):
        validate_password(value)
        return value

    def save(self, user):
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        return user


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uidb64 = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True, min_length=8)

    def validate(self, attrs):
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        return attrs

    def validate_new_password(self, value: str):
        validate_password(value)
        return value


class ProfileSerializer(serializers.Serializer):
    firstName = serializers.CharField(required=False, allow_blank=True, max_length=150)
    lastName = serializers.CharField(required=False, allow_blank=True, max_length=150)
    email = serializers.EmailField(required=False)

    addressLine1 = serializers.CharField(required=False, allow_blank=True, max_length=255)
    apartment = serializers.CharField(required=False, allow_blank=True, max_length=255)
    city = serializers.CharField(required=False, allow_blank=True, max_length=120)
    state = serializers.CharField(required=False, allow_blank=True, max_length=120)
    postalCode = serializers.CharField(required=False, allow_blank=True, max_length=40)
    country = serializers.CharField(required=False, allow_blank=True, max_length=120)
