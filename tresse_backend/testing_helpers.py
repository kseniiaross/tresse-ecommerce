# tresse_backend/test_utils.py
from django.contrib.auth import get_user_model

User = get_user_model()


def make_user(email, **kwargs):
    defaults = dict(
        phone_number="1234567890",
        password="testpass123",
        first_name="Test",
        last_name="User",
    )
    defaults.update(kwargs)
    return User.objects.create_user(email=email, **defaults)
