from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class StripeIntentAnonThrottle(AnonRateThrottle):
    scope = "stripe_intent_anon"


class StripeIntentUserThrottle(UserRateThrottle):
    scope = "stripe_intent_user"
