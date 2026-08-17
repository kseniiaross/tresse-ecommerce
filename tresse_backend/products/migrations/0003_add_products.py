from django.db import migrations


def create_products(apps, schema_editor):
    Product = apps.get_model("products", "Product")
    Category = apps.get_model("products", "Category")
    Size = apps.get_model("products", "Size")
    ProductSize = apps.get_model("products", "ProductSize")

    category_names = ["WOMAN", "MAN", "KIDS", "THE NEW", "BESTSELLERS", "EXCLUSIVES"]
    categories = {}

    for name in category_names:
        category_obj, _ = Category.objects.get_or_create(name=name)
        categories[name] = category_obj

    sizes = {size.name: size for size in Size.objects.all()}

    products_data = [
        {
            "name": "Knitted Crop Top",
            "description": "Handmade knitted crop top, perfect for layering",
            "price": "399.99",
            "available": True,
            "category": "WOMAN",
            "sizes": ["S", "M", "L"],
        },
        {
            "name": "Men's Knit Sweater",
            "description": "Thick and cozy sweater with ribbed structure",
            "price": "499.99",
            "available": True,
            "category": "MAN",
            "sizes": ["S", "M", "L"],
        },
        {
            "name": "Kids' Knit Hat",
            "description": "Warm beanie with playful pom-pom for kids",
            "price": "499.99",
            "available": True,
            "category": "KIDS",
            "sizes": ["S", "M"],
        },
        {
            "name": "New Collection: Knitted Cardigan",
            "description": "Trendy oversized cardigan from our last drop",
            "price": "399.99",
            "available": True,
            "category": "THE NEW",
            "sizes": ["S", "M", "L"],
        },
        {
            "name": "Exclusive Chunky Knit Scarf",
            "description": "Limited edition chunky scarf with unique texture",
            "price": "399.99",
            "available": True,
            "category": "EXCLUSIVES",
            "sizes": ["One Size"],
        },
    ]

    for product_data in products_data:
        category = categories.get(product_data["category"])
        product = Product.objects.create(
            name=product_data["name"],
            description=product_data["description"],
            price=product_data["price"],
            available=product_data["available"],
            category=category,
        )

        for size_name in product_data["sizes"]:
            size = sizes.get(size_name)
            if size:
                ProductSize.objects.create(product=product, size=size)


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0002_add_size_data"),
    ]

    operations = [
        migrations.RunPython(create_products),
    ]
