from decimal import Decimal

from app.layer4_medicine_intelligence.dataset_ingestion.package_quantity import (
    parse_explicit_package_quantity,
)


def test_parses_only_complete_explicit_package_quantities() -> None:
    tablet = parse_explicit_package_quantity("1 Tablet")
    assert tablet is not None
    assert (tablet.quantity, tablet.unit) == (Decimal("1"), "tablets")

    bottle = parse_explicit_package_quantity("Bottle of 30 tablets")
    assert bottle is not None
    assert (bottle.quantity, bottle.unit) == (Decimal("30"), "tablets")

    count = parse_explicit_package_quantity("10's", allow_count_shorthand=True)
    assert count is not None
    assert (count.quantity, count.unit) == (Decimal("10"), "units")

    volume = parse_explicit_package_quantity("10 ml Vial")
    assert volume is not None
    assert (volume.quantity, volume.unit) == (Decimal("10"), "mL")


def test_special_feature_qualifier_is_retained_and_ambiguous_pack_text_rejected() -> None:
    parsed = parse_explicit_package_quantity(
        "500ml Non Glass with special features", special_feature=True
    )
    assert parsed is not None
    assert parsed.quantity == Decimal("500")
    assert parsed.unit == "mL"
    assert parsed.special_feature_qualifier == "Non Glass with special features"

    assert parse_explicit_package_quantity("1 x 10") is None
    assert parse_explicit_package_quantity("30") is None
    assert parse_explicit_package_quantity("10's") is None
    assert parse_explicit_package_quantity(
        "500ml Non Glass with special features"
    ) is None
