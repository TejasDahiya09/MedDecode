"""Offline PMBI Jan Aushadhi product catalogue adapter.

The source is a product list.  It is not treated as evidence of clinical
equivalence, regulatory approval, or price regulation outside its own listed
MRP observations.
"""

from __future__ import annotations

import csv
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re
from typing import Iterator

from .loader import create_record_hash
from .models import RawRecord, SourceMetadata
from .official_sources import AdaptedOfficialRecord, OfficialSourceSchemaError
from .package_quantity import parse_explicit_package_quantity


_REQUIRED_COLUMNS = ("Sr No", "Drug Code", "Generic Name", "Unit Size", "MRP", "Group Name")
# Indian product labels may group large strength values as 15,00,000 IU.
# Capture the complete source numeral; commas are removed only in structured
# strength fields while the raw product row remains intact.
_STRENGTH = re.compile(r"(?P<value>\d[\d,]*(?:\.\d+)?)\s*(?P<unit>mcg|mg|g|iu|%)(?:\s*/\s*(?P<denom>w/v|v/v|ml|mL|g))?", re.I)
_FORM = re.compile(
    r"\b(tablets?|capsules?|syrups?|suspension|drops?|injections?|cream|ointment|gel|"
    r"solution|lotion|inhaler|vial|ampoule|powder|kit|device|catheter|gloves?|mask|"
    r"suture|bandage|dressing)\b", re.I,
)
_CONSUMABLE_CATEGORY = "surgical & medical consumables"


class PmbiProductCatalogueAdapter:
    """Adapts the verified PMBI CSV without reclassifying source products."""

    source_key = "india-pmbi-product-catalogue"
    source_dataset = "india_pmbi_product_catalogue"
    source_authority = "Pharmaceuticals & Medical Devices Bureau of India, Government of India"
    jurisdiction = "India"
    source_url = "https://janaushadhi.gov.in/product-portfolio/product-mrp-list"

    def __init__(self, *, release: str, source_url: str | None = None) -> None:
        if not release.strip():
            raise ValueError("PMBI retrieval/release label is required.")
        self.release = release.strip()
        if source_url:
            self.source_url = source_url

    def load(self, path: str | Path, *, max_records: int | None = None) -> list[AdaptedOfficialRecord]:
        return list(self.iter_load(path, max_records=max_records))

    def iter_load(self, path: str | Path, *, max_records: int | None = None) -> Iterator[AdaptedOfficialRecord]:
        csv_path = Path(path)
        if not csv_path.is_file() or csv_path.suffix.casefold() != ".csv":
            raise OfficialSourceSchemaError("PMBI input must be an existing CSV file.")
        limit = _positive_limit(max_records) if max_records is not None else None
        with csv_path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            headers = tuple(reader.fieldnames or ())
            missing = [column for column in _REQUIRED_COLUMNS if column not in headers]
            if missing:
                raise OfficialSourceSchemaError("PMBI CSV is missing required columns: " + ", ".join(missing))
            for index, row in enumerate(reader, start=1):
                if limit is not None and index > limit:
                    return
                yield self._adapt(row, index)

    def _adapt(self, row: dict[str, str | None], row_number: int) -> AdaptedOfficialRecord:
        raw = {key: _clean(value) for key, value in row.items() if key}
        drug_code = raw.get("Drug Code")
        name = raw.get("Generic Name")
        category = raw.get("Group Name")
        unit_size = raw.get("Unit Size")
        mrp_text = raw.get("MRP")
        issues: list[str] = []
        for field, value in (("drug code", drug_code), ("product name", name), ("unit size", unit_size), ("MRP", mrp_text), ("group name", category)):
            if value is None:
                issues.append(f"Missing required PMBI {field}.")
        mrp = _parse_decimal(mrp_text)
        if mrp_text is not None and mrp is None:
            issues.append("PMBI MRP is not a valid non-negative decimal source value.")
        package_quantity = parse_explicit_package_quantity(
            unit_size, allow_count_shorthand=True
        )
        is_consumable = (category or "").casefold() == _CONSUMABLE_CATEGORY
        parsed = _parse_medicine_text(name or "") if not is_consumable else _empty_parse()
        values = {
            "canonical_name": name,
            "generic_name": parsed["generic_name"],
            "dosage_form": parsed["dosage_form"],
            "strength_value": parsed["medicine_strength_value"],
            "strength_unit": parsed["medicine_strength_unit"],
            "ingredients": "|".join(parsed["ingredients"]),
            "ingredient_strength": "|".join(parsed["ingredient_strength_values"]),
            "ingredient_strength_unit": "|".join(parsed["ingredient_strength_units"]),
            "country": self.jurisdiction,
            "price": str(mrp) if mrp is not None else None,
            "price_currency": "INR",
            "price_country": self.jurisdiction,
            "package_description": unit_size,
            "package_quantity": str(package_quantity.quantity) if package_quantity else None,
            "price_source": self.source_dataset,
            "price_basis": "pmbi_listed_mrp",
            "price_unit": unit_size,
            "price_package_quantity_unit": package_quantity.unit if package_quantity else None,
            "price_source_record_id": f"pmbi-drug-code:{drug_code}" if drug_code else None,
            "price_source_release": self.release,
            "price_original_text": mrp_text,
            "source_pmbi_serial_number": raw.get("Sr No"),
            "source_pmbi_drug_code": drug_code,
            "source_pmbi_generic_name": name,
            "source_pmbi_unit_size": unit_size,
            "source_pmbi_unit_size_quantity": (
                str(package_quantity.quantity) if package_quantity else None
            ),
            "source_pmbi_unit_size_unit": (
                package_quantity.unit if package_quantity else None
            ),
            "source_pmbi_mrp": mrp_text,
            "source_pmbi_group_name": category,
            "source_pmbi_product_kind": "surgical_medical_consumable" if is_consumable else "medicine_product",
            "source_pmbi_mrp_zero_value": mrp == Decimal("0") if mrp is not None else None,
            "source_pmbi_publication_date": None,
            "source_pmbi_retrieval_date": self.release,
            "source_raw_csv_row": dict(raw),
        }
        source = SourceMetadata(
            source_dataset=self.source_dataset,
            source_record_id=f"pmbi-drug-code:{drug_code}" if drug_code else None,
            source_url=self.source_url,
            source_record_hash=create_record_hash(raw),
            source_release=self.release,
            source_authority=self.source_authority,
            jurisdiction=self.jurisdiction,
        )
        return AdaptedOfficialRecord(RawRecord(values, source, row_number), tuple(issues))


