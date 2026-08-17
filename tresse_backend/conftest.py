# tresse_backend/conftest.py
import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def make_user(db):
    from django.contrib.auth import get_user_model

    user_model = get_user_model()

    def _make(email, **kwargs):
        defaults = dict(
            phone_number="1234567890",
            password="testpass123",
            first_name="Test",
            last_name="User",
        )
        defaults.update(kwargs)
        return user_model.objects.create_user(email=email, **defaults)

    return _make
