"""Official NPPA ceiling-price spreadsheet adapters (offline only)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re
from typing import Iterator, TypedDict
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile

from .loader import create_record_hash
from .models import RawRecord, SourceMetadata
from .official_sources import AdaptedOfficialRecord, OfficialSourceSchemaError, _nlem_ingredients
from .package_quantity import parse_explicit_package_quantity


_XML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PRICE_PATTERN = re.compile(r"^&#8377;?\s*(\d+(?:\.\d+)?)\((.*)\)$", re.I)
_STRENGTH_PATTERN = re.compile(
    r"(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>mcg|mg|g|IU|%)(?:\s*/\s*(?P<denom>\d+(?:\.\d+)?\s*)?(?P<denom_unit>mL|g))?",
    re.I,
)
_FORM_PATTERN = re.compile(
    r"^(tablet|capsule|injection|oral liquid|oral solution|oral suspension|"
    r"powder for injection|cream|ointment|gel|suppository|pessary|eye drop|"
    r"ear drop|inhalation|solution|implant|spray|patch|syrup|drops?)\b",
    re.I,
)


@dataclass(frozen=True)
class _SheetContext:
    title: str
    snapshot_date: str | None
    headers: dict[str, str]
    rows: list[dict[str, str]]


class _ParsedFormulation(TypedDict):
    dosage_form: str | None
    medicine_strength_value: str | None
    medicine_strength_unit: str | None
    ingredient_strength_values: list[str]
    ingredient_strength_units: list[str]


class _NppaPriceAdapterBase:
    source_authority = "National Pharmaceutical Pricing Authority, Government of India"
    jurisdiction = "India"
    price_basis = "ceiling_price_excluding_taxes"
    source_url = "https://nppa.gov.in/"
    special_feature = False
    expected_headers: tuple[str, ...] = ()
    source_dataset = ""
    serial_header: str
    record_prefix: str

    def __init__(self, *, release: str, source_url: str | None = None) -> None:
        if not release.strip():
            raise ValueError("NPPA price source snapshot/release is required.")
        self.release = release.strip()
        if source_url:
            self.source_url = source_url

    def load(self, path: str | Path, *, max_records: int | None = None) -> list[AdaptedOfficialRecord]:
        return list(self.iter_load(path, max_records=max_records))

    def iter_load(
        self, path: str | Path, *, max_records: int | None = None
    ) -> Iterator[AdaptedOfficialRecord]:
        xlsx_path = Path(path)
        if not xlsx_path.is_file():
            raise FileNotFoundError(f"Official NPPA spreadsheet does not exist: {xlsx_path}")
        if xlsx_path.suffix.casefold() != ".xlsx":
            raise OfficialSourceSchemaError("NPPA ceiling-price input must be XLSX.")
        context = _read_first_xlsx_sheet(xlsx_path)
        missing = [item for item in self.expected_headers if item not in context.headers.values()]
        if missing:
            raise OfficialSourceSchemaError(
                "NPPA spreadsheet is missing required columns: " + ", ".join(missing)
            )
        limit = _positive_limit(max_records) if max_records is not None else None
        for index, values in enumerate(context.rows, start=1):
            if limit is not None and index > limit:
                break
            yield self._adapt(values, index, context)

    def _adapt(
        self, values: dict[str, str], row_index: int, context: _SheetContext
    ) -> AdaptedOfficialRecord:
        mapped = {context.headers[column]: value for column, value in values.items() if column in context.headers}
        serial = _integer_text(mapped.get(self.serial_header))
        formulation = _clean(mapped.get("Formulation"))
        dosage_strength = _clean(mapped.get("Dosage & Strength"))
        notification = _clean(mapped.get("SO Number"))
        notification_date = _clean(mapped.get("SO Date"))
        nlem_version = _integer_text(mapped.get("NLEM Version")) if "NLEM Version" in mapped else None
        original_price = _clean(mapped.get("Ceiling Price ( Excluding Taxes) (Rs.)(Per Unit)"))
        issues: list[str] = []
        for label, value in (
            ("serial number", serial), ("formulation", formulation),
            ("dosage and strength", dosage_strength), ("S.O. number", notification),
            ("S.O. date", notification_date), ("ceiling price", original_price),
        ):
            if not value:
                issues.append(f"Missing required NPPA {label}.")
        price, package = _parse_price(original_price)
        if original_price and price is None:
            issues.append("NPPA ceiling-price cell does not match the verified rupee/per-unit format.")
        package_quantity = parse_explicit_package_quantity(
            package, special_feature=self.special_feature
        )
        iso_date = _parse_date(notification_date)
        if notification_date and iso_date is None:
            issues.append("NPPA S.O. date is not in the verified day-month-year format.")

        ingredients = _nlem_ingredients(formulation or "")
        parsed = _parse_formulation(dosage_strength or "", ingredients)
        source_record_id = f"{self.record_prefix}:{serial or row_index}"
        raw_values = {
            "canonical_name": f"{formulation} - {dosage_strength}" if formulation and dosage_strength else formulation,
            "generic_name": formulation,
            "dosage_form": parsed["dosage_form"],
            "strength_value": parsed["medicine_strength_value"],
            "strength_unit": parsed["medicine_strength_unit"],
            "ingredients": "|".join(ingredients),
            "ingredient_strength": "|".join(parsed["ingredient_strength_values"]),
            "ingredient_strength_unit": "|".join(parsed["ingredient_strength_units"]),
            "country": self.jurisdiction,
            "price": str(price) if price is not None else None,
            "price_currency": "INR",
            "price_country": self.jurisdiction,
            "package_description": package,
            "package_quantity": str(package_quantity.quantity) if package_quantity else None,
            "price_source": self.source_dataset,
            "price_basis": self.price_basis,
            "price_unit": package,
            "price_package_quantity_unit": package_quantity.unit if package_quantity else None,
            "price_notification_number": f"S.O. {notification}" if notification else None,
            "price_notification_date": iso_date,
            "price_nlem_version": nlem_version,
            "price_source_record_id": source_record_id,
            "price_source_release": self.release,
            "price_special_feature": self.special_feature,
            "price_special_feature_qualifier": (
                package_quantity.special_feature_qualifier if package_quantity else None
            ),
            "price_original_text": original_price,
            "source_nppa_serial_number": serial,
            "source_nppa_formulation": formulation,
            "source_nppa_dosage_strength": dosage_strength,
            "source_nppa_so_number": notification,
            "source_nppa_so_date": notification_date,
            "source_nppa_nlem_version": nlem_version,
            "source_nppa_price_text": original_price,
            "source_nppa_package_specification": package,
            "source_nppa_package_quantity": (
                str(package_quantity.quantity) if package_quantity else None
            ),
            "source_nppa_package_quantity_unit": (
                package_quantity.unit if package_quantity else None
            ),
            "source_nppa_special_feature_qualifier": (
                package_quantity.special_feature_qualifier if package_quantity else None
            ),
            "source_nppa_price_excludes_taxes": True,
            "source_nppa_is_mrp": False,
            "source_nppa_is_retail_price": False,
            "source_nppa_special_feature": self.special_feature,
            "source_workbook_title": context.title,
            "source_workbook_snapshot_date": context.snapshot_date,
            "source_workbook_row": row_index + 7,
        }
        source = SourceMetadata(
            source_dataset=self.source_dataset,
            source_record_id=source_record_id,
            source_url=self.source_url,
            source_record_hash=create_record_hash(raw_values),
            source_release=self.release,
            source_authority=self.source_authority,
            jurisdiction=self.jurisdiction,
        )
        return AdaptedOfficialRecord(
            RawRecord(data=raw_values, source=source, row_number=row_index + 7), tuple(issues)
        )


class NppaStandardCeilingPriceAdapter(_NppaPriceAdapterBase):
    source_dataset = "india_nppa_standard_ceiling_prices"
    record_prefix = "nppa-standard"
    serial_header = "SL No"
    expected_headers = (
        "SL No", "NLEM Version", "Formulation", "Dosage & Strength",
        "SO Number", "SO Date", "Ceiling Price ( Excluding Taxes) (Rs.)(Per Unit)",
    )


class NppaSpecialFeatureCeilingPriceAdapter(_NppaPriceAdapterBase):
    source_dataset = "india_nppa_special_feature_ceiling_prices"
    record_prefix = "nppa-special-feature"
    serial_header = "S.No."
    price_basis = "special_feature_ceiling_price"
    special_feature = True
    expected_headers = (
        "S.No.", "Formulation", "Dosage & Strength", "SO Number", "SO Date",
        "Ceiling Price ( Excluding Taxes) (Rs.)(Per Unit)",
    )


def _read_first_xlsx_sheet(path: Path) -> _SheetContext:
    try:
        with ZipFile(path) as archive:
            shared = _shared_strings(archive)
            workbook = ET.fromstring(archive.read("xl/workbook.xml"))
            relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            rel_map = {item.attrib["Id"]: item.attrib["Target"] for item in relationships}
            sheets = workbook.find(f"{{{_XML_NS}}}sheets")
            sheet = next(iter(sheets), None) if sheets is not None else None
            if sheet is None:
                raise OfficialSourceSchemaError("NPPA XLSX has no worksheet.")
            relationship_id = sheet.attrib.get(f"{{{_OFFICE_REL_NS}}}id")
            target_value = rel_map.get(relationship_id) if relationship_id else None
            if not target_value:
                raise OfficialSourceSchemaError("NPPA XLSX worksheet relationship is missing.")
            target = target_value.lstrip("/")
            if not target.startswith("xl/"):
                target = "xl/" + target
            rows = _xml_rows(ET.fromstring(archive.read(target)), shared)
    except (BadZipFile, KeyError, ET.ParseError, StopIteration) as error:
        raise OfficialSourceSchemaError("NPPA XLSX package is malformed.") from error
    row_map = {number: values for number, values in rows}
    headers = row_map.get(7, {})
    if not headers:
        raise OfficialSourceSchemaError("NPPA XLSX header row 7 is missing.")
    title = row_map.get(1, {}).get("A", "")
    snapshot = row_map.get(5, {}).get("A")
    snapshot = snapshot.removeprefix("Date:").strip() if snapshot else None
    data = [values for number, values in rows if number >= 8 and any(values.values())]
    return _SheetContext(title=title, snapshot_date=snapshot, headers=headers, rows=data)


def _shared_strings(archive: ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return ["".join(node.text or "" for node in item.iter(f"{{{_XML_NS}}}t")) for item in root]


def _xml_rows(root: ET.Element, shared: list[str]) -> list[tuple[int, dict[str, str]]]:
    output = []
    for row in root.findall(f".//{{{_XML_NS}}}sheetData/{{{_XML_NS}}}row"):
        values: dict[str, str] = {}
        for cell in row.findall(f"{{{_XML_NS}}}c"):
            column = re.match(r"[A-Z]+", cell.attrib["r"])
            if not column:
                continue
            value_node = cell.find(f"{{{_XML_NS}}}v")
            cell_type = cell.attrib.get("t")
            if cell_type == "s" and value_node is not None:
                value = shared[int(value_node.text or "0")]
            elif cell_type == "inlineStr":
                value = "".join(node.text or "" for node in cell.iter(f"{{{_XML_NS}}}t"))
            else:
                value = value_node.text or "" if value_node is not None else ""
            values[column.group()] = value
        output.append((int(row.attrib["r"]), values))
    return output


def _parse_price(value: str | None) -> tuple[Decimal | None, str | None]:
    match = _PRICE_PATTERN.fullmatch(value or "")
    if not match:
        return None, None
    try:
        price = Decimal(match.group(1))
    except InvalidOperation:
        return None, None
    return price, match.group(2).strip() or None


def _parse_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%d-%b-%Y").date().isoformat()
    except ValueError:
        return None


def _parse_formulation(value: str, ingredients: list[str]) -> _ParsedFormulation:
    form_match = _FORM_PATTERN.match(value.strip())
    dosage_form = form_match.group(1) if form_match else None
    strengths = [(item.group("value"), _strength_unit(item)) for item in _STRENGTH_PATTERN.finditer(value)]
    ingredient_values: list[str] = []
    ingredient_units: list[str] = []
    if ingredients and len(ingredients) == len(strengths):
        ingredient_values = [item[0] for item in strengths]
        ingredient_units = [item[1] for item in strengths]
    return {
        "dosage_form": dosage_form,
        "medicine_strength_value": strengths[0][0] if len(ingredients) == 1 and len(strengths) == 1 else None,
        "medicine_strength_unit": strengths[0][1] if len(ingredients) == 1 and len(strengths) == 1 else None,
        "ingredient_strength_values": ingredient_values,
        "ingredient_strength_units": ingredient_units,
    }


def _strength_unit(match: re.Match[str]) -> str:
    denominator_unit = match.group("denom_unit")
    if not denominator_unit:
        return match.group("unit")
    denominator = (match.group("denom") or "").strip()
    return f"{match.group('unit')}/{denominator}{denominator_unit}"


def _clean(value: str | None) -> str | None:
    return re.sub(r"\s+", " ", value).strip() if value and value.strip() else None


def _integer_text(value: str | None) -> str | None:
    cleaned = _clean(value)
    if cleaned and re.fullmatch(r"\d+\.0", cleaned):
        return cleaned[:-2]
    return cleaned


def _positive_limit(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError("max_records must be a positive integer.")
    return value
