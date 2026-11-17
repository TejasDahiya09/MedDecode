"""Authoritative-source adapters feeding the existing ingestion contracts."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Iterator

from .loader import CSVLoader, create_record_hash
from .models import RawRecord, SourceMetadata


class OfficialSourceSchemaError(ValueError):
    """The supplied extract does not match a supported official schema."""


class OfficialSourceUnavailableError(ValueError):
    """No verified adapter exists for this official source yet."""


@dataclass(frozen=True)
class AdaptedOfficialRecord:
    raw_record: RawRecord
    issues: tuple[str, ...] = ()


class RxNormCsvAdapter:
    """NLM RxNorm RXNCONSO CSV-extract adapter.

    The adapter requires official RXNCONSO field names and uses RXAUI as the
    stable source-record identifier. It deliberately does not infer ingredient
    strengths, dosage forms, country approval, or clinical claims from STR.
    """

    source_key = "rxnorm"
    source_dataset = "nlm_rxnorm_rxnconso"
    source_authority = "U.S. National Library of Medicine"
    required_columns = frozenset({"RXCUI", "RXAUI", "STR", "TTY", "SAB", "CODE", "SUPPRESS"})
    prescribable_medicine_term_types = frozenset({"SCD", "SBD", "GPCK", "BPCK"})

    def __init__(self, *, release: str, source_url: str | None = None) -> None:
        if not release.strip():
            raise ValueError("RxNorm release/version is required.")
        self.release = release.strip()
        self.source_url = source_url

    def load(self, path: str | Path, *, max_records: int | None = None) -> list[AdaptedOfficialRecord]:
        records = CSVLoader().load(str(path), self.source_dataset)
        if records:
            columns = {str(key).strip().upper() for key in records[0].data}
            missing = self.required_columns - columns
            if missing:
                raise OfficialSourceSchemaError(
                    "RxNorm extract is missing required RXNCONSO columns: " + ", ".join(sorted(missing))
                )
        selected = records if max_records is None else records[:_positive_limit(max_records)]
        return [self._adapt(record) for record in selected]

    def _adapt(self, record: RawRecord) -> AdaptedOfficialRecord:
        values = {str(key).strip().upper(): value for key, value in record.data.items()}
        issues: list[str] = []
        for field in self.required_columns:
            if values.get(field) is None or not str(values[field]).strip():
                issues.append(f"Missing required RxNorm field {field}.")

        sab = str(values.get("SAB") or "").strip().upper()
        suppress = str(values.get("SUPPRESS") or "").strip().upper()
        if sab != "RXNORM":
            issues.append("Record is not an RxNorm-owned RXNCONSO atom.")
        if suppress not in {"", "N"}:
            issues.append("Record is suppressed by the official RxNorm release.")
        tty = str(values.get("TTY") or "").strip().upper()
        if tty and tty not in self.prescribable_medicine_term_types:
            issues.append(
                "RxNorm atom is not a canonical prescribable medicine formulation or package; "
                "it is retained only for future alias, ingredient, RXNREL, or RXNSAT integration."
            )

        source = SourceMetadata(
            source_dataset=self.source_dataset,
            source_record_id=str(values.get("RXAUI") or "").strip() or None,
            source_url=self.source_url,
            source_record_hash=record.source.source_record_hash,
            source_release=self.release,
            source_authority=self.source_authority,
            jurisdiction=None,
        )
        adapted = RawRecord(
            data={
                "canonical_name": values.get("STR"),
                "source_rxnorm_cui": values.get("RXCUI"),
                "source_rxnorm_atom_id": values.get("RXAUI"),
                "source_term_type": values.get("TTY"),
                "source_vocabulary": values.get("SAB"),
                "source_code": values.get("CODE"),
                "source_suppress": values.get("SUPPRESS"),
                "source_original_name": values.get("STR"),
                "source_raw_fields": dict(values),
            },
            source=source,
            row_number=record.row_number,
        )
        return AdaptedOfficialRecord(adapted, tuple(issues))


RXNCONSO_RRF_COLUMNS = (
    "RXCUI", "LAT", "TS", "LUI", "STT", "SUI", "ISPREF", "RXAUI",
    "SAUI", "SCUI", "SDUI", "SAB", "TTY", "CODE", "STR", "SRL",
    "SUPPRESS", "CVF",
)


class RxNormRrfAdapter(RxNormCsvAdapter):
    """Streaming parser for the official UTF-8 pipe-delimited RXNCONSO.RRF."""

    def iter_load(
        self,
        path: str | Path,
        *,
        max_records: int | None = None,
    ) -> Iterator[AdaptedOfficialRecord]:
        rrf_path = Path(path)
        if not rrf_path.is_file():
            raise FileNotFoundError(f"RxNorm RRF file does not exist: {rrf_path}")
        if rrf_path.suffix.casefold() != ".rrf":
            raise OfficialSourceSchemaError("RxNorm RRF input must use the .RRF extension.")
        limit = _positive_limit(max_records) if max_records is not None else None

        with rrf_path.open("r", encoding="utf-8", newline="") as stream:
            for row_number, line in enumerate(stream, start=1):
                if limit is not None and row_number > limit:
                    break
                raw_line = line.rstrip("\r\n")
                parts = raw_line.split("|")
                if parts and parts[-1] == "":
                    parts.pop()
                malformed = len(parts) != len(RXNCONSO_RRF_COLUMNS)
                values = {
                    column: parts[index] if index < len(parts) else None
                    for index, column in enumerate(RXNCONSO_RRF_COLUMNS)
                }
                if len(parts) > len(RXNCONSO_RRF_COLUMNS):
                    values["__EXTRA_FIELDS"] = parts[len(RXNCONSO_RRF_COLUMNS):]
                raw = RawRecord(
                    data=values,
                    source=SourceMetadata(
                        source_dataset=self.source_dataset,
                        source_record_hash=create_record_hash(values),
                        source_release=self.release,
                        source_authority=self.source_authority,
                    ),
                    row_number=row_number,
                )
                adapted = self._adapt(raw)
                issues = list(adapted.issues)
                if malformed:
                    issues.insert(0, (
                        f"Malformed RXNCONSO.RRF row: expected {len(RXNCONSO_RRF_COLUMNS)} "
                        f"fields, received {len(parts)}."
                    ))
                yield AdaptedOfficialRecord(adapted.raw_record, tuple(issues))

    def load(self, path: str | Path, *, max_records: int | None = None) -> list[AdaptedOfficialRecord]:
        return list(self.iter_load(path, max_records=max_records))


class IndiaNlem2022PdfAdapter:
    """Deterministic adapter for the official NLEM 2022 Schedule-I PDF table."""

    source_key = "india-nlem-2022"
    source_dataset = "mohfw_india_nlem_2022"
    source_authority = "Ministry of Health and Family Welfare, Government of India"
    jurisdiction = "India"

    def __init__(self, *, release: str, source_url: str | None = None) -> None:
        if release.strip() != "2022":
            raise ValueError("The India NLEM adapter supports only the verified 2022 release.")
        self.release = "2022"
        self.source_url = source_url

    def load(self, path: str | Path, *, max_records: int | None = None) -> list[AdaptedOfficialRecord]:
        return list(self.iter_load(path, max_records=max_records))

    def iter_load(
        self, path: str | Path, *, max_records: int | None = None
    ) -> Iterator[AdaptedOfficialRecord]:
        pdf_path = Path(path)
        if not pdf_path.is_file():
            raise FileNotFoundError(f"Official NLEM PDF does not exist: {pdf_path}")
        if pdf_path.suffix.casefold() != ".pdf":
            raise OfficialSourceSchemaError("India NLEM 2022 input must be the official PDF.")
        limit = _positive_limit(max_records) if max_records is not None else None
        try:
            import pymupdf
        except ImportError as error:  # pragma: no cover - dependency failure
            raise OfficialSourceSchemaError("PyMuPDF is required for NLEM PDF extraction.") from error

        section_number: str | None = None
        section_title: str | None = None
        emitted = 0
        document = pymupdf.open(pdf_path)
        try:
            for page_number, page in enumerate(document, start=1):
                for table_index, table in enumerate(page.find_tables().tables, start=1):
                    for row in table.extract():
                        cells = [_clean_cell(item) for item in row]
                        heading = next((item for item in cells if item), "")
                        parsed_heading = _nlem_section_heading(heading)
                        if parsed_heading:
                            section_number, section_title = parsed_heading
                            continue
                        if len(cells) < 4 or not re.fullmatch(r"\d+(?:\.\d+)+", cells[0] or ""):
                            continue
                        item_number, medicine, healthcare, formulations = cells[:4]
                        if not medicine or not formulations:
                            yield self._adapt(
                                item_number=item_number or "unknown",
                                medicine=medicine or "",
                                healthcare=healthcare or "",
                                formulation="",
                                formulation_index=1,
                                section_number=section_number,
                                section_title=section_title,
                                page_number=page_number,
                                table_index=table_index,
                                issue="NLEM table row is missing medicine or formulation text.",
                            )
                            emitted += 1
                            if limit is not None and emitted >= limit:
                                return
                            continue
                        for formulation_index, formulation in enumerate(
                            _split_nlem_formulations(formulations), start=1
                        ):
                            yield self._adapt(
                                item_number=item_number,
                                medicine=medicine,
                                healthcare=healthcare or "",
                                formulation=formulation,
                                formulation_index=formulation_index,
                                section_number=section_number,
                                section_title=section_title,
                                page_number=page_number,
                                table_index=table_index,
                            )
                            emitted += 1
                            if limit is not None and emitted >= limit:
                                return
        finally:
            document.close()

    def _adapt(
        self, *, item_number: str, medicine: str, healthcare: str,
        formulation: str, formulation_index: int, section_number: str | None,
        section_title: str | None, page_number: int, table_index: int,
        issue: str | None = None,
    ) -> AdaptedOfficialRecord:
        clean_medicine = _clean_nlem_medicine_name(medicine)
        ingredients = _nlem_ingredients(clean_medicine)
        parsed = _parse_nlem_formulation(formulation, ingredients)
        record_id = f"{item_number}:f{formulation_index}"
        raw_values = {
            "canonical_name": f"{clean_medicine} - {formulation}" if formulation else clean_medicine,
            "generic_name": clean_medicine,
            "category": section_title,
            "dosage_form": parsed["dosage_form"],
            "strength_value": parsed["medicine_strength_value"],
            "strength_unit": parsed["medicine_strength_unit"],
            "ingredients": "|".join(ingredients),
            "ingredient_strength": "|".join(parsed["ingredient_strength_values"]),
            "ingredient_strength_unit": "|".join(parsed["ingredient_strength_units"]),
            "country": self.jurisdiction,
            "source_nlem_item_number": item_number,
            "source_nlem_section_number": section_number,
            "source_nlem_section_title": section_title,
            "source_nlem_healthcare_levels": healthcare,
            "source_nlem_formulation": formulation,
            "source_document_page": page_number,
            "source_table_index": table_index,
            "source_formulation_index": formulation_index,
            "source_entry_type": "fixed_dose_combination" if len(ingredients) > 1 else "single_medicine",
            "source_inclusion_is_marketing_approval": False,
        }
        source = SourceMetadata(
            source_dataset=self.source_dataset,
            source_record_id=record_id,
            source_url=self.source_url,
            source_record_hash=create_record_hash(raw_values),
            source_release=self.release,
            source_authority=self.source_authority,
            jurisdiction=self.jurisdiction,
        )
        issues = [issue] if issue else []
        return AdaptedOfficialRecord(
            RawRecord(data=raw_values, source=source, row_number=page_number), tuple(issues)
        )


def _positive_limit(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError("max_records must be a positive integer.")
    return value


def _clean_cell(value: object) -> str | None:
    if value is None:
        return None
    return re.sub(r"\s+", " ", str(value)).strip() or None


def _nlem_section_heading(value: str) -> tuple[str, str] | None:
    match = re.match(r"^(?:Section\s+)?(\d+(?:\.\d+)*)\s*[-:]\s*(.+)$", value, re.I)
    if not match:
        return None
    return match.group(1), match.group(2).strip()


_FORM_START = re.compile(
    r"^(?:tablet|capsule|injection|oral liquid|oral solution|oral suspension|"
    r"powder for injection|liquid for inhalation|solution|cream|ointment|gel|"
    r"eye drop|ear drop|ophthalmic|suppository|pessary|implant|inhalation|"
    r"modified release|dispersible|chewable|sublingual|transdermal|nasal spray|as licensed)",
    re.I,
)


def _split_nlem_formulations(value: str) -> list[str]:
    lines = [re.sub(r"\s+", " ", item).strip() for item in value.splitlines() if item.strip()]
    if len(lines) <= 1:
        # PyMuPDF table extraction often normalizes separate table-cell lines to
        # spaces. Re-split only at a recognized dosage-form boundary followed by
        # an explicit strength, preserving compound descriptions intact.
        lines = re.split(
            r"\s+(?=(?:Tablet|Capsule|(?<!Powder for )Injection|Oral liquid|Oral solution|"
            r"Oral suspension|Powder for injection|Liquid for inhalation|"
            r"Modified Release Tablet|Nasal Spray)\b)", value, flags=re.I,
        )
    output: list[str] = []
    for line in lines:
        if _FORM_START.match(line) or not output:
            output.append(line)
        else:
            output[-1] = f"{output[-1]} {line}"
    return output or [value]


def _clean_nlem_medicine_name(value: str) -> str:
    return re.sub(r"\*+$", "", re.sub(r"\s+", " ", value)).strip()


def _nlem_ingredients(value: str) -> list[str]:
    parts = re.split(r"\s*\+\s*", value)
    cleaned = [re.sub(r"\s*\([A-Z]\)\s*", "", item).strip() for item in parts]
    return [item for item in cleaned if item]


_STRENGTH = re.compile(r"(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>mcg|mg|g|IU|%)(?:\s*/\s*(?P<denom>\d+(?:\.\d+)?\s*)?(?P<denom_unit>mL|g))?", re.I)


def _parse_nlem_formulation(value: str, ingredients: list[str]) -> dict[str, object]:
    # Ranged strengths such as "2-5 %" describe a permitted interval, not one
    # exact formulation strength. Retain the source text but do not select an
    # endpoint as a structured value.
    strengths = [] if re.search(r"\d+(?:\.\d+)?\s*[-–]\s*\d", value) else list(_STRENGTH.finditer(value))
    dosage_form_text = value[:strengths[0].start()].strip(" -") if strengths else value.strip()
    dosage_form = dosage_form_text if dosage_form_text and not dosage_form_text.casefold().startswith("as licensed") else None
    pairs = [
        (m.group("value"), _strength_unit(m)) for m in strengths
    ]
    ingredient_values: list[str] = []
    ingredient_units: list[str] = []
    if len(ingredients) == len(pairs):
        ingredient_values = [item[0] for item in pairs]
        ingredient_units = [item[1] for item in pairs]
    elif len(ingredients) == 1 and len(pairs) == 1:
        ingredient_values = [pairs[0][0]]
        ingredient_units = [pairs[0][1]]
    return {
        "dosage_form": dosage_form,
        "medicine_strength_value": pairs[0][0] if len(ingredients) == 1 and len(pairs) == 1 else None,
        "medicine_strength_unit": pairs[0][1] if len(ingredients) == 1 and len(pairs) == 1 else None,
        "ingredient_strength_values": ingredient_values,
        "ingredient_strength_units": ingredient_units,
    }


def _strength_unit(match: re.Match[str]) -> str:
    unit = match.group("unit")
    denominator = match.group("denom")
    denominator_unit = match.group("denom_unit")
    if not denominator_unit:
        return unit
    return f"{unit}/{(denominator or '').strip()}{denominator_unit}"


def get_official_source_adapter(
    source: str,
    *,
    release: str,
    source_url: str | None = None,
    input_format: str = "csv",
) -> object:
    normalized = source.strip().casefold()
    if normalized == "rxnorm":
        if input_format.casefold() == "rrf":
            return RxNormRrfAdapter(release=release, source_url=source_url)
        if input_format.casefold() == "csv":
            return RxNormCsvAdapter(release=release, source_url=source_url)
        raise OfficialSourceSchemaError("RxNorm input format must be CSV or RRF.")
    if normalized == "india-nlem-2022":
        if input_format.casefold() != "pdf":
            raise OfficialSourceSchemaError("India NLEM 2022 input format must be PDF.")
        return IndiaNlem2022PdfAdapter(release=release, source_url=source_url)
    if normalized in {"india-nppa-standard", "india-nppa-special-feature"}:
        if input_format.casefold() != "xlsx":
            raise OfficialSourceSchemaError("India NPPA ceiling-price input format must be XLSX.")
        from .nppa_price_sources import (
            NppaSpecialFeatureCeilingPriceAdapter,
            NppaStandardCeilingPriceAdapter,
        )
        adapter_type = (
            NppaStandardCeilingPriceAdapter
            if normalized == "india-nppa-standard"
            else NppaSpecialFeatureCeilingPriceAdapter
        )
        return adapter_type(release=release, source_url=source_url)
    if normalized == "india-nppa-anticancer-revised-mrp":
        if input_format.casefold() != "pdf":
            raise OfficialSourceSchemaError("India NPPA anti-cancer revised-MRP input format must be PDF.")
        from .nppa_anticancer_mrp import NppaAntiCancerRevisedMrpPdfAdapter
        return NppaAntiCancerRevisedMrpPdfAdapter(release=release, source_url=source_url)
    if normalized == "india-pmbi-product-catalogue":
        if input_format.casefold() != "csv":
            raise OfficialSourceSchemaError("PMBI product catalogue input format must be CSV.")
        from .pmbi_product_sources import PmbiProductCatalogueAdapter
        return PmbiProductCatalogueAdapter(release=release, source_url=source_url)
    if normalized in {"who-eml", "cdsco", "dailymed", "nppa", "icmr"}:
        raise OfficialSourceUnavailableError(
            f"{normalized} requires a verified official extract schema before ingestion."
        )
    raise OfficialSourceUnavailableError("Unsupported official medicine source.")
