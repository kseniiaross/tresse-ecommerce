from rest_framework.throttling import AnonRateThrottle


class NewsletterAnonThrottle(AnonRateThrottle):
    scope = "newsletter_anon"
