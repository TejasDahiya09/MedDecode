from pathlib import Path

import pymupdf

from app.layer4_medicine_intelligence.dataset_ingestion.cdsco_restriction_sources import (
    CdscoRestrictionPdfAdapter,
)


URL = "https://cdsco.gov.in/opencms/opencms/en/Drugs/FDC/"


def test_multi_ingredient_restriction_preserves_exact_scope_and_strengths(tmp_path: Path) -> None:
    pdf = _pdf(tmp_path / "restriction.pdf", [
        ["S. No.", "Drugs Name", "Notification No. & Date"],
        ["1.", "Example A 10mg + Example B 20mg hard gelatin Capsules", "S.O. 1234(E) Dated 12.08.2024"],
    ])
    report = _adapter("restricted").load(pdf)
    event = report.accepted[0]
    assert event.effective_date == "2024-08-12"
    assert event.notification_reference == "S.O. 1234(E)"
    assert event.dosage_form == "hard gelatin Capsules"
    assert [(x["name"], x["strength_value"]) for x in event.ingredients] == [("Example A", "10"), ("Example B", "20")]
    assert event.establishes_current_status is False


def test_historical_footnote_condition_and_exemption_are_preserved(tmp_path: Path) -> None:
    pdf = _pdf(tmp_path / "historical.pdf", [
        ["Sr. No.", "Drugs Name", "Notification No. & Date"],
        ["1.", "6# Example A except preparations meant for external use", "GSR NO. 578(E) Dated 23.07.1983"],
    ], extra="6# Prohibition was revoked subject to a labelled warning condition.")
    report = _adapter("historical-prohibition").load(pdf)
    event = report.accepted[0]
    assert event.footnote_marker == "6"
    assert "revoked" in (event.conditions or "")
    assert "except preparations" in (event.exemptions or "")
    assert event.document_as_of_date == "2021-11-22"


def test_missing_notification_date_is_deferred(tmp_path: Path) -> None:
    pdf = _pdf(tmp_path / "missing-date.pdf", [
        ["S. No.", "Drugs Name", "Notification No. & Date"],
        ["1.", "Example A + Example B", "S.O. 1234(E)"],
    ])
    report = _adapter("prohibited").load(pdf)
    assert not report.accepted
    assert len(report.deferred) == 1


def test_source_provenance_is_complete(tmp_path: Path) -> None:
    pdf = _pdf(tmp_path / "provenance.pdf", [
        ["S. No.", "Drugs Name", "Notification No. & Date"],
        ["1.", "Example A + Example B", "S.O. 1234(E) Dated 02.06.2023"],
    ])
    event = _adapter("prohibited").load(pdf).accepted[0]
    assert len(event.source_document_sha256 or "") == 64
    assert event.source_page == 1 and event.source_row == 2
    assert event.raw_source_text and event.source and event.source.source_record_hash


def _adapter(category: str) -> CdscoRestrictionPdfAdapter:
    return CdscoRestrictionPdfAdapter(category=category, release="2024-08-12", source_url=URL)


def _pdf(path: Path, rows: list[list[str]], *, extra: str = "") -> Path:
    document = pymupdf.open()
    page = document.new_page(width=792, height=612)
    widths = (40, 110, 570, 750)
    for row_index, row in enumerate(rows):
        for column in range(3):
            rect = pymupdf.Rect(widths[column], 50 + row_index * 70, widths[column + 1], 120 + row_index * 70)
            page.draw_rect(rect)
            page.insert_textbox(rect + (3, 3, -3, -3), row[column], fontsize=7)
    if extra:
        page.insert_text((50, 300), extra, fontsize=8)
    document.save(path)
    document.close()
    return path
