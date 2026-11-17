from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

from app.layer4_medicine_intelligence.dataset_ingestion.catalogue_import_preparation import (
    CatalogueCandidate,
    prepare_catalogue_import,
)
from app.layer4_medicine_intelligence.dataset_ingestion.price_linkage import (
    assess_price_linkages,
)


def test_revised_mrp_links_only_with_exact_brand_manufacturer_and_package(
    tmp_path: Path,
) -> None:
    report = _report(
        tmp_path,
        dataset="india_nppa_anticancer_revised_mrp",
        record_id="nppa-anticancer-mrp:1",
        basis="revised_mrp",
        brand="FictionalBrand",
        manufacturer="Fictional Labs",
    )

    [decision] = assess_price_linkages(report)

    assert decision.status == "eligible"
    assert decision.formulation_candidate_id
    assert decision.package_candidate_id
    assert decision.product_candidate_id
    assert decision.product_identifier == "nppa-anticancer-mrp:1"


def test_pmbi_drug_code_and_unit_size_allow_zero_listed_mrp(tmp_path: Path) -> None:
    report = _report(
        tmp_path,
        dataset="india_pmbi_product_catalogue",
        record_id="pmbi-drug-code:001",
        basis="pmbi_listed_mrp",
        price="0",
        pmbi_code="001",
    )

    [decision] = assess_price_linkages(report)

    assert decision.status == "eligible"
    assert decision.product_candidate_id is None
    assert decision.product_identifier == "001"


def test_multiple_packages_are_ambiguous_even_when_their_text_matches(
    tmp_path: Path,
) -> None:
    report = _report(
        tmp_path,
        dataset="india_nppa_standard_ceiling_prices",
        record_id="nppa-standard:1",
        basis="ceiling_price_excluding_taxes",
        prices=[
            _price("ceiling_price_excluding_taxes", "12.00"),
            _price("ceiling_price_excluding_taxes", "13.00"),
        ],
    )

    decisions = assess_price_linkages(report)

    assert len(decisions) == 2
    assert {decision.status for decision in decisions} == {"ambiguous"}


def test_conflicting_package_and_incomplete_strength_are_rejected(
    tmp_path: Path,
) -> None:
    package_report = _report(
        tmp_path,
        dataset="india_nppa_standard_ceiling_prices",
        record_id="nppa-standard:2",
        basis="ceiling_price_excluding_taxes",
    )
    package = next(
        item for item in package_report.candidates
        if item.entity_type == "product_package"
    )
    package.identity["unit"] = "box"

    [package_decision] = assess_price_linkages(package_report)
    assert package_decision.status == "conflict"

    incomplete_report = _report(
        tmp_path,
        dataset="india_nppa_standard_ceiling_prices",
        record_id="nppa-standard:3",
        basis="ceiling_price_excluding_taxes",
        strength=None,
    )
    [strength_decision] = assess_price_linkages(incomplete_report)
    assert strength_decision.status == "incomplete"


def test_revised_product_strength_unit_must_match_exactly(tmp_path: Path) -> None:
    report = _report(
        tmp_path,
        dataset="india_nppa_anticancer_revised_mrp",
        record_id="nppa-anticancer-mrp:2",
        basis="revised_mrp",
        brand="FictionalBrand",
        manufacturer="Fictional Labs",
    )
    product = next(
        item for item in report.candidates if item.entity_type == "brand_product"
    )
    product.identity["formulation"] = deepcopy(product.identity["formulation"])
    product.identity["formulation"]["ingredients"][0]["strength_unit"] = "mcg"

    [decision] = assess_price_linkages(report)

    assert decision.status == "conflict"
    assert "same formulation" in decision.reason


def test_special_feature_price_requires_explicit_typed_qualifier(
    tmp_path: Path,
) -> None:
    report = _report(
        tmp_path,
        dataset="india_nppa_special_feature_ceiling_prices",
        record_id="nppa-special-feature:1",
        basis="special_feature_ceiling_price",
    )

    [decision] = assess_price_linkages(report)

    assert decision.status == "incomplete"
    assert "qualifier" in decision.reason

    qualified_price = _price("special_feature_ceiling_price", "12.50")
    qualified_price["special_feature_qualifier"] = "non-glass package"
    qualified_report = _report(
        tmp_path,
        dataset="india_nppa_special_feature_ceiling_prices",
        record_id="nppa-special-feature:2",
        basis="special_feature_ceiling_price",
        prices=[qualified_price],
    )
    [qualified_decision] = assess_price_linkages(qualified_report)
    assert qualified_decision.status == "eligible"

    package = next(
        item for item in qualified_report.candidates
        if item.entity_type == "product_package"
    )
    package.identity["special_feature_qualifier"] = "glass package"
    [conflict_decision] = assess_price_linkages(qualified_report)
    assert conflict_decision.status == "conflict"


