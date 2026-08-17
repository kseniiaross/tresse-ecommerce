# tresse_backend/products/tests.py
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from products.filters import ProductFilter
from products.models import (
    Cart,
    CartItem,
    Category,
    Product,
    ProductSize,
    ProductWishlist,
    Size,
    StockSubscription,
)
from testing_helpers import make_user


def _make_product(**kwargs):
    defaults = dict(name="Sweater", price=Decimal("50.00"))
    defaults.update(kwargs)
    return Product.objects.create(**defaults)


class CartItemAddTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("anna@example.com")
        self.client.force_authenticate(user=self.user)

        self.product = _make_product()
        self.size, _ = Size.objects.get_or_create(name="M")
        self.product_size = ProductSize.objects.create(
            product=self.product,
            size=self.size,
            quantity=5,
        )
        self.url = reverse("cart-items")

    def test_add_item_creates_cart_and_item(self):
        resp = self.client.post(
            self.url,
            {
                "product_size_id": self.product_size.id,
                "quantity": 2,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Cart.objects.filter(user=self.user).exists())
        item = CartItem.objects.get(cart__user=self.user)
        self.assertEqual(item.quantity, 2)

    def test_add_item_defaults_quantity_to_1(self):
        resp = self.client.post(self.url, {"product_size_id": self.product_size.id})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        item = CartItem.objects.get(cart__user=self.user)
        self.assertEqual(item.quantity, 1)

    def test_add_item_missing_product_size_rejected(self):
        resp = self.client.post(self.url, {})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_add_item_invalid_product_size_rejected(self):
        resp = self.client.post(self.url, {"product_size_id": 9999})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_add_item_exceeding_stock_rejected(self):
        resp = self.client.post(
            self.url,
            {
                "product_size_id": self.product_size.id,
                "quantity": 10,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_add_item_out_of_stock_rejected(self):
        self.product_size.quantity = 0
        self.product_size.save()
        resp = self.client.post(
            self.url,
            {
                "product_size_id": self.product_size.id,
                "quantity": 1,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_add_item_unavailable_product_rejected(self):
        self.product.available = False
        self.product.save()
        resp = self.client.post(
            self.url,
            {
                "product_size_id": self.product_size.id,
                "quantity": 1,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_adding_same_size_twice_aggregates_against_stock(self):
        """Ключевой тест: 3 + 3 при stock=5 должно быть отклонено на второй попытке."""
        resp1 = self.client.post(
            self.url,
            {
                "product_size_id": self.product_size.id,
                "quantity": 3,
            },
        )
        self.assertEqual(resp1.status_code, status.HTTP_201_CREATED)

        resp2 = self.client.post(
            self.url,
            {
                "product_size_id": self.product_size.id,
                "quantity": 3,
            },
        )
        self.assertEqual(resp2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_custom_length_snapshot_applied(self):
        self.product.allows_custom_length = True
        self.product.custom_length_cm = 120
        self.product.custom_length_surcharge = Decimal("15.00")
        self.product.save()

        resp = self.client.post(
            self.url,
            {
                "product_size_id": self.product_size.id,
                "quantity": 1,
                "custom_length_selected": True,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

        item = CartItem.objects.get(cart__user=self.user)
        self.assertEqual(item.custom_length_cm, 120)
        self.assertEqual(item.custom_length_surcharge, Decimal("15.00"))

    def test_custom_length_rejected_when_product_does_not_allow(self):
        resp = self.client.post(
            self.url,
            {
                "product_size_id": self.product_size.id,
                "quantity": 1,
                "custom_length_selected": True,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class CartItemUpdateDeleteTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("bob@example.com")
        self.client.force_authenticate(user=self.user)

        self.product = _make_product()
        self.size, _ = Size.objects.get_or_create(name="L")
        self.product_size = ProductSize.objects.create(
            product=self.product,
            size=self.size,
            quantity=5,
        )
        self.cart = Cart.objects.create(user=self.user)
        self.item = CartItem.objects.create(
            cart=self.cart,
            product_size=self.product_size,
            quantity=2,
        )

    def test_update_quantity(self):
        url = reverse("cart-item", kwargs={"item_id": self.item.id})
        resp = self.client.put(url, {"quantity": 4})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.item.refresh_from_db()
        self.assertEqual(self.item.quantity, 4)

    def test_update_exceeding_stock_rejected(self):
        url = reverse("cart-item", kwargs={"item_id": self.item.id})
        resp = self.client.put(url, {"quantity": 99})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_update_item_not_owned_by_user_404(self):
        other = make_user("intruder@example.com")
        client = APIClient()
        client.force_authenticate(user=other)
        url = reverse("cart-item", kwargs={"item_id": self.item.id})
        resp = client.put(url, {"quantity": 1})
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_delete_item(self):
        url = reverse("cart-item", kwargs={"item_id": self.item.id})
        resp = self.client.delete(url)
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(CartItem.objects.filter(id=self.item.id).exists())

    def test_delete_item_not_owned_404(self):
        other = make_user("intruder2@example.com")
        client = APIClient()
        client.force_authenticate(user=other)
        url = reverse("cart-item", kwargs={"item_id": self.item.id})
        resp = client.delete(url)
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


class WishlistActionTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user("wishy@example.com")
        self.client.force_authenticate(user=self.user)
        self.product = _make_product()

    def test_add_to_wishlist(self):
        url = reverse("product-wishlist", kwargs={"pk": self.product.id})
        resp = self.client.post(url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data["is_in_wishlist"])
        self.assertTrue(
            ProductWishlist.objects.filter(user=self.user, product=self.product).exists()
        )

    def test_add_to_wishlist_idempotent(self):
        url = reverse("product-wishlist", kwargs={"pk": self.product.id})
        self.client.post(url)
        self.client.post(url)
        self.assertEqual(
            ProductWishlist.objects.filter(user=self.user, product=self.product).count(), 1
        )

    def test_remove_from_wishlist(self):
        ProductWishlist.objects.create(user=self.user, product=self.product)
        url = reverse("product-wishlist", kwargs={"pk": self.product.id})
        resp = self.client.delete(url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data["is_in_wishlist"])

    def test_wishlist_count(self):
        ProductWishlist.objects.create(user=self.user, product=self.product)
        resp = self.client.get(reverse("wishlist-count"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["count"], 1)

    def test_wishlist_requires_auth(self):
        client = APIClient()
        url = reverse("product-wishlist", kwargs={"pk": self.product.id})
        resp = client.post(url)
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


class StockSubscriptionTestCase(TestCase):
    def setUp(self):
        self.product = _make_product()
        self.url = reverse("product-subscribe-back-in-stock", kwargs={"pk": self.product.id})

    def test_anonymous_subscribe_with_email(self):
        client = APIClient()
        resp = client.post(self.url, {"email": "guest@example.com"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(
            StockSubscription.objects.filter(
                product=self.product, email="guest@example.com"
            ).exists()
        )

    def test_anonymous_subscribe_missing_email_rejected(self):
        client = APIClient()
        resp = client.post(self.url, {})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_anonymous_subscribe_invalid_email_rejected(self):
        client = APIClient()
        resp = client.post(self.url, {"email": "not-an-email"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_authenticated_subscribe_uses_user_email(self):
        user = make_user("authsub@example.com")
        client = APIClient()
        client.force_authenticate(user=user)
        resp = client.post(self.url, {})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        sub = StockSubscription.objects.get(product=self.product, email="authsub@example.com")
        self.assertEqual(sub.user, user)

    def test_duplicate_subscription_does_not_error(self):
        client = APIClient()
        client.post(self.url, {"email": "dup@example.com"})
        resp = client.post(self.url, {"email": "dup@example.com"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(
            StockSubscription.objects.filter(product=self.product, email="dup@example.com").count(),
            1,
        )


class ProductReorderTestCase(TestCase):
    def setUp(self):
        self.product1 = _make_product(name="A", sort_order=0)
        self.product2 = _make_product(name="B", sort_order=1)
        self.url = reverse("product-reorder")

    def test_reorder_requires_admin(self):
        user = make_user("regular@example.com")
        client = APIClient()
        client.force_authenticate(user=user)
        resp = client.patch(
            self.url,
            {
                "items": [{"id": self.product2.id}, {"id": self.product1.id}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_reorder_updates_sort_order(self):
        admin = make_user("admin@example.com", is_staff=True)
        client = APIClient()
        client.force_authenticate(user=admin)
        resp = client.patch(
            self.url,
            {
                "items": [{"id": self.product2.id}, {"id": self.product1.id}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        self.product1.refresh_from_db()
        self.product2.refresh_from_db()
        self.assertEqual(self.product2.sort_order, 0)
        self.assertEqual(self.product1.sort_order, 1)

    def test_reorder_rejects_non_list_items(self):
        admin = make_user("admin2@example.com", is_staff=True)
        client = APIClient()
        client.force_authenticate(user=admin)
        resp = client.patch(self.url, {"items": "not-a-list"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class ProductFilterTestCase(TestCase):
    def setUp(self):
        self.women, _ = Category.objects.get_or_create(slug="woman", defaults={"name": "Women"})
        self.men, _ = Category.objects.get_or_create(slug="man", defaults={"name": "Men"})

        self.cheap = _make_product(name="Cheap", price=Decimal("20.00"), category=self.women)
        self.pricey = _make_product(name="Pricey", price=Decimal("200.00"), category=self.men)

        self.size, _ = Size.objects.get_or_create(name="M")
        ProductSize.objects.create(product=self.cheap, size=self.size, quantity=5)
        ProductSize.objects.create(product=self.pricey, size=self.size, quantity=0)

    def test_category_alias_women_maps_to_woman(self):
        qs = ProductFilter({"category": "women"}, queryset=Product.objects.all()).qs
        self.assertIn(self.cheap, qs)
        self.assertNotIn(self.pricey, qs)

    def test_price_range_filter(self):
        qs = ProductFilter({"min_price": "100"}, queryset=Product.objects.all()).qs
        self.assertIn(self.pricey, qs)
        self.assertNotIn(self.cheap, qs)

    def test_in_stock_filter(self):
        qs = ProductFilter({"in_stock": "true"}, queryset=Product.objects.all()).qs
        self.assertIn(self.cheap, qs)
        self.assertNotIn(self.pricey, qs)


class ProductListAPITestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        _make_product(name="Visible")

    def test_list_products_public(self):
        resp = self.client.get(reverse("product-list"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["results"][0]["name"], "Visible")

    def test_search_by_name(self):
        resp = self.client.get(reverse("product-list"), {"search": "Visible"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data["results"]), 1)


class StockSignalTestCase(TestCase):
    """Тест сигнала notify_when_back_in_stock из signals.py."""

    def setUp(self):
        self.product = _make_product()
        self.size, _ = Size.objects.get_or_create(name="S")
        self.product_size = ProductSize.objects.create(
            product=self.product,
            size=self.size,
            quantity=0,
        )
        StockSubscription.objects.create(
            product=self.product,
            email="waiting@example.com",
        )

    def test_restock_sends_email_and_marks_notified(self):
        with patch("products.signals.send_back_in_stock_email") as mock_send:
            self.product_size.quantity = 5
            self.product_size.save()

            mock_send.assert_called_once()
            sub = StockSubscription.objects.get(product=self.product, email="waiting@example.com")
            self.assertIsNotNone(sub.notified_at)

    def test_zero_quantity_does_not_trigger_notification(self):
        with patch("products.signals.send_back_in_stock_email") as mock_send:
            self.product_size.quantity = 0
            self.product_size.save()
            mock_send.assert_not_called()

    def test_already_notified_subscription_not_notified_again(self):
        sub = StockSubscription.objects.get(email="waiting@example.com")
        sub.notified_at = timezone.now()
        sub.save()

        with patch("products.signals.send_back_in_stock_email") as mock_send:
            self.product_size.quantity = 5
            self.product_size.save()
            mock_send.assert_not_called()
