from django.contrib import admin

from .models import NewsletterSubscriber


@admin.register(NewsletterSubscriber)
class NewsletterSubscriberAdmin(admin.ModelAdmin):
    list_display = ("email", "is_active", "source", "created_at")
    list_filter = ("is_active", "source", "created_at")
    search_fields = ("email",)
