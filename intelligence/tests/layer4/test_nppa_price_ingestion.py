from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path
from typing import Any, NoReturn

from zipfile import ZIP_DEFLATED, ZipFile

from app.layer4_medicine_intelligence.dataset_ingestion.dry_run import (
    DryRunEntry,
    run_official_dry_run,
)
from app.layer4_medicine_intelligence.dataset_ingestion.catalogue_import_preparation import prepare_catalogue_import
from app.layer4_medicine_intelligence.dataset_ingestion.nppa_price_sources import (
    NppaSpecialFeatureCeilingPriceAdapter,
    NppaStandardCeilingPriceAdapter,
)
from app.layer4_medicine_intelligence.dataset_ingestion.official_sources import (
    get_official_source_adapter,
)
from app.layer4_medicine_intelligence.dataset_ingestion.price_linkage import assess_price_linkages


STANDARD_HEADERS = [
    "SL No", "NLEM Version", "Formulation", "Dosage & Strength", "SO Number",
    "SO Date", "Ceiling Price ( Excluding Taxes) (Rs.)(Per Unit)",
]
SPECIAL_HEADERS = [
    "S.No.", "Formulation", "Dosage & Strength", "SO Number", "SO Date",
    "Ceiling Price ( Excluding Taxes) (Rs.)(Per Unit)",
]


def test_standard_price_adapter_preserves_regulatory_price_and_provenance(tmp_path: Path) -> None:
    path = _xlsx(tmp_path / "standard.xlsx", STANDARD_HEADERS, [[
        "1", "2022", "Example A", "Tablet 10 mg", "1234(E)", "25-Mar-2026",
        "&#8377 4.50(1 Tablet)",
    ]], title="All Drugs Ceiling Prices")
    export = tmp_path / "standard.json"
    report = run_official_dry_run(
        path, source="india-nppa-standard", release="2026-11-13",
        source_url="https://nppa.gov.in/", export_path=export,
    )
    assert len(report.accepted) == 1
    entry = report.accepted[0]
    normalized = _normalized_record(entry)
    price = normalized["prices"][0]
    assert price["price"] == Decimal("4.50")
    assert price["currency"] == "INR"
    assert price["price_basis"] == "ceiling_price_excluding_taxes"
    assert price["price_unit"] == "1 Tablet"
    assert price["quantity"] == Decimal("1")
    assert price["package_quantity_unit"] == "tablets"
    assert price["notification_number"] == "S.O. 1234(E)"
    assert price["notification_date"] == "2026-03-25"
    assert price["effective_date"] is None
    assert price["nlem_version"] == "2022"
    assert price["special_feature"] is False
    source_fields = _source_fields(entry)
    assert source_fields["source_nppa_price_excludes_taxes"] is True
    assert source_fields["source_nppa_is_mrp"] is False
    assert source_fields["source_workbook_snapshot_date"] == "13/11/2026 00:30:00"
    [decision] = assess_price_linkages(prepare_catalogue_import([export]))
    assert decision.status == "eligible"


def test_special_feature_adapter_keeps_package_and_missing_nlem_version_null(tmp_path: Path) -> None:
    path = _xlsx(tmp_path / "special.xlsx", SPECIAL_HEADERS, [[
        "1", "Glucose (A) + Sodium Chloride (B)", "Injection 5% (A) + 0.9% (B)",
        "1583(E)", "25-Mar-2026", "&#8377 87.58(500ml Non Glass with special features)",
    ]], title="Special Feature Schedule Drugs Ceiling Prices fixed for Specific Companies")
    export = tmp_path / "special.json"
    report = run_official_dry_run(
        path, source="india-nppa-special-feature", release="2026-11-13",
        export_path=export,
    )
    entry = report.accepted[0]
    normalized = _normalized_record(entry)
    price = normalized["prices"][0]
    assert price["price"] == Decimal("87.58")
    assert price["package_description"] == "500ml Non Glass with special features"
    assert price["quantity"] == Decimal("500")
    assert price["package_quantity_unit"] == "mL"
    assert price["price_basis"] == "special_feature_ceiling_price"
    assert price["special_feature_qualifier"] == "Non Glass with special features"
    assert price["nlem_version"] is None
    assert price["special_feature"] is True
    assert [item["ingredient_strength_value"] for item in normalized["ingredients"]] == [
        Decimal("5"), Decimal("0.9")
    ]
    [decision] = assess_price_linkages(prepare_catalogue_import([export]))
    assert decision.status == "eligible"


