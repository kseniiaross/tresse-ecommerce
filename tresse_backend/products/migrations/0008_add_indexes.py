from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0007_fill_category_slugs"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="product",
            index=models.Index(fields=["created_at"], name="product_created_idx"),
        ),
        migrations.AddIndex(
            model_name="product",
            index=models.Index(fields=["price"], name="product_price_idx"),
        ),
    ]
