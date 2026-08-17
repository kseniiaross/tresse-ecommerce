from django.db.models import Exists, OuterRef
from django_filters import rest_framework as filters

from .models import Product, ProductSize


class ProductFilter(filters.FilterSet):
    """
    Filters for Product list endpoint.

    Supported query params:
    - category (slug or aliases: women/woman, men/man, kids)
    - available (boolean)
    - in_stock (boolean)
    - min_price
    - max_price
    - collection (collection slug)
    """

    category = filters.CharFilter(method="filter_category")
    available = filters.BooleanFilter(field_name="available")
    in_stock = filters.BooleanFilter(method="filter_in_stock")
    min_price = filters.NumberFilter(field_name="price", lookup_expr="gte")
    max_price = filters.NumberFilter(field_name="price", lookup_expr="lte")
    collection = filters.CharFilter(field_name="collections__slug", lookup_expr="iexact")

    class Meta:
        model = Product
        fields = [
            "category",
            "available",
            "in_stock",
            "min_price",
            "max_price",
            "collection",
        ]

    def filter_category(self, queryset, name, value):
        """
        Accepts category as slug or common aliases.

        Examples:
        - woman / women / womens -> woman
        - man / men / mens       -> man
        - kid / kids             -> kids
        """
        if not value:
            return queryset

        v = str(value).strip().lower()

        aliases = {
            "women": "woman",
            "womens": "woman",
            "woman": "woman",
            "men": "man",
            "mens": "man",
            "man": "man",
            "kid": "kids",
            "kids": "kids",
        }

        slug = aliases.get(v, v)
        return queryset.filter(category__slug__iexact=slug)

    def filter_in_stock(self, queryset, name, value):
        """
        in_stock=true  -> products that have at least one ProductSize with quantity > 0
        in_stock=false -> products that have NO sizes in stock
        """
        if value is None:
            return queryset

        stock_subquery = ProductSize.objects.filter(
            product_id=OuterRef("pk"),
            quantity__gt=0,
        )

        queryset = queryset.annotate(_has_stock=Exists(stock_subquery))

        return queryset.filter(_has_stock=value)
