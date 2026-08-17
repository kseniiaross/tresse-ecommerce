from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class LoginAnonThrottle(AnonRateThrottle):
    scope = "login_anon"


class LoginUserThrottle(UserRateThrottle):
    scope = "login_user"


class RegisterAnonThrottle(AnonRateThrottle):
    scope = "register_anon"


class RegisterUserThrottle(UserRateThrottle):
    scope = "register_user"
