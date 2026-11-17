from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from typing import Any, NoReturn

import pymupdf

from app.layer4_medicine_intelligence.dataset_ingestion.dry_run import (
    DryRunEntry,
    run_official_dry_run,
)
from app.layer4_medicine_intelligence.dataset_ingestion.catalogue_import_preparation import prepare_catalogue_import
from app.layer4_medicine_intelligence.dataset_ingestion.nppa_anticancer_mrp import (
    NppaAntiCancerRevisedMrpPdfAdapter,
    summarize_nppa_mrp_collisions,
)
from app.layer4_medicine_intelligence.dataset_ingestion.official_sources import (
    get_official_source_adapter,
)
from app.layer4_medicine_intelligence.dataset_ingestion.price_linkage import assess_price_linkages


def test_pdf_adapter_preserves_mrp_history_without_assuming_publication_date(tmp_path: Path) -> None:
    pdf = _pdf(tmp_path / "prices.pdf", [[
        ("1", "Example Pharma\nPrivate Limited", "Examplemab", "100 mg Injection",
         "EXAMPLE 100", "1 vial", "12,345.67", "2,345.60"),
    ]])
    export = tmp_path / "prices.json"
    report = run_official_dry_run(
        pdf,
        source="india-nppa-anticancer-revised-mrp",
        release="2026-11-11",
        export_path=export,
    )
    assert len(report.accepted) == 1
    entry = report.accepted[0]
    normalized = _normalized_record(entry)
    assert normalized["brand_name"] == "EXAMPLE 100"
    assert normalized["dosage_form"].casefold() == "injection"
    price = normalized["prices"][0]
    assert price["price"] == Decimal("2345.60")
    assert price["previous_price"] == Decimal("12345.67")
    assert price["quantity"] == Decimal("1")
    assert price["package_quantity_unit"] == "vials"
    assert price["price_basis"] == "revised_mrp"
    assert price["effective_date"] == "2026-11-09"
    assert price["publication_date"] is None
    source_fields = _source_fields(entry)
    assert source_fields["source_nppa_company"] == "Example Pharma Private Limited"
    assert source_fields["source_nppa_pack_size"] == "1 vial"
    assert source_fields["source_pdf_page"] == 1
    assert len(source_fields["source_pdf_sha256"]) == 64
    assert source_fields["source_nppa_is_ceiling_price"] is False
    [decision] = assess_price_linkages(prepare_catalogue_import([export]))
    assert decision.status == "incomplete"
    assert decision.reason == "revised MRP lacks its effective/publication date or previous MRP"


def test_ambiguous_pack_size_is_not_converted_to_a_quantity(tmp_path: Path) -> None:
    pdf = _pdf(tmp_path / "ambiguous-pack.pdf", [[
        ("1", "Example Pharma", "Examplemab", "100 mg Injection",
         "EXAMPLE 100", "1 x 10", "100.00", "80.00"),
    ]])
    export = tmp_path / "ambiguous-pack.json"
    run_official_dry_run(
        pdf, source="india-nppa-anticancer-revised-mrp",
        release="2026-11-11", export_path=export,
    )
    [decision] = assess_price_linkages(prepare_catalogue_import([export]))
    assert decision.status == "incomplete"


def test_multi_page_rows_and_continuations_are_extracted_once(tmp_path: Path) -> None:
    pdf = _pdf(tmp_path / "multi.pdf", [
        [("1", "Long Company\nName Limited", "Drug A", "10 mg Tablet", "BRAND A",
          "Bottle of 30\ntablets", "100.00", "80.00")],
        [("2", "Second Company", "Drug B", "20 mg Capsule", "BRAND B",
          "1 x 10", "200.00", "150.00")],
    ])
    records = NppaAntiCancerRevisedMrpPdfAdapter(release="2026-11-11").load(pdf)
    assert [item.raw_record.source.source_record_id for item in records] == [
        "nppa-anticancer-mrp:1", "nppa-anticancer-mrp:2"
    ]
    assert records[0].raw_record.data["source_nppa_company"] == "Long Company Name Limited"
    assert records[0].raw_record.data["source_nppa_pack_size"] == "Bottle of 30 tablets"
    assert records[1].raw_record.data["source_pdf_page"] == 2


