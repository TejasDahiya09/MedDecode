from decimal import Decimal

from app.layer4_medicine_intelligence.dataset_ingestion.models import PriceRecord
from app.layer4_medicine_intelligence.dataset_ingestion.transformer import transform_prices


def test_price_transformation_does_not_merge_distinct_source_observations() -> None:
    common = {
        "price": Decimal("12.50"),
        "currency": "INR",
        "country": "India",
        "package_description": "10 tablets",
        "quantity": Decimal("10"),
        "package_quantity_unit": "tablets",
    }
    observations = [
        PriceRecord(
            **common,
            source="nppa",
            price_basis="ceiling_price_excluding_taxes",
            source_record_id="nppa-standard:1",
        ),
        PriceRecord(
            **common,
            source="pmbi",
            price_basis="pmbi_listed_mrp",
            source_record_id="pmbi-drug-code:1",
        ),
    ]

    transformed = transform_prices(observations)

    assert len(transformed) == 2
    assert [item.price_basis for item in transformed] == [
        "ceiling_price_excluding_taxes",
        "pmbi_listed_mrp",
    ]