def _parse_medicine_text(name: str) -> dict[str, object]:
    clean = _clean(name) or ""
    strengths = list(_STRENGTH.finditer(clean))
    form_match = _FORM.search(clean)
    form = form_match.group(0) if form_match else None
    # A FDC may use + or the source's explicit “and”; only create ingredients
    # when every component has one matching strength in its own segment.
    segments = re.split(r"\s*(?:\+|\band\b)\s*", clean, flags=re.I)
    component_matches = [list(_STRENGTH.finditer(part)) for part in segments]
    safe_fdc = len(segments) > 1 and all(len(matches) == 1 for matches in component_matches)
    if safe_fdc:
        ingredients = [_clean(match_part[:matches[0].start()]) or "" for match_part, matches in zip(segments, component_matches)]
        if all(ingredients):
            values = [matches[0].group("value").replace(",", "") for matches in component_matches]
            units = [_strength_unit(matches[0]) for matches in component_matches]
            return {
                "generic_name": _clean(re.sub(r"\s+(?:tablets?|capsules?|syrup|injection|cream|ointment|drops?)\b.*$", "", clean, flags=re.I)),
                "dosage_form": form,
                "medicine_strength_value": None,
                "medicine_strength_unit": None,
                "ingredients": ingredients,
                "ingredient_strength_values": values,
                "ingredient_strength_units": units,
            }
    if len(segments) > 1:
        # One trailing strength for several named components is not evidence
        # that the same strength applies to each component.
        return {"generic_name": clean or None, "dosage_form": form, "medicine_strength_value": None,
                "medicine_strength_unit": None, "ingredients": [], "ingredient_strength_values": [], "ingredient_strength_units": []}
    if len(strengths) == 1:
        match = strengths[0]
        ingredient = _clean(clean[:match.start()])
        if ingredient:
            return {
                "generic_name": ingredient,
                "dosage_form": form,
                "medicine_strength_value": match.group("value").replace(",", ""),
                "medicine_strength_unit": _strength_unit(match),
                "ingredients": [ingredient],
                "ingredient_strength_values": [match.group("value").replace(",", "")],
                "ingredient_strength_units": [_strength_unit(match)],
            }
    return {"generic_name": clean or None, "dosage_form": form, "medicine_strength_value": None,
            "medicine_strength_unit": None, "ingredients": [], "ingredient_strength_values": [], "ingredient_strength_units": []}


def _empty_parse() -> dict[str, object]:
    return {"generic_name": None, "dosage_form": None, "medicine_strength_value": None,
            "medicine_strength_unit": None, "ingredients": [], "ingredient_strength_values": [], "ingredient_strength_units": []}


def _strength_unit(match: re.Match[str]) -> str:
    denominator = match.group("denom")
    return f"{match.group('unit')}/{denominator}" if denominator else match.group("unit")


def _parse_decimal(value: str | None) -> Decimal | None:
    try:
        result = Decimal(value or "")
    except InvalidOperation:
        return None
    return result if result >= 0 else None


def _clean(value: object) -> str | None:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text or None


def _positive_limit(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError("max_records must be a positive integer.")
    return value
