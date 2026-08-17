from __future__ import annotations

from adminsortable2.admin import (
    SortableAdminMixin,
    SortableInlineAdminMixin,
)
from django import forms
from django.contrib import admin
from django.utils.html import format_html

from .models import (
    Cart,
    CartItem,
    Category,
    Collection,
    EmailLog,
    Product,
    ProductGroup,
    ProductImage,
    ProductSize,
    Review,
    Size,
    StockSubscription,
)


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "slug",
    )

    search_fields = (
        "name",
        "slug",
    )

    prepopulated_fields = {"slug": ("name",)}


@admin.register(Collection)
class CollectionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "slug",
    )

    search_fields = (
        "name",
        "slug",
    )

    prepopulated_fields = {"slug": ("name",)}


@admin.register(ProductGroup)
class ProductGroupAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "slug",
    )

    search_fields = (
        "name",
        "slug",
    )

    prepopulated_fields = {"slug": ("name",)}


class ProductSizeInline(admin.TabularInline):
    model = ProductSize
    extra = 1

    fields = (
        "size",
        "quantity",
    )


class ProductImageInline(
    SortableInlineAdminMixin,
    admin.TabularInline,
):
    model = ProductImage
    extra = 1

    fields = (
        "preview",
        "image",
        "alt_text",
        "sort_order",
    )

    readonly_fields = ("preview",)

    ordering = (
        "sort_order",
        "id",
    )

    def preview(self, obj):
        if not obj or not getattr(
            obj,
            "image",
            None,
        ):
            return "—"

        try:
            url = obj.image.url
        except Exception:
            url = None

        if not url:
            return "—"

        return format_html(
            ('<img src="{}" style="height:60px;width:60px;border-radius:8px;object-fit:cover;" />'),
            url,
        )

    preview.short_description = "Preview"


class ProductAdminForm(forms.ModelForm):
    class Meta:
        model = Product
        fields = "__all__"

        widgets = {
            "collections": (forms.CheckboxSelectMultiple()),
        }


@admin.register(Product)
class ProductAdmin(
    SortableAdminMixin,
    admin.ModelAdmin,
):
    form = ProductAdminForm

    ordering = ("sort_order",)

    list_display = (
        "id",
        "name",
        "group",
        "category",
        "color_preview",
        "color_name",
        "price",
        "allows_custom_length",
        "return_policy",
        "available",
        "created_at",
    )

    list_filter = (
        "available",
        "return_policy",
        "category",
        "group",
        "collections",
    )

    search_fields = (
        "name",
        "description",
        "care_instructions",
        "color_name",
    )

    inlines = (
        ProductSizeInline,
        ProductImageInline,
    )

    autocomplete_fields = (
        "category",
        "group",
    )

    fieldsets = (
        (
            "Main info",
            {
                "fields": (
                    "name",
                    "group",
                    "category",
                    "collections",
                    "price",
                    "available",
                    "in_stock",
                    "allows_custom_sizing",
                    "return_policy",
                )
            },
        ),
        (
            "Custom length",
            {
                "fields": (
                    "allows_custom_length",
                    "custom_length_cm",
                    "custom_length_surcharge",
                )
            },
        ),
        (
            "Color variant",
            {
                "fields": (
                    "color_name",
                    "color_hex",
                    "color_swatch_image",
                )
            },
        ),
        (
            "Content",
            {
                "fields": (
                    "description",
                    "care_instructions",
                )
            },
        ),
    )

    def color_preview(self, obj):
        if obj.color_swatch_image:
            try:
                return format_html(
                    (
                        '<img src="{}" '
                        'style="height:28px;'
                        "width:28px;"
                        "border-radius:50%;"
                        "object-fit:cover;"
                        'border:1px solid #ddd;" />'
                    ),
                    obj.color_swatch_image.url,
                )

            except Exception:
                return "—"

        if obj.color_hex:
            return format_html(
                (
                    '<span style="'
                    "display:inline-block;"
                    "height:28px;"
                    "width:28px;"
                    "border-radius:50%;"
                    "background:{};"
                    "border:1px solid #ddd;"
                    '"></span>'
                ),
                obj.color_hex,
            )

        return "—"

    color_preview.short_description = "Color"


@admin.register(Size)
class SizeAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
    )

    search_fields = ("name",)


@admin.register(ProductSize)
class ProductSizeAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "product",
        "size",
        "quantity",
    )

    list_filter = ("size",)

    search_fields = (
        "product__name",
        "size__name",
    )


@admin.register(Cart)
class CartAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "created_at",
        "updated_at",
    )

    search_fields = ("user__email",)


@admin.register(CartItem)
class CartItemAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "cart",
        "product_size",
        "quantity",
    )

    search_fields = (
        "cart__user__email",
        "product_size__product__name",
        "product_size__size__name",
    )


@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "product",
        "user",
        "rating",
        "created_at",
    )

    list_filter = (
        "rating",
        "created_at",
    )

    search_fields = (
        "product__name",
        "user__email",
        "comment",
    )


@admin.register(ProductImage)
class ProductImageAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "product",
        "sort_order",
    )

    search_fields = (
        "product__name",
        "alt_text",
    )

    ordering = (
        "product",
        "sort_order",
        "id",
    )


@admin.register(StockSubscription)
class StockSubscriptionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "product",
        "email",
        "user",
        "created_at",
        "notified_at",
    )

    list_filter = (
        "created_at",
        "notified_at",
    )

    search_fields = (
        "product__name",
        "email",
        "user__email",
    )

    readonly_fields = (
        "created_at",
        "notified_at",
    )

    ordering = ("-created_at",)


@admin.register(EmailLog)
class EmailLogAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "email_type",
        "status",
        "to_email",
        "subject",
        "product",
        "created_at",
    )

    list_filter = (
        "email_type",
        "status",
        "created_at",
    )

    search_fields = (
        "to_email",
        "subject",
        "product__name",
        "error_message",
    )

    readonly_fields = (
        "email_type",
        "status",
        "to_email",
        "subject",
        "product",
        "error_message",
        "provider_message_id",
        "created_at",
    )

    ordering = ("-created_at",)

    def has_add_permission(
        self,
        request,
    ):
        return False

    def has_change_permission(
        self,
        request,
        obj=None,
    ):
        return False

    def has_delete_permission(
        self,
        request,
        obj=None,
    ):
        return False