def test_ambiguous_pack_text_does_not_produce_a_quantity(tmp_path: Path) -> None:
    path = _xlsx(tmp_path / "ambiguous-pack.xlsx", STANDARD_HEADERS, [[
        "1", "2022", "Example A", "Tablet 10 mg", "1234(E)", "25-Mar-2026",
        "&#8377 4.50(1 x 10)",
    ]])
    export = tmp_path / "ambiguous-pack.json"
    report = run_official_dry_run(
        path, source="india-nppa-standard", release="2026-11-13",
        export_path=export,
    )
    assert _normalized_record(report.accepted[0])["prices"][0]["quantity"] is None
    [decision] = assess_price_linkages(prepare_catalogue_import([export]))
    assert decision.status == "incomplete"


def test_missing_price_is_rejected_and_overlapping_prices_remain_separate(tmp_path: Path) -> None:
    path = _xlsx(tmp_path / "rows.xlsx", STANDARD_HEADERS, [
        ["1", "2022", "Example A", "Tablet 10 mg", "100(E)", "01-Jan-2026", "&#8377 4.50(1 Tablet)"],
        ["2", "2022", "Example A", "Tablet 10 mg", "101(E)", "02-Jan-2026", "&#8377 4.75(1 Tablet)"],
        ["3", "2022", "Example B", "Tablet 5 mg", "102(E)", "03-Jan-2026", ""],
    ])
    report = run_official_dry_run(path, source="india-nppa-standard", release="snapshot")
    assert len(report.accepted) == 2
    assert len(report.rejected) == 1
    assert [_normalized_record(item)["prices"][0]["price"] for item in report.accepted] == [
        Decimal("4.50"), Decimal("4.75")
    ]
    assert "Missing required NPPA ceiling price." in report.rejected[0].issues


def test_same_source_identifier_with_conflicting_content_is_ambiguous(tmp_path: Path) -> None:
    path = _xlsx(tmp_path / "duplicate-id.xlsx", STANDARD_HEADERS, [
        ["1", "2022", "Example A", "Tablet 10 mg", "100(E)", "01-Jan-2026", "&#8377 4.50(1 Tablet)"],
        ["1", "2022", "Example A", "Tablet 20 mg", "100(E)", "01-Jan-2026", "&#8377 5.50(1 Tablet)"],
    ])
    report = run_official_dry_run(path, source="india-nppa-standard", release="snapshot")
    assert len(report.ambiguous) == 2
    assert not report.accepted


def test_registry_and_export_are_offline(tmp_path: Path, monkeypatch) -> None:
    path = _xlsx(tmp_path / "standard.xlsx", STANDARD_HEADERS, [[
        "1", "2022", "Example A", "Tablet 10 mg", "1234(E)", "25-Mar-2026",
        "&#8377 4.50(1 Tablet)",
    ]])
    monkeypatch.setattr("socket.create_connection", _raise_on_network)
    output = tmp_path / "normalized.json"
    report = run_official_dry_run(
        path, source="india-nppa-standard", release="snapshot", export_path=output
    )
    assert isinstance(get_official_source_adapter(
        "india-nppa-standard", release="snapshot", input_format="xlsx"
    ), NppaStandardCeilingPriceAdapter)
    assert isinstance(get_official_source_adapter(
        "india-nppa-special-feature", release="snapshot", input_format="xlsx"
    ), NppaSpecialFeatureCeilingPriceAdapter)
    assert len(report.accepted) == 1
    assert json.loads(output.read_text(encoding="utf-8"))["accepted"][0]["normalized_record"]["prices"]


def _normalized_record(entry: DryRunEntry) -> dict[str, Any]:
    assert entry.normalized_record is not None
    return entry.normalized_record


def _source_fields(entry: DryRunEntry) -> dict[str, Any]:
    assert entry.source_fields is not None
    return entry.source_fields


def _raise_on_network(*args: object, **kwargs: object) -> NoReturn:
    raise AssertionError(f"Network call attempted with args={args!r}, kwargs={kwargs!r}")


def _xlsx(path: Path, headers: list[str], records: list[list[str]], title: str = "Prices") -> Path:
    rows = {
        1: [title],
        3: ["NLEM version :- All"],
        5: ["Date: 13/11/2026 00:30:00"],
        7: headers,
    }
    for offset, record in enumerate(records, start=8):
        rows[offset] = record
    strings: list[str] = []
    index: dict[str, int] = {}
    for values in rows.values():
        for value in values:
            text = str(value)
            if text not in index:
                index[text] = len(strings)
                strings.append(text)
    shared = "".join(f"<si><t>{_xml(value)}</t></si>" for value in strings)
    sheet_rows = []
    for number, values in rows.items():
        cells = "".join(
            f'<c r="{_column(i)}{number}" t="s"><v>{index[str(value)]}</v></c>'
            for i, value in enumerate(values, start=1)
        )
        sheet_rows.append(f'<row r="{number}">{cells}</row>')
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("xl/sharedStrings.xml", f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{shared}</sst>')
        archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{"".join(sheet_rows)}</sheetData></worksheet>')
    return path


def _column(index: int) -> str:
    output = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        output = chr(65 + remainder) + output
    return output


def _xml(value: str) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
