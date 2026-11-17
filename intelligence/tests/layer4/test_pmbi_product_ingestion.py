from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from app.layer4_medicine_intelligence.dataset_ingestion.dry_run import (
    DryRunEntry,
    run_official_dry_run,
)
from app.layer4_medicine_intelligence.dataset_ingestion.pmbi_product_sources import PmbiProductCatalogueAdapter
from app.layer4_medicine_intelligence.dataset_ingestion.catalogue_import_preparation import prepare_catalogue_import
from app.layer4_medicine_intelligence.dataset_ingestion.official_sources import get_official_source_adapter
from app.layer4_medicine_intelligence.dataset_ingestion.price_linkage import assess_price_linkages


URL = "https://janaushadhi.gov.in/product-portfolio/product-mrp-list"


def test_fixed_dose_combination_preserves_ingredient_specific_strengths(tmp_path: Path) -> None:
    path = _csv(tmp_path / "pmbi.csv", [
        ["1", "100", "Example A 10mg and Example B 20mg Tablets", "10's", "12.50", "Antibiotics"],
    ])
    export = tmp_path / "combination.json"
    entry = run_official_dry_run(
        path, source="india-pmbi-product-catalogue", release="2026-11-13",
        source_url=URL, export_path=export,
    ).accepted[0]
    medicine = _normalized_record(entry)
    assert medicine["prices"][0]["price_basis"] == "pmbi_listed_mrp"
    assert [(x["ingredient"]["ingredient_name"], str(x["ingredient_strength_value"])) for x in medicine["ingredients"]] == [("Example A", "10"), ("Example B", "20")]
    assert medicine["prices"][0]["quantity"] == 10
    assert medicine["prices"][0]["package_quantity_unit"] == "units"
    [decision] = assess_price_linkages(prepare_catalogue_import([export]))
    assert decision.status == "eligible"


def test_ambiguous_strength_does_not_assign_ingredient_strengths(tmp_path: Path) -> None:
    path = _csv(tmp_path / "ambiguous.csv", [
        ["1", "101", "Example A and Example B Tablets 10mg", "10's", "12.50", "Antibiotics"],
    ])
    entry = run_official_dry_run(path, source="india-pmbi-product-catalogue", release="2026-11-13", source_url=URL).accepted[0]
    normalized = _normalized_record(entry)
    assert not normalized["ingredients"]
    assert normalized["strength_value"] is None


def test_zero_mrp_is_preserved_as_source_value(tmp_path: Path) -> None:
    path = _csv(tmp_path / "zero.csv", [
        ["1", "102", "Example Eye Drops 2%", "10 ml Vial", "0", "Opthalmic/Otic"],
    ])
    price = _normalized_record(run_official_dry_run(
        path, source="india-pmbi-product-catalogue", release="2026-11-13", source_url=URL
    ).accepted[0])["prices"][0]
    assert str(price["price"]) == "0"
    assert price["price_basis"] == "pmbi_listed_mrp"
    assert price["quantity"] == 10
    assert price["package_quantity_unit"] == "mL"
    assert price["effective_date"] is None
    assert price["publication_date"] is None


def test_ambiguous_unit_size_remains_incomplete_for_linkage(tmp_path: Path) -> None:
    path = _csv(tmp_path / "ambiguous-pack.csv", [
        ["1", "104", "Example Medicine 10mg Tablets", "1 x 10", "12.50", "Antibiotics"],
    ])
    export = tmp_path / "ambiguous-pack.json"
    run_official_dry_run(
        path, source="india-pmbi-product-catalogue", release="2026-11-13",
        source_url=URL, export_path=export,
    )
    [decision] = assess_price_linkages(prepare_catalogue_import([export]))
    assert decision.status == "incomplete"


def test_indian_grouped_strength_is_parsed_without_changing_raw_name(tmp_path: Path) -> None:
    path = _csv(tmp_path / "grouped-strength.csv", [
        ["1", "103", "Example Injection 15,00,000 IU", "10 ml vial", "932.81", "Cardiovascular System (CVS)"],
    ])
    entry = run_official_dry_run(path, source="india-pmbi-product-catalogue", release="2026-11-13", source_url=URL).accepted[0]
    assert str(_normalized_record(entry)["strength_value"]) == "1500000"
    assert _source_fields(entry)["source_pmbi_generic_name"] == "Example Injection 15,00,000 IU"


def test_consumable_is_not_prepared_as_medicine_formulation(tmp_path: Path) -> None:
    path = _csv(tmp_path / "consumable.csv", [
        ["1", "5001", "Absorbent Cotton Wool IP 75 g", "1's", "27.19", "Surgical & Medical Consumables"],
    ])
    export = tmp_path / "export.json"
    run_official_dry_run(path, source="india-pmbi-product-catalogue", release="2026-11-13", source_url=URL, export_path=export)
    report = prepare_catalogue_import([export])
    kinds = {candidate.entity_type for candidate in report.candidates}
    assert "surgical_medical_consumable" in kinds
    assert "formulation" not in kinds


def test_required_source_columns_are_enforced(tmp_path: Path) -> None:
    path = tmp_path / "bad.csv"
    path.write_text("Drug Code,Generic Name\n1,Example\n", encoding="utf-8")
    try:
        PmbiProductCatalogueAdapter(release="2026-11-13").load(path)
    except ValueError as error:
        assert "missing required columns" in str(error).casefold()
    else:  # pragma: no cover
        raise AssertionError("expected schema validation error")


def _normalized_record(entry: DryRunEntry) -> dict[str, Any]:
    assert entry.normalized_record is not None
    return entry.normalized_record


def _source_fields(entry: DryRunEntry) -> dict[str, Any]:
    assert entry.source_fields is not None
    return entry.source_fields


def test_pmbi_adapter_is_registered_with_the_existing_official_source_registry() -> None:
    adapter = get_official_source_adapter(
        "india-pmbi-product-catalogue", release="2026-11-13", source_url=URL, input_format="csv"
    )
    assert isinstance(adapter, PmbiProductCatalogueAdapter)


def _csv(path: Path, rows: list[list[str]]) -> Path:
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["Sr No", "Drug Code", "Generic Name", "Unit Size", "MRP", "Group Name"])
        writer.writerows(rows)
    return path
