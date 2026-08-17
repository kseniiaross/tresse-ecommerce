import pytest


@pytest.mark.django_db
def test_home_page_returns_success(client, settings):
    settings.SECURE_SSL_REDIRECT = False

    response = client.get("/")

    assert response.status_code == 200
    assert b"Welcome to the Tresse Backend API!" in response.content