# newsletter/views.py
import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import DatabaseError, IntegrityError
from django.template.loader import render_to_string
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import NewsletterSubscriber
from .serializers import NewsletterSubscribeSerializer

logger = logging.getLogger(__name__)


class SubscribeAPIView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = NewsletterSubscribeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data["email"].lower().strip()
        source = (serializer.validated_data.get("source") or "unknown").strip()[:32] or "unknown"

        try:
            subscriber, created = NewsletterSubscriber.objects.get_or_create(
                email=email,
                defaults={"source": source, "is_active": True},
            )

            if not created:
                changed = False
                if not subscriber.is_active:
                    subscriber.is_active = True
                    changed = True
                if subscriber.source != source:
                    subscriber.source = source
                    changed = True
                if changed:
                    subscriber.save(update_fields=["is_active", "source", "updated_at"])

        except (IntegrityError, DatabaseError) as e:
            logger.exception("Newsletter DB error for %s: %s", email, str(e))
            if settings.DEBUG:
                return Response(
                    {"detail": f"DB error: {str(e)}"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
            return Response(
                {"detail": "Server error."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        subject = getattr(settings, "NEWSLETTER_WELCOME_SUBJECT", "Welcome to TRESSE")
        from_email = (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "no-reply@tresse.com").strip()
        reply_to = [(getattr(settings, "SUPPORT_EMAIL", "") or from_email).strip()]

        ctx = {"email": email, "source": source, "brand": "TRESSE"}

        email_sent = False
        try:
            text_body = render_to_string("emails/accounts/newsletter_welcome.txt", ctx).strip()
            html_body = render_to_string("emails/accounts/newsletter_welcome.html", ctx)

            msg = EmailMultiAlternatives(
                subject=subject,
                body=text_body,
                from_email=from_email,
                to=[email],
                reply_to=reply_to,
            )
            msg.attach_alternative(html_body, "text/html")
            msg.send(fail_silently=False)
            email_sent = True
        except Exception as e:
            logger.exception("Newsletter email send failed for %s: %s", email, str(e))

        return Response(
            {"ok": True, "created": created, "email": email, "email_sent": email_sent},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