def test_missing_package_quantity_or_revised_history_is_incomplete(
    tmp_path: Path,
) -> None:
    price = _price("ceiling_price_excluding_taxes", "12.50")
    price.pop("quantity")
    quantity_report = _report(
        tmp_path,
        dataset="india_nppa_standard_ceiling_prices",
        record_id="nppa-standard:6",
        basis="ceiling_price_excluding_taxes",
        prices=[price],
    )
    [quantity_decision] = assess_price_linkages(quantity_report)
    assert quantity_decision.status == "incomplete"
    assert "quantity" in quantity_decision.reason

    price = _price("ceiling_price_excluding_taxes", "12.50")
    price.pop("package_quantity_unit")
    unit_report = _report(
        tmp_path,
        dataset="india_nppa_standard_ceiling_prices",
        record_id="nppa-standard:7",
        basis="ceiling_price_excluding_taxes",
        prices=[price],
    )
    [unit_decision] = assess_price_linkages(unit_report)
    assert unit_decision.status == "incomplete"
    assert "unit" in unit_decision.reason

    revised_price = _price("revised_mrp", "12.50")
    revised_price.pop("previous_value")
    revised_report = _report(
        tmp_path,
        dataset="india_nppa_anticancer_revised_mrp",
        record_id="nppa-anticancer-mrp:6",
        basis="revised_mrp",
        brand="FictionalBrand",
        manufacturer="Fictional Labs",
        prices=[revised_price],
    )
    [revised_decision] = assess_price_linkages(revised_report)
    assert revised_decision.status == "incomplete"
    assert "previous MRP" in revised_decision.reason


def test_conflicting_source_replay_blocks_an_otherwise_complete_match(
    tmp_path: Path,
) -> None:
    report = _report(
        tmp_path,
        dataset="india_nppa_standard_ceiling_prices",
        record_id="nppa-standard:4",
        basis="ceiling_price_excluding_taxes",
    )
    report.conflicting_replays.append({
        "stable_id": report.source_records[0].stable_id,
        "first_hash": "first",
        "replay_hash": "different",
    })

    [decision] = assess_price_linkages(report)

    assert decision.status == "conflict"


def test_same_name_in_another_source_record_is_not_a_match(tmp_path: Path) -> None:
    report = _report(
        tmp_path,
        dataset="india_nppa_standard_ceiling_prices",
        record_id="nppa-standard:5",
        basis="ceiling_price_excluding_taxes",
    )
    price_source_id = report.source_records[0].stable_id
    formulation = next(
        item for item in report.candidates if item.entity_type == "formulation"
    )
    report.candidates.remove(formulation)
    other_formulation = CatalogueCandidate(
        candidate_id="other-source-formulation",
        source_record_stable_id="different-source-record",
        entity_type="formulation",
        identity=formulation.identity,
        evidence={},
    )
    report.candidates.append(other_formulation)

    [decision] = assess_price_linkages(report)

    assert decision.source_record_stable_id == price_source_id
    assert decision.status == "unmatched"
    assert decision.formulation_candidate_id is None


def _report(
    tmp_path: Path,
    *,
    dataset: str,
    record_id: str,
    basis: str,
    price: str = "12.50",
    prices: list[dict[str, str]] | None = None,
    brand: str | None = None,
    manufacturer: str | None = None,
    pmbi_code: str | None = None,
    strength: str | None = "10",
):
    source_fields: dict[str, str] = {}
    if manufacturer:
        source_fields["manufacturer_name"] = manufacturer
    if pmbi_code:
        source_fields["source_pmbi_drug_code"] = pmbi_code
        source_fields["source_pmbi_product_kind"] = "medicine_product"

    payload = {
        "release": "fictional-release",
        "accepted": [{
            "normalized_record": {
                "canonical_name": "Fictional ingredient 10 mg Tablet",
                "dosage_form": "tablet",
                "brand_name": brand,
                "ingredients": [{
                    "ingredient": {
                        "ingredient_name": "Fictional ingredient",
                        "normalized_name": "fictional ingredient",
                    },
                    "ingredient_strength_value": strength,
                    "ingredient_strength_unit": "mg",
                }],
                "prices": prices or [_price(basis, price, record_id)],
                "sources": [{
                    "source_dataset": dataset,
                    "source_release": "fictional-release",
                    "source_record_id": record_id,
                    "source_record_hash": f"hash-{record_id}",
                }],
            },
            "source_fields": source_fields,
        }],
    }
    if prices:
        for item in prices:
            item.setdefault("source_record_id", record_id)

    path = tmp_path / f"{record_id.replace(':', '-')}.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return prepare_catalogue_import([path])


def _price(basis: str, amount: str, record_id: str | None = None) -> dict[str, str]:
    price = {
        "price": amount,
        "currency": "INR",
        "price_basis": basis,
        "package_description": "10 tablets",
        "price_unit": "10 tablets",
        "package_quantity_unit": "tablets",
        "quantity": "10",
    }
    if record_id:
        price["source_record_id"] = record_id
    if basis in {"ceiling_price_excluding_taxes", "special_feature_ceiling_price"}:
        price["notification_number"] = "S.O. fictional"
        price["notification_date"] = "2026-11-09"
    if basis == "revised_mrp":
        price["effective_date"] = "2026-11-09"
        price["publication_date"] = "2026-11-11"
        price["previous_value"] = "10.00"
    return price
