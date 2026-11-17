from __future__ import annotations

import json
from pathlib import Path

from app.layer4_medicine_intelligence.dataset_ingestion.catalogue_import_preparation import (
    prepare_catalogue_import,
)


def test_source_identity_is_stable_and_duplicate_replay_is_idempotent(tmp_path: Path) -> None:
    path = _export(tmp_path / "one.json", [_record("source-a", "v1", "r1")])
    report = prepare_catalogue_import([path, path])
    assert len(report.source_records) == 1
    assert len(report.duplicate_replays) == 1
    assert not report.conflicting_replays


def test_same_source_identity_with_changed_content_is_conflict(tmp_path: Path) -> None:
    first = _export(tmp_path / "first.json", [_record("source-a", "v1", "r1", name="Example A")])
    second_record = _record("source-a", "v1", "r1", name="Example B")
    second_record["normalized_record"]["sources"][0]["source_record_hash"] = "changed"
    second = _export(tmp_path / "second.json", [second_record])
    report = prepare_catalogue_import([first, second])
    assert len(report.conflicting_replays) == 1


def test_ceiling_price_and_mrp_remain_distinct(tmp_path: Path) -> None:
    ceiling = _record("nppa-ceiling", "2026", "c1", price_basis="ceiling_price_excluding_taxes")
    mrp = _record("nppa-mrp", "2026", "m1", price_basis="revised_mrp")
    report = prepare_catalogue_import([_export(tmp_path / "prices.json", [ceiling, mrp])])
    bases = {c.identity["price_basis"] for c in report.candidates if c.entity_type == "price_observation"}
    assert bases == {"ceiling_price_excluding_taxes", "revised_mrp"}


def test_exact_link_requires_ingredient_strength_and_form(tmp_path: Path) -> None:
    a = _record("rxnorm", "v1", "a")
    b = _record("nlem", "v1", "b")
    incomplete = _record("nlem", "v1", "c")
    incomplete["normalized_record"]["ingredients"][0]["ingredient_strength_value"] = None
    report = prepare_catalogue_import([_export(tmp_path / "links.json", [a, b, incomplete])])
    assert sum(link.status == "exact" for link in report.linkages) == 1
    assert sum(link.status == "uncertain" for link in report.linkages) == 1


def test_regulatory_event_keeps_provenance_and_no_current_status_claim(tmp_path: Path) -> None:
    event = {
        "event_id": "prohibited:abc:1:2024-01-01",
        "event_type": "regulatory-restriction-notice",
        "regulatory_category": "prohibited",
        "effective_date": "2024-01-01",
        "restricted_name": "Example A + Example B",
        "establishes_current_status": False,
        "raw_source_text": "official row evidence",
        "source": {"source_dataset": "cdsco_prohibited_notices", "source_record_id": "p1", "source_release": "2024", "source_record_hash": "hash"},
    }
    report = prepare_catalogue_import([_export(tmp_path / "event.json", [event])])
    candidate = next(item for item in report.candidates if item.entity_type == "regulatory_event")
    assert candidate.evidence["establishes_current_status"] is False
    assert candidate.evidence["raw_source_text"] == "official row evidence"


def _export(path: Path, records: list[dict]) -> Path:
    path.write_text(json.dumps({"release": "v1", "accepted": records}), encoding="utf-8")
    return path


def _record(dataset: str, release: str, record_id: str, *, name: str = "Example A", price_basis: str | None = None) -> dict:
    normalized = {
        "canonical_name": f"{name} 10 mg Tablet",
        "dosage_form": "Tablet",
        "brand_name": None,
        "ingredients": [{
            "ingredient": {"ingredient_name": name, "normalized_name": name.casefold()},
            "ingredient_strength_value": "10", "ingredient_strength_unit": "mg",
        }],
        "sources": [{
            "source_dataset": dataset, "source_release": release,
            "source_record_id": record_id, "source_record_hash": f"hash-{dataset}-{record_id}",
        }],
    }
    if price_basis:
        normalized["prices"] = [{
            "price": "10.00", "currency": "INR", "price_basis": price_basis,
            "package_description": "10 tablets", "price_unit": "pack",
            "source_record_id": record_id,
        }]
    return {"normalized_record": normalized, "source_fields": {}}
