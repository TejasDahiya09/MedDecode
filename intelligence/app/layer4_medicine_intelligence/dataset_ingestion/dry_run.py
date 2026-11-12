"""Offline official-dataset normalization with no database dependencies."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from decimal import Decimal
import json
from pathlib import Path
from typing import Any

from .mapper import MedicineMapper
from .models import MedicineRecord, RawRecord
from .normalizer import MedicineNormalizer
from .official_sources import AdaptedOfficialRecord, get_official_source_adapter
from .transformer import MedicineTransformer
from .validator import MedicineValidator


@dataclass
class DryRunEntry:
    status: str
    source_record_id: str | None
    source_record_hash: str | None
    issues: list[str] = field(default_factory=list)
    normalized_record: dict[str, Any] | None = None
    source_fields: dict[str, Any] | None = None


@dataclass
class OfficialDryRunReport:
    source: str
    release: str
    accepted: list[DryRunEntry] = field(default_factory=list)
    rejected: list[DryRunEntry] = field(default_factory=list)
    ambiguous: list[DryRunEntry] = field(default_factory=list)
    duplicates: list[DryRunEntry] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.accepted) + len(self.rejected) + len(self.ambiguous) + len(self.duplicates)

    def export(self, path: str | Path) -> None:
        output_path = Path(path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "mode": "offline_dry_run",
            "source": self.source,
            "release": self.release,
            "counts": {
                "total": self.total,
                "accepted": len(self.accepted),
                "rejected": len(self.rejected),
                "ambiguous": len(self.ambiguous),
                "duplicates": len(self.duplicates),
            },
            "accepted": [asdict(item) for item in self.accepted],
            "rejected": [asdict(item) for item in self.rejected],
            "ambiguous": [asdict(item) for item in self.ambiguous],
            "duplicates": [asdict(item) for item in self.duplicates],
        }
        output_path.write_text(json.dumps(payload, indent=2, default=_json_value), encoding="utf-8")


def run_official_dry_run(
    input_path: str | Path,
    *,
    source: str,
    release: str,
    source_url: str | None = None,
    export_path: str | Path | None = None,
    max_records: int | None = None,
) -> OfficialDryRunReport:
    """Normalize and validate an official extract without database access."""

    input_format = "rrf" if Path(input_path).suffix.casefold() == ".rrf" else "csv"
    adapter = get_official_source_adapter(
        source, release=release, source_url=source_url, input_format=input_format
    )
    adapted = adapter.load(input_path, max_records=max_records)
    report = OfficialDryRunReport(source=source, release=release)

    grouped: dict[tuple[str, str], list[AdaptedOfficialRecord]] = {}
    for item in adapted:
        identifier = item.raw_record.source.source_record_id or f"row:{item.raw_record.row_number}"
        key = (item.raw_record.source.source_dataset, identifier)
        grouped.setdefault(key, []).append(item)

    mapper = MedicineMapper()
    transformer = MedicineTransformer()
    normalizer = MedicineNormalizer()
    validator = MedicineValidator()

    for items in grouped.values():
        hashes = {item.raw_record.source.source_record_hash for item in items}
        if len(items) > 1 and len(hashes) > 1:
            for item in items:
                report.ambiguous.append(_entry(item.raw_record, "ambiguous", [
                    "Conflicting records share the same official source identifier."
                ]))
            continue

        primary, *repeats = items
        for item in repeats:
            report.duplicates.append(_entry(item.raw_record, "duplicate", [
                "Exact duplicate official source record."
            ]))

        if primary.issues:
            report.rejected.append(_entry(primary.raw_record, "rejected", list(primary.issues)))
            continue

        medicine = normalizer.normalize(transformer.transform(mapper.map(primary.raw_record)))
        validation = validator.validate(medicine)
        if not validation.is_valid:
            report.rejected.append(_entry(
                primary.raw_record,
                "rejected",
                [issue.message for issue in validation.errors],
            ))
            continue
        report.accepted.append(_entry(
            primary.raw_record,
            "accepted",
            [issue.message for issue in validation.warnings],
            medicine,
        ))

    if export_path is not None:
        report.export(export_path)
    return report


def _entry(
    raw: RawRecord,
    status: str,
    issues: list[str],
    medicine: MedicineRecord | None = None,
) -> DryRunEntry:
    return DryRunEntry(
        status=status,
        source_record_id=raw.source.source_record_id,
        source_record_hash=raw.source.source_record_hash,
        issues=issues,
        normalized_record=_medicine_export(medicine) if medicine is not None else None,
        source_fields=dict(raw.data),
    )


def _medicine_export(medicine: MedicineRecord) -> dict[str, Any]:
    return {
        "canonical_name": medicine.canonical_name,
        "normalized_name": medicine.normalized_name,
        "brand_name": medicine.brand_name,
        "generic_name": medicine.generic_name,
        "dosage_form": medicine.dosage_form,
        "strength_value": medicine.strength_value,
        "strength_unit": medicine.strength_unit,
        "country": medicine.country,
        "ingredients": [asdict(item) for item in medicine.ingredients],
        "sources": [asdict(item) for item in medicine.sources],
    }


def _json_value(value: object) -> str:
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(f"Unsupported export type: {type(value).__name__}")
