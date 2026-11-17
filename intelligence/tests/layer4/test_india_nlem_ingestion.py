from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from app.layer4_medicine_intelligence.dataset_ingestion.nlem_rxnorm_matching import (
    compare_nlem_to_rxnorm,
)
from app.layer4_medicine_intelligence.dataset_ingestion.official_sources import (
    IndiaNlem2022PdfAdapter,
    _nlem_ingredients,
    _parse_nlem_formulation,
    _split_nlem_formulations,
    get_official_source_adapter,
)


class _Table:
    def __init__(self, rows):
        self._rows = rows

    def extract(self):
        return self._rows


class _Page:
    def __init__(self, tables):
        self._tables = tables

    def find_tables(self):
        return SimpleNamespace(tables=[_Table(rows) for rows in self._tables])


class _Document(list):
    def close(self):
        pass


def test_nlem_pdf_adapter_preserves_sections_pages_formulations_and_fdc(tmp_path: Path, monkeypatch) -> None:
    pdf = tmp_path / "nlem.pdf"
    pdf.write_bytes(b"%PDF-fictional-test")
    rows = [
        ["Section 6 - Anti-infective Medicines", None, None, None],
        ["6.1- Antibacterial medicines", None, None, None],
        ["", "Medicine", "Level of Healthcare", "Dosage form(s) and strength(s)"],
        ["6.1.1", "Example A (A) + Example B (B)", "P,S,T", "Tablet 10 mg (A) + 5 mg (B)\nOral liquid 2 mg/mL (A) + 1 mg/mL (B)"],
        ["6.1.2", "No-strength medicine", "S,T", "As licensed for medical purpose"],
    ]
    monkeypatch.setitem(__import__("sys").modules, "pymupdf", SimpleNamespace(open=lambda _path: _Document([_Page([rows])])))

    adapter = IndiaNlem2022PdfAdapter(release="2022", source_url="https://example.gov/nlem.pdf")
    records = adapter.load(pdf)
    assert len(records) == 3
    first = records[0].raw_record
    assert first.source.source_record_id == "6.1.1:f1"
    assert first.source.source_authority == "Ministry of Health and Family Welfare, Government of India"
    assert first.data["source_document_page"] == 1
    assert first.data["source_nlem_section_number"] == "6.1"
    assert first.data["source_nlem_section_title"] == "Antibacterial medicines"
    assert first.data["ingredients"] == "Example A|Example B"
    assert first.data["ingredient_strength"] == "10|5"
    assert first.data["ingredient_strength_unit"] == "mg|mg"
    assert records[2].raw_record.data["dosage_form"] is None
    assert records[2].raw_record.data["strength_value"] is None
    assert records[2].issues == ()


def test_formulation_parser_never_copies_one_strength_across_multiple_ingredients() -> None:
    ingredients = _nlem_ingredients("Example A (A) + Example B (B)")
    parsed = _parse_nlem_formulation("Tablet 10 mg", ingredients)
    assert ingredients == ["Example A", "Example B"]
    assert parsed["ingredient_strength_values"] == []
    assert parsed["ingredient_strength_units"] == []
    assert _split_nlem_formulations("Tablet 10 mg Injection 5 mg/mL") == [
        "Tablet 10 mg", "Injection 5 mg/mL"
    ]


def test_registry_uses_existing_official_source_boundary() -> None:
    adapter = get_official_source_adapter(
        "india-nlem-2022", release="2022", input_format="pdf"
    )
    assert isinstance(adapter, IndiaNlem2022PdfAdapter)


def test_rxnorm_comparison_separates_exact_uncertain_and_unmatched(tmp_path: Path) -> None:
    nlem = {"accepted": [
        _entry("Exact A", "Tablet", "10", "mg"),
        _entry("Uncertain A", "Capsule", "10", "mg"),
        _entry("India only", "Tablet", "5", "mg"),
    ]}
    rxnorm_path = tmp_path / "rxnorm.json"
    rxnorm_path.write_text(json.dumps({"accepted": [
        _rx_entry("1", "Exact A", "Tablet", "10", "mg"),
        _rx_entry("2", "Uncertain A", "Tablet", "10", "mg"),
    ]}), encoding="utf-8")
    payload, counts = compare_nlem_to_rxnorm(nlem, rxnorm_path)
    assert (counts.exact, counts.uncertain, counts.unmatched) == (1, 1, 1)
    assert [item["rxnorm_comparison"]["status"] for item in payload["accepted"]] == [
        "exact", "uncertain", "unmatched"
    ]
    assert all(item["rxnorm_comparison"]["does_not_imply_india_approval_or_availability"]
               for item in payload["accepted"])


def test_adapter_has_no_network_or_database_dependency(monkeypatch, tmp_path: Path) -> None:
    pdf = tmp_path / "nlem.pdf"
    pdf.write_bytes(b"%PDF-fictional-test")
    monkeypatch.setitem(__import__("sys").modules, "pymupdf", SimpleNamespace(open=lambda _path: _Document([])))
    monkeypatch.setattr("socket.create_connection", lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("network")))
    assert IndiaNlem2022PdfAdapter(release="2022").load(pdf) == []


def _entry(name: str, form: str, value: str, unit: str) -> dict:
    return {"normalized_record": {
        "generic_name": name, "dosage_form": form,
        "ingredients": [{"ingredient": {"ingredient_name": name},
                         "ingredient_strength_value": value,
                         "ingredient_strength_unit": unit}],
    }}


def _rx_entry(cui: str, name: str, form: str, value: str, unit: str) -> dict:
    entry = _entry(name, form, value, unit)
    entry["source_record_id"] = f"aui-{cui}"
    entry["source_fields"] = {"source_rxnorm_cui": cui}
    entry["normalized_record"]["canonical_name"] = f"{name} {value} {unit} {form}"
    return entry
