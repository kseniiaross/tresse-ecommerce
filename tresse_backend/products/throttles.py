from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class StockSubscribeAnonThrottle(AnonRateThrottle):
    scope = "stock_subscribe_anon"


class StockSubscribeUserThrottle(UserRateThrottle):
    scope = "stock_subscribe_user"
