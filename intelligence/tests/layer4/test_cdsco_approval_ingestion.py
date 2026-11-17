from __future__ import annotations

from pathlib import Path

import pymupdf
import pytest

from app.layer4_medicine_intelligence.dataset_ingestion.cdsco_approval_sources import (
    CdscoApprovalEventPdfAdapter,
    get_cdsco_approval_adapter,
)
from app.layer4_medicine_intelligence.dataset_ingestion.official_sources import (
    OfficialSourceSchemaError,
)


OFFICIAL_URL = "https://cdsco.gov.in/opencms/opencms/en/Approval_new/Approved-New-Drugs/"


def test_new_drug_event_preserves_source_evidence_without_current_status_claim(tmp_path: Path) -> None:
    pdf = _table_pdf(tmp_path / "new-drugs.pdf", [[
        "1.", "Examplemab Tablets 10 mg", "For a fictional test indication", "16.02.2026"
    ]])
    report = CdscoApprovalEventPdfAdapter(
        category="new-drug", release="2026-03-12", source_url=OFFICIAL_URL
    ).load(pdf)
    assert report.total == 1
    assert len(report.accepted) == 1
    event = report.accepted[0]
    assert event.approved_name == "Examplemab Tablets 10 mg"
    assert event.approval_date == "2026-02-16"
    assert event.permission_category == "new-drug"
    assert event.is_fdc is False
    assert event.establishes_current_status is False
    assert event.source_page == 1
    assert len(event.source_document_sha256 or "") == 64
    assert event.raw_source_text


def test_fdc_event_preserves_explicit_ingredient_strengths_and_fdc_category(tmp_path: Path) -> None:
    pdf = _table_pdf(tmp_path / "fdc.pdf", [[
        "1.", "Example A 10mg + Example B 20mg film coated tablet",
        "Fictional indication", "25-11-24"
    ]], name_header="Name of FDC")
    report = get_cdsco_approval_adapter(
        "cdsco-fdc-marketing-permissions",
        release="2025-04-07",
        source_url="https://cdsco.gov.in/opencms/opencms/en/Approval_new/FDC-New-Drugs-Marketing/",
    ).load(pdf)
    event = report.accepted[0]
    assert event.is_fdc is True
    assert event.permission_category == "fdc-marketing-permission"
    assert event.approval_date == "2024-11-25"
    assert [(item["name"], item["strength_value"], item["strength_unit"].casefold())
            for item in event.ingredients] == [
        ("Example A", "10", "mg"), ("Example B", "20", "mg")
    ]


def test_missing_or_unclear_approval_date_is_deferred_not_fabricated(tmp_path: Path) -> None:
    pdf = _table_pdf(tmp_path / "dates.pdf", [
        ["1.", "Example A Tablet", "Fictional", ""],
        ["2.", "Example B Tablet", "Fictional", "spring 2025"],
    ])
    report = CdscoApprovalEventPdfAdapter(
        category="new-drug", release="2025-10-29", source_url=OFFICIAL_URL
    ).load(pdf)
    assert not report.accepted
    assert len(report.deferred) == 2
    assert not report.rejected


def test_multi_page_tables_preserve_page_and_row(tmp_path: Path) -> None:
    pdf = _table_pdf(tmp_path / "multi.pdf", [
        [["1.", "Example A Tablet 10mg", "Fictional A", "01.01.2025"]],
        [["2.", "Example B Capsule 20mg", "Fictional B", "02.01.2025"]],
    ])
    report = CdscoApprovalEventPdfAdapter(
        category="new-drug", release="2025-10-29", source_url=OFFICIAL_URL
    ).load(pdf)
    assert [event.source_page for event in report.accepted] == [1, 2]
    assert all(event.source_row == 2 for event in report.accepted)


def test_negative_event_sources_cannot_enter_positive_adapter() -> None:
    with pytest.raises(OfficialSourceSchemaError, match="negative regulatory events"):
        get_cdsco_approval_adapter(
            "cdsco-prohibited-fdc", release="2026-07-21", source_url="https://cdsco.gov.in/"
        )
    with pytest.raises(ValueError, match="positive"):
        CdscoApprovalEventPdfAdapter(
            category="withdrawn", release="2026-01-01", source_url="https://cdsco.gov.in/"
        )


