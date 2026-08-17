from __future__ import annotations

from django.conf import settings
from django.db import models


class Category(models.Model):
    name = models.CharField(max_length=100)
    slug = models.SlugField(
        max_length=120,
        unique=True,
    )

    class Meta:
        verbose_name_plural = "Categories"

    def __str__(self) -> str:
        return self.name


class Collection(models.Model):
    name = models.CharField(max_length=100)
    slug = models.SlugField(
        max_length=120,
        unique=True,
    )

    def __str__(self) -> str:
        return self.name


class ProductGroup(models.Model):
    name = models.CharField(max_length=255)
    slug = models.SlugField(
        max_length=280,
        unique=True,
    )

    def __str__(self) -> str:
        return self.name


class Product(models.Model):
    class ReturnPolicy(models.TextChoices):
        STANDARD = (
            "standard",
            "Standard return",
        )
        FINAL_SALE = (
            "final_sale",
            "Final sale",
        )
        NON_RETURNABLE_HYGIENE = (
            "non_returnable_hygiene",
            "Non-returnable for hygiene reasons",
        )

    name = models.CharField(
        max_length=255,
    )

    group = models.ForeignKey(
        ProductGroup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="products",
    )

    color_name = models.CharField(
        max_length=80,
        blank=True,
        default="",
    )

    color_hex = models.CharField(
        max_length=20,
        blank=True,
        default="",
    )

    color_swatch_image = models.ImageField(
        upload_to="product_swatches/",
        blank=True,
        null=True,
    )

    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="products",
    )

    collections = models.ManyToManyField(
        Collection,
        blank=True,
        related_name="products",
    )

    description = models.TextField(
        blank=True,
        null=True,
        default="",
    )

    care_instructions = models.TextField(
        blank=True,
        default="",
    )

    main_image = models.ImageField(
        upload_to="products/",
        blank=True,
        null=True,
    )

    price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
    )

    available = models.BooleanField(
        default=True,
    )

    in_stock = models.BooleanField(
        default=True,
    )

    allows_custom_sizing = models.BooleanField(
        default=False,
    )

    allows_custom_length = models.BooleanField(
        default=False,
    )

    custom_length_cm = models.PositiveIntegerField(
        default=10,
    )

    custom_length_surcharge = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=35,
    )

    return_policy = models.CharField(
        max_length=40,
        choices=ReturnPolicy.choices,
        default=ReturnPolicy.STANDARD,
        db_index=True,
        help_text=("Controls whether this product is eligible for a voluntary return."),
    )

    sort_order = models.PositiveIntegerField(
        default=0,
        db_index=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = (
            "sort_order",
            "-created_at",
            "id",
        )

    def __str__(self) -> str:
        return self.name


class Size(models.Model):
    name = models.CharField(
        max_length=50,
        unique=True,
    )

    def __str__(self) -> str:
        return self.name


class ProductSize(models.Model):
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="sizes",
    )

    size = models.ForeignKey(
        Size,
        on_delete=models.CASCADE,
        related_name="product_sizes",
    )

    quantity = models.PositiveIntegerField(
        default=0,
    )

    class Meta:
        unique_together = (
            "product",
            "size",
        )

    def __str__(self) -> str:
        return f"{self.product.name} - {self.size.name}"


class ProductImage(models.Model):
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="images",
    )

    image = models.ImageField(
        upload_to="products/",
    )

    alt_text = models.CharField(
        max_length=255,
        blank=True,
        default="",
    )

    is_primary = models.BooleanField(
        default=False,
    )

    sort_order = models.PositiveIntegerField(
        default=0,
    )

    class Meta:
        ordering = (
            "sort_order",
            "id",
        )

    def __str__(self) -> str:
        return f"Image for {self.product.name}"

    @property
    def image_url(self) -> str:
        try:
            return self.image.url
        except Exception:
            return ""


class ProductWishlist(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="product_wishlist",
    )

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="wishlisted_by",
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    class Meta:
        unique_together = (
            "user",
            "product",
        )

        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.user} → {self.product.name}"


class StockSubscription(models.Model):
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="stock_subscriptions",
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="stock_subscriptions",
        null=True,
        blank=True,
    )

    email = models.EmailField(
        blank=True,
        default="",
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    notified_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    class Meta:
        unique_together = (
            "product",
            "email",
        )

        ordering = ("-created_at",)

    def __str__(self) -> str:
        who = self.email or self.user

        return f"{who} → {self.product.name}"


class EmailLog(models.Model):
    EMAIL_TYPES = [
        (
            "back_in_stock",
            "Back in stock",
        ),
        (
            "cart_reminder",
            "Cart reminder",
        ),
        (
            "wishlist_reminder",
            "Wishlist reminder",
        ),
        (
            "password_reset",
            "Password reset",
        ),
        (
            "order_confirmation",
            "Order confirmation",
        ),
        (
            "other",
            "Other",
        ),
    ]

    STATUS_CHOICES = [
        (
            "sent",
            "Sent",
        ),
        (
            "failed",
            "Failed",
        ),
    ]

    email_type = models.CharField(
        max_length=50,
        choices=EMAIL_TYPES,
        default="other",
    )

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
    )

    to_email = models.EmailField()

    subject = models.CharField(
        max_length=255,
    )

    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="email_logs",
    )

    error_message = models.TextField(
        blank=True,
        default="",
    )

    provider_message_id = models.CharField(
        max_length=255,
        blank=True,
        default="",
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.email_type} → {self.to_email} ({self.status})"


class Cart(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="cart",
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    def __str__(self) -> str:
        return f"Cart #{self.id} - {self.user}"


class CartItem(models.Model):
    cart = models.ForeignKey(
        Cart,
        on_delete=models.CASCADE,
        related_name="items",
    )

    product_size = models.ForeignKey(
        ProductSize,
        on_delete=models.CASCADE,
        related_name="cart_items",
    )

    quantity = models.PositiveIntegerField(
        default=1,
    )
    custom_length_selected = models.BooleanField(
        default=False,
    )

    custom_length_cm = models.PositiveIntegerField(
        blank=True,
        null=True,
    )

    custom_length_surcharge = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
    )

    custom_bust = models.CharField(
        max_length=20,
        blank=True,
        default="",
    )

    custom_underbust = models.CharField(
        max_length=20,
        blank=True,
        default="",
    )

    custom_waist = models.CharField(
        max_length=20,
        blank=True,
        default="",
    )

    custom_hips = models.CharField(
        max_length=20,
        blank=True,
        default="",
    )

    custom_height = models.CharField(
        max_length=20,
        blank=True,
        default="",
    )

    custom_cup = models.CharField(
        max_length=40,
        blank=True,
        default="",
    )

    custom_fit_notes = models.TextField(
        blank=True,
        default="",
    )

    class Meta:
        ordering = ("id",)

    def __str__(self) -> str:
        return f"{self.quantity} × {self.product_size}"


class Review(models.Model):
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="reviews",
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="reviews",
    )

    rating = models.PositiveSmallIntegerField()

    comment = models.TextField(
        blank=True,
        default="",
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    class Meta:
        unique_together = (
            "product",
            "user",
        )

        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.product.name} - {self.rating}"
