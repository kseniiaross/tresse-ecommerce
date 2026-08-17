from __future__ import annotations

from django.contrib import admin, messages
from django.contrib.auth import get_user_model
from django.db.models import Sum

from orders.models import Order
from products.emails import send_cart_reminder_email, send_wishlist_reminder_email
from products.models import Cart, ProductWishlist

from .models import UserProfile

User = get_user_model()


class UserProfileInline(admin.StackedInline):
    model = UserProfile
    can_delete = False
    extra = 0


class OrderInline(admin.TabularInline):
    model = Order
    extra = 0
    can_delete = False
    show_change_link = True

    fields = (
        "public_id",
        "status",
        "total_amount",
        "card_brand",
        "card_last4",
        "created_at",
    )

    readonly_fields = fields


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    actions = (
        "send_cart_reminder",
        "send_wishlist_reminder",
    )

    list_display = (
        "email",
        "first_name",
        "last_name",
        "phone_number",
        "is_active",
        "is_staff",
        "cart_items_count",
        "cart_total",
        "wishlist_items_count",
        "orders_count",
        "orders_total",
        "date_joined",
    )

    list_filter = (
        "is_active",
        "is_staff",
        "date_joined",
    )

    search_fields = (
        "email",
        "first_name",
        "last_name",
        "phone_number",
    )

    readonly_fields = (
        "date_joined",
        "deleted_at",
        "last_login",
        "cart_items_count",
        "cart_total",
        "wishlist_items_count",
    )

    ordering = ("-date_joined",)

    inlines = (
        UserProfileInline,
        OrderInline,
    )

    def orders_count(self, obj):
        return obj.orders.count()

    orders_count.short_description = "Orders"

    def orders_total(self, obj):
        total = sum(order.total_amount for order in obj.orders.all())
        return f"${total:.2f}"

    orders_total.short_description = "Total spent"

    def get_cart(self, obj):
        return (
            Cart.objects.filter(user=obj).prefetch_related("items__product_size__product").first()
        )

    def cart_items_count(self, obj):
        cart = self.get_cart(obj)

        if not cart:
            return 0

        total = cart.items.aggregate(total=Sum("quantity")).get("total") or 0
        return total

    cart_items_count.short_description = "Cart items"

    def cart_total(self, obj):
        cart = self.get_cart(obj)

        if not cart:
            return "$0.00"

        total = 0

        for item in cart.items.all():
            product = item.product_size.product
            total += product.price * item.quantity

        return f"${total:.2f}"

    cart_total.short_description = "Cart total"

    def wishlist_items_count(self, obj):
        return ProductWishlist.objects.filter(user=obj).count()

    wishlist_items_count.short_description = "Wishlist"

    @admin.action(description="Send cart reminder email")
    def send_cart_reminder(self, request, queryset):
        sent = 0
        skipped = 0
        failed = 0

        for user in queryset:
            cart = self.get_cart(user)

            if not cart:
                skipped += 1
                continue

            cart_count = cart.items.aggregate(total=Sum("quantity")).get("total") or 0

            if cart_count <= 0:
                skipped += 1
                continue

            try:
                send_cart_reminder_email(
                    to_email=user.email,
                    first_name=user.first_name,
                    cart_count=cart_count,
                )
                sent += 1
            except Exception as exc:
                failed += 1
                self.message_user(
                    request,
                    f"Failed to send cart reminder to {user.email}: {exc}",
                    level=messages.ERROR,
                )

        self.message_user(
            request,
            f"Cart reminders sent: {sent}. Skipped: {skipped}. Failed: {failed}.",
            level=messages.SUCCESS if failed == 0 else messages.WARNING,
        )

    @admin.action(description="Send wishlist reminder email")
    def send_wishlist_reminder(self, request, queryset):
        sent = 0
        skipped = 0
        failed = 0

        for user in queryset:
            wishlist_count = ProductWishlist.objects.filter(user=user).count()

            if wishlist_count <= 0:
                skipped += 1
                continue

            try:
                send_wishlist_reminder_email(
                    to_email=user.email,
                    first_name=user.first_name,
                    wishlist_count=wishlist_count,
                )
                sent += 1
            except Exception as exc:
                failed += 1
                self.message_user(
                    request,
                    f"Failed to send wishlist reminder to {user.email}: {exc}",
                    level=messages.ERROR,
                )

        self.message_user(
            request,
            f"Wishlist reminders sent: {sent}. Skipped: {skipped}. Failed: {failed}.",
            level=messages.SUCCESS if failed == 0 else messages.WARNING,
        )


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "city",
        "state",
        "country",
        "updated_at",
    )

    search_fields = (
        "user__email",
        "city",
        "state",
        "country",
    )

    list_filter = (
        "country",
        "state",
        "updated_at",
    )
