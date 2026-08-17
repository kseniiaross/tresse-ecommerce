from django.contrib.auth.models import AnonymousUser
from django.http import HttpResponse


class AuthenticationMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path == "/favicon.ico":
            return HttpResponse(status=204)
        if hasattr(request, "user") and isinstance(request.user, AnonymousUser):
            if (
                request.path.startswith("/api/register")
                or request.path.startswith("/api/login")
                or request.path.startswith("/api/products")
                or request.path.startswith("/api/reviews")
            ):
                return self.get_response(request)

        response = self.get_response(request)
        return response
