"""Official NPPA revised-MRP PDF adapter for non-scheduled anti-cancer drugs."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from pathlib import Path
import re
from typing import Iterator, TypedDict

import pymupdf

from .loader import create_record_hash
from .models import RawRecord, SourceMetadata
from .official_sources import AdaptedOfficialRecord, OfficialSourceSchemaError, _nlem_ingredients
from .package_quantity import parse_explicit_package_quantity


_TITLE = "Revised MRP of Non-Scheduled Anti-Cancer Drugs"
_EFFECTIVE_DATE = "2026-11-09"
# The PDF gives a company-data cutoff, not an explicit publication date.
_PUBLICATION_DATE: str | None = None
_COLUMN_BOUNDS = (
    (65.0, 104.0),
    (104.0, 225.0),
    (225.0, 305.0),
    (305.0, 386.0),
    (386.0, 545.0),
    (545.0, 614.0),
    (614.0, 686.0),
    (686.0, 760.0),
)
_FORM_PATTERN = re.compile(
    r"\b(tablets?|capsules?|injections?|vials?|prefilled\s+syringes?|syringes?|"
    r"oral\s+(?:solution|suspension)|solution|suspension|cream|gel|powder|kit)\b",
    re.I,
)
_STRENGTH_PATTERN = re.compile(
    r"(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>mcg|mg|g|iu|%)(?:\s*/\s*(?P<denom>\d+(?:\.\d+)?)?\s*(?P<denom_unit>ml|g))?",
    re.I,
)


class _ParsedStrengthAndForm(TypedDict):
    dosage_form: str | None
    medicine_strength_value: str | None
    medicine_strength_unit: str | None
    ingredient_strength_values: list[str]
    ingredient_strength_units: list[str]


@dataclass(frozen=True)
class _PageWord:
    x0: float
    y0: float
    x1: float
    y1: float
    text: str


@dataclass(frozen=True)
class NppaMrpCollisionSummary:
    exact_duplicates: tuple[tuple[str, ...], ...]
    conflicting_prices: tuple[tuple[str, ...], ...]


class NppaAntiCancerRevisedMrpPdfAdapter:
    """Deterministically extracts the verified landscape PDF table without OCR."""

    source_dataset = "india_nppa_anticancer_revised_mrp"
    source_authority = "National Pharmaceutical Pricing Authority, Government of India"
    jurisdiction = "India"
    source_url = (
        "https://nppa.gov.in/storage/uploads/tender/"
        "revised-mrp-information-11112026-1-11-11-2026.pdf"
    )
    price_basis = "revised_mrp"

    def __init__(self, *, release: str, source_url: str | None = None) -> None:
        if not release.strip():
            raise ValueError("NPPA revised-MRP source release is required.")
        self.release = release.strip()
        if source_url:
            self.source_url = source_url

    def load(
        self, path: str | Path, *, max_records: int | None = None
    ) -> list[AdaptedOfficialRecord]:
        return list(self.iter_load(path, max_records=max_records))

    def iter_load(
        self, path: str | Path, *, max_records: int | None = None
    ) -> Iterator[AdaptedOfficialRecord]:
        pdf_path = Path(path)
        if not pdf_path.is_file():
            raise FileNotFoundError(f"Official NPPA revised-MRP PDF does not exist: {pdf_path}")
        if pdf_path.suffix.casefold() != ".pdf":
            raise OfficialSourceSchemaError("NPPA revised-MRP input must be PDF.")
        limit = _positive_limit(max_records) if max_records is not None else None
        document_hash = _file_sha256(pdf_path)
        try:
            document = pymupdf.open(pdf_path)
        except Exception as error:
            raise OfficialSourceSchemaError("NPPA revised-MRP PDF cannot be opened.") from error
        try:
            if document.page_count < 1 or _TITLE not in document[0].get_text("text"):
                raise OfficialSourceSchemaError(
                    "PDF title does not match the official NPPA anti-cancer revised-MRP table."
                )
            emitted = 0
            for page_index in range(document.page_count):
                page_number = page_index + 1
                page = document.load_page(page_index)
                for columns in _page_rows(page):
                    if limit is not None and emitted >= limit:
                        return
                    emitted += 1
                    yield self._adapt(columns, page_number, document_hash)
        finally:
            document.close()

    def _adapt(
        self, columns: tuple[str, ...], page_number: int, document_hash: str
    ) -> AdaptedOfficialRecord:
        serial, company, drug, strength_form, brand, pack, old_text, revised_text = columns
        old_price = _parse_inr(old_text)
        revised_price = _parse_inr(revised_text)
        issues: list[str] = []
        for label, value in (
            ("serial number", serial), ("company", company), ("drug", drug),
            ("strength and dosage form", strength_form), ("brand name", brand),
            ("pack size", pack), ("old MRP", old_text), ("revised MRP", revised_text),
        ):
            if not value:
                issues.append(f"Missing required NPPA revised-MRP {label}.")
        package_quantity = parse_explicit_package_quantity(pack)
        if old_text and old_price is None:
            issues.append("Old MRP is not an unambiguous INR monetary value.")
        if revised_text and revised_price is None:
            issues.append("Revised MRP is not an unambiguous INR monetary value.")

        ingredients = _nlem_ingredients(drug)
        strength = _parse_strength_and_form(strength_form, ingredients)
        source_record_id = f"nppa-anticancer-mrp:{serial}"
        raw_values = {
            "canonical_name": f"{brand} - {strength_form}" if brand and strength_form else brand or drug,
            "brand_name": brand,
            "generic_name": drug,
            "manufacturer_name": company,
            "dosage_form": strength["dosage_form"],
            "strength_value": strength["medicine_strength_value"],
            "strength_unit": strength["medicine_strength_unit"],
            "ingredients": "|".join(ingredients),
            "ingredient_strength": "|".join(strength["ingredient_strength_values"]),
            "ingredient_strength_unit": "|".join(strength["ingredient_strength_units"]),
            "country": self.jurisdiction,
            "price": str(revised_price) if revised_price is not None else None,
            "price_currency": "INR",
            "price_country": self.jurisdiction,
            "package_description": pack,
            "package_quantity": str(package_quantity.quantity) if package_quantity else None,
            "price_source": self.source_dataset,
            "price_basis": self.price_basis,
            "price_unit": pack,
            "price_package_quantity_unit": package_quantity.unit if package_quantity else None,
            "price_source_record_id": source_record_id,
            "price_source_release": self.release,
            "price_original_text": revised_text,
            "price_previous_value": str(old_price) if old_price is not None else None,
            "price_previous_original_text": old_text,
            "price_effective_date": _EFFECTIVE_DATE,
            "price_publication_date": _PUBLICATION_DATE,
            "source_nppa_serial_number": serial,
            "source_nppa_company": company,
            "source_nppa_drug": drug,
            "source_nppa_strength_dosage_form": strength_form,
            "source_nppa_brand_name": brand,
            "source_nppa_pack_size": pack,
            "source_nppa_package_quantity": (
                str(package_quantity.quantity) if package_quantity else None
            ),
            "source_nppa_package_quantity_unit": (
                package_quantity.unit if package_quantity else None
            ),
            "source_nppa_old_mrp_text": old_text,
            "source_nppa_revised_mrp_text": revised_text,
            "source_nppa_effective_date": _EFFECTIVE_DATE,
            "source_nppa_publication_date": _PUBLICATION_DATE,
            "source_nppa_is_mrp": True,
            "source_nppa_is_ceiling_price": False,
            "source_nppa_is_retail_selling_price": False,
            "source_pdf_page": page_number,
            "source_pdf_row_number": int(serial) if serial.isdigit() else None,
            "source_pdf_document_title": _TITLE,
            "source_pdf_sha256": document_hash,
            "source_raw_text": " | ".join(columns),
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
            RawRecord(data=raw_values, source=source, row_number=int(serial)), tuple(issues)
        )


def summarize_nppa_mrp_collisions(
    records: list[AdaptedOfficialRecord],
) -> NppaMrpCollisionSummary:
    """Identify repeated formulations without merging or discarding official rows."""
    groups: dict[tuple[str, ...], list[AdaptedOfficialRecord]] = {}
    for record in records:
        data = record.raw_record.data
        key = tuple(_key(data.get(field)) for field in (
            "source_nppa_company", "source_nppa_drug",
            "source_nppa_strength_dosage_form", "source_nppa_brand_name",
            "source_nppa_pack_size",
        ))
        groups.setdefault(key, []).append(record)
    duplicates: list[tuple[str, ...]] = []
    conflicts: list[tuple[str, ...]] = []
    for items in groups.values():
        if len(items) < 2:
            continue
        price_pairs = {
            (
                str(item.raw_record.data.get("source_nppa_old_mrp_text") or ""),
                str(item.raw_record.data.get("source_nppa_revised_mrp_text") or ""),
            )
            for item in items
        }
        ids = tuple(str(item.raw_record.source.source_record_id) for item in items)
        (duplicates if len(price_pairs) == 1 else conflicts).append(ids)
    return NppaMrpCollisionSummary(tuple(duplicates), tuple(conflicts))


def _page_rows(page: pymupdf.Page) -> Iterator[tuple[str, ...]]:
    words: list[_PageWord] = []
    for raw_word in page.get_text("words", sort=True):
        if len(raw_word) < 5:
            continue
        x0 = _coordinate(raw_word[0])
        y0 = _coordinate(raw_word[1])
        x1 = _coordinate(raw_word[2])
        y1 = _coordinate(raw_word[3])
        text = raw_word[4]
        if (
            x0 is None or y0 is None or x1 is None or y1 is None
            or not isinstance(text, str)
        ):
            continue
        words.append(_PageWord(x0, y0, x1, y1, text))

    starts = [
        word for word in words
        if _COLUMN_BOUNDS[0][0] <= word.x0 < _COLUMN_BOUNDS[0][1]
        and re.fullmatch(r"\d{1,4}", word.text)
        and int(word.text) >= 1
    ]
    for index, start in enumerate(starts):
        top = start.y0 - 0.2
        bottom = starts[index + 1].y0 - 0.2 if index + 1 < len(starts) else page.rect.height
        columns: list[str] = []
        for left, right in _COLUMN_BOUNDS:
            tokens = [
                word for word in words
                if top <= word.y0 < bottom and left <= word.x0 < right
            ]
            tokens.sort(key=lambda word: (round(word.y0, 1), word.x0))
            columns.append(_clean(" ".join(word.text for word in tokens)))
        yield tuple(columns)


def _coordinate(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _parse_inr(value: str) -> Decimal | None:
    cleaned = value.replace(",", "").strip()
    if not re.fullmatch(r"\d+(?:\.\d{1,2})?", cleaned):
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _parse_strength_and_form(
    value: str, ingredients: list[str]
) -> _ParsedStrengthAndForm:
    form = _FORM_PATTERN.search(value)
    strengths = []
    for match in _STRENGTH_PATTERN.finditer(value):
        unit = match.group("unit")
        if match.group("denom_unit"):
            denominator = match.group("denom") or ""
            unit = f"{unit}/{denominator}{match.group('denom_unit')}"
        strengths.append((match.group("value"), unit))
    ingredient_values: list[str] = []
    ingredient_units: list[str] = []
    if ingredients and len(ingredients) == len(strengths):
        ingredient_values = [item[0] for item in strengths]
        ingredient_units = [item[1] for item in strengths]
    return {
        "dosage_form": form.group(1) if form else None,
        "medicine_strength_value": strengths[0][0] if len(ingredients) == 1 and len(strengths) == 1 else None,
        "medicine_strength_unit": strengths[0][1] if len(ingredients) == 1 and len(strengths) == 1 else None,
        "ingredient_strength_values": ingredient_values,
        "ingredient_strength_units": ingredient_units,
    }


def _file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _key(value: object) -> str:
    return _clean(str(value or "")).casefold()


def _positive_limit(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError("max_records must be a positive integer.")
    return value
