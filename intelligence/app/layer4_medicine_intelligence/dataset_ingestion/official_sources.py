"""Authoritative-source adapters feeding the existing ingestion contracts."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
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


def _positive_limit(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError("max_records must be a positive integer.")
    return value


def get_official_source_adapter(
    source: str,
    *,
    release: str,
    source_url: str | None = None,
    input_format: str = "csv",
) -> RxNormCsvAdapter:
    normalized = source.strip().casefold()
    if normalized == "rxnorm":
        if input_format.casefold() == "rrf":
            return RxNormRrfAdapter(release=release, source_url=source_url)
        if input_format.casefold() == "csv":
            return RxNormCsvAdapter(release=release, source_url=source_url)
        raise OfficialSourceSchemaError("RxNorm input format must be CSV or RRF.")
    if normalized in {"who-eml", "india-nlem-2022", "cdsco", "dailymed", "nppa", "icmr"}:
        raise OfficialSourceUnavailableError(
            f"{normalized} requires a verified official extract schema before ingestion."
        )
    raise OfficialSourceUnavailableError("Unsupported official medicine source.")
