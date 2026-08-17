from rest_framework import serializers


class NewsletterSubscribeSerializer(serializers.Serializer):
    email = serializers.EmailField()
    source = serializers.CharField(required=False, allow_blank=True, max_length=32)