def test_offline_adapter_never_opens_network(tmp_path: Path, monkeypatch) -> None:
    pdf = _table_pdf(tmp_path / "offline.pdf", [[
        "1.", "Example A Tablet 10mg", "Fictional", "01.01.2025"
    ]])
    monkeypatch.setattr(
        "socket.create_connection",
        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("network")),
    )
    report = get_cdsco_approval_adapter(
        "cdsco-approved-new-drugs", release="2025-10-29", source_url=OFFICIAL_URL
    ).load(pdf)
    assert len(report.accepted) == 1


def test_five_column_snd_layout_preserves_composition_and_continuation(tmp_path: Path) -> None:
    pdf = _grid_pdf(tmp_path / "snd-five-column.pdf", [[
        ["S. No.", "Name of New Drug", "Composition", "Indication", "Date of Approval"],
        ["1.", "Example combination tablet", "Example A 10 mg + Example B 20 mg", "Part one", "01.02.2022"],
        ["", "", "", "continued indication", ""],
    ]])
    report = CdscoApprovalEventPdfAdapter(
        category="new-drug", release="2023-01-27", source_url=OFFICIAL_URL
    ).load(pdf)
    assert len(report.accepted) == 1
    event = report.accepted[0]
    assert event.composition == "Example A 10 mg + Example B 20 mg"
    assert "continued indication" in (event.indication or "")
    assert [item["name"] for item in event.ingredients] == ["Example A", "Example B"]


def test_split_six_column_snd_header_uses_combined_date_columns(tmp_path: Path) -> None:
    pdf = _grid_pdf(tmp_path / "snd-split-header.pdf", [[
        ["S. No.", "Name of New Drug", "Indication", "Date", "of Approval", ""],
        ["1.", "Examplemab injection", "Fictional indication", "15.03.2023", "", ""],
    ]])
    report = CdscoApprovalEventPdfAdapter(
        category="new-drug", release="2024-05-03", source_url=OFFICIAL_URL
    ).load(pdf)
    assert len(report.accepted) == 1
    assert report.accepted[0].approval_date == "2023-03-15"


def test_document_title_row_preceding_table_header_is_preserved(tmp_path: Path) -> None:
    pdf = _grid_pdf(tmp_path / "title-row.pdf", [[
        ["FIXED DOSE COMBINATIONS APPROVED BY DCG(I) FOR 2024", "", "", ""],
        ["S. No.", "Name of FDC", "Indication", "Date of Approval"],
        ["1.", "Example A 10 mg + Example B 20 mg tablet", "Fictional", "25.11.2024"],
    ]])
    report = CdscoApprovalEventPdfAdapter(
        category="fdc-marketing-permission", release="2024-12-02", source_url=OFFICIAL_URL
    ).load(pdf)
    assert len(report.accepted) == 1
    assert "FIXED DOSE COMBINATIONS" in (report.accepted[0].source_document_title or "")


def _table_pdf(
    path: Path,
    rows_or_pages: list,
    *,
    name_header: str = "Name of New Drug",
) -> Path:
    if rows_or_pages and rows_or_pages[0] and isinstance(rows_or_pages[0][0], str):
        pages = [rows_or_pages]
    else:
        pages = rows_or_pages
    document = pymupdf.open()
    widths = (40, 100, 390, 650, 760)
    for rows in pages:
        page = document.new_page(width=792, height=612)
        table_rows = [["S. No.", name_header, "Indication", "Date of Approval"], *rows]
        top = 72
        height = 56
        for row_index, values in enumerate(table_rows):
            y0 = top + row_index * height
            y1 = y0 + height
            for column in range(4):
                rect = pymupdf.Rect(widths[column], y0, widths[column + 1], y1)
                page.draw_rect(rect, color=(0, 0, 0), width=0.7)
                page.insert_textbox(
                    rect + (3, 3, -3, -3), str(values[column]), fontsize=7, align=0
                )
    document.save(path)
    document.close()
    return path


def _grid_pdf(path: Path, pages: list[list[list[str]]]) -> Path:
    document = pymupdf.open()
    for rows in pages:
        columns = max(len(row) for row in rows)
        page = document.new_page(width=792, height=612)
        left, right, top, row_height = 30, 762, 50, 58
        width = (right - left) / columns
        for row_index, values in enumerate(rows):
            for column in range(columns):
                rect = pymupdf.Rect(
                    left + column * width,
                    top + row_index * row_height,
                    left + (column + 1) * width,
                    top + (row_index + 1) * row_height,
                )
                page.draw_rect(rect, color=(0, 0, 0), width=0.7)
                page.insert_textbox(
                    rect + (3, 3, -3, -3),
                    str(values[column] if column < len(values) else ""),
                    fontsize=6,
                )
    document.save(path)
    document.close()
    return path