def test_missing_or_ambiguous_money_is_rejected_without_fabrication(tmp_path: Path) -> None:
    pdf = _pdf(tmp_path / "missing.pdf", [[
        ("1", "Example Pharma", "Drug A", "10 mg Tablet", "BRAND A", "10",
         "not available", "80.00"),
    ]])
    report = run_official_dry_run(
        pdf, source="india-nppa-anticancer-revised-mrp", release="2026-11-11"
    )
    assert not report.accepted
    assert len(report.rejected) == 1
    assert "Old MRP is not an unambiguous INR monetary value." in report.rejected[0].issues


def test_pack_distinctions_and_price_conflicts_are_preserved(tmp_path: Path) -> None:
    pdf = _pdf(tmp_path / "collisions.pdf", [[
        ("1", "Example Pharma", "Drug A", "10 mg Tablet", "BRAND A", "10",
         "100.00", "80.00"),
        ("2", "Example Pharma", "Drug A", "10 mg Tablet", "BRAND A", "10",
         "100.00", "80.00"),
        ("3", "Example Pharma", "Drug A", "10 mg Tablet", "BRAND A", "10",
         "110.00", "85.00"),
        ("4", "Example Pharma", "Drug A", "10 mg Tablet", "BRAND A", "20",
         "150.00", "120.00"),
    ]])
    records = NppaAntiCancerRevisedMrpPdfAdapter(release="2026-11-11").load(pdf)
    summary = summarize_nppa_mrp_collisions(records)
    assert len(summary.conflicting_prices) == 1
    assert not summary.exact_duplicates
    assert records[3].raw_record.data["source_nppa_pack_size"] == "20"


def test_registry_selects_pdf_adapter_and_loading_is_offline(tmp_path: Path, monkeypatch) -> None:
    pdf = _pdf(tmp_path / "offline.pdf", [[
        ("1", "Example Pharma", "Drug A", "10 mg Tablet", "BRAND A", "10",
         "100.00", "80.00"),
    ]])
    monkeypatch.setattr("socket.create_connection", _raise_on_network)
    adapter = get_official_source_adapter(
        "india-nppa-anticancer-revised-mrp", release="2026-11-11", input_format="pdf"
    )
    assert isinstance(adapter, NppaAntiCancerRevisedMrpPdfAdapter)
    [record] = adapter.load(pdf)
    assert record.raw_record.source.source_url == (
        "https://nppa.gov.in/storage/uploads/tender/"
        "revised-mrp-information-11112026-1-11-11-2026.pdf"
    )


def _normalized_record(entry: DryRunEntry) -> dict[str, Any]:
    assert entry.normalized_record is not None
    return entry.normalized_record


def _source_fields(entry: DryRunEntry) -> dict[str, Any]:
    assert entry.source_fields is not None
    return entry.source_fields


def _raise_on_network(*args: object, **kwargs: object) -> NoReturn:
    raise AssertionError(f"Network call attempted with args={args!r}, kwargs={kwargs!r}")


def _pdf(path: Path, pages: list[list[tuple[str, ...]]]) -> Path:
    document = pymupdf.open()
    for page_index, rows in enumerate(pages):
        page = document.new_page(width=792, height=612)
        if page_index == 0:
            page.insert_text((140, 35), "Revised MRP of Non-Scheduled Anti-Cancer Drugs", fontsize=11)
        y = 100.0
        for row in rows:
            for x, value in zip((75, 108, 229, 311, 390, 551, 625, 700), row):
                for offset, line in enumerate(value.splitlines()):
                    page.insert_text((x, y + offset * 11), line, fontsize=9)
            y += max(26, (max(value.count("\n") for value in row) + 1) * 12)
    document.save(path)
    document.close()
    return path
