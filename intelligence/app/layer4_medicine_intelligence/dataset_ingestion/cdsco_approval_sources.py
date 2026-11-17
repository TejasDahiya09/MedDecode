"""Official CDSCO positive approval-event PDF adapters (offline only)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from hashlib import sha256
from pathlib import Path
import re
from typing import Iterator

import pymupdf

from .loader import create_record_hash
from .models import RegulatoryApprovalEvent, SourceMetadata
from .official_sources import OfficialSourceSchemaError


_HEADER_ALIASES = {
    "serial": {"s no", "sno", "sr no", "sl no", "#"},
    "name": {"name of new drug", "name of drug", "name of fdc", "drug name", "drug", "fdc"},
    "composition": {"composition"},
    "indication": {"indication", "approved indication"},
    "approval_date": {"date of approval", "approval date"},
    "applicant": {"company", "company name", "firm name", "applicant"},
    "reference": {"permission no", "permission number", "reference", "notification"},
}
_STRENGTH = re.compile(
    r"(?P<ingredient>[A-Za-z][A-Za-z0-9 ()/.,'-]*?)\s+"
    r"(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>mcg|mg|g|iu|%)(?=\s*(?:\+|&|,|\b(?:film\s+coated\s+tablet|tablet|capsule|injection|solution|suspension|cream|gel|powder|inhaler)\b|$))",
    re.I,
)
_FORM = re.compile(
    r"\b(film coated tablets?|tablets?|capsules?|injections?|solutions?|suspensions?|"
    r"cream|gel|powder for (?:oral suspension|injection|infusion)|inhaler)\b",
    re.I,
)
_ROUTE = re.compile(r"\b(oral|intravenous|intramuscular|subcutaneous|topical|inhalation)\b", re.I)


@dataclass
class CdscoApprovalDryRunReport:
    source: str
    release: str
    accepted: list[RegulatoryApprovalEvent]
    deferred: list[dict[str, object]]
    rejected: list[dict[str, object]]
    ambiguous: list[dict[str, object]]
    duplicates: list[dict[str, object]]

    @property
    def total(self) -> int:
        # Ambiguities and duplicates are annotations over extracted events, not
        # additional source rows, so they must not inflate the row total.
        return len(self.accepted) + len(self.deferred) + len(self.rejected)

    def export(self, path: str | Path) -> None:
        import json
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "mode": "offline_regulatory_event_dry_run",
            "source": self.source,
            "release": self.release,
            "counts": {
                "total": self.total,
                "accepted": len(self.accepted),
                "deferred": len(self.deferred),
                "rejected": len(self.rejected),
                "ambiguous": len(self.ambiguous),
                "duplicates": len(self.duplicates),
            },
            "accepted": [asdict(item) for item in self.accepted],
            "deferred": self.deferred,
            "rejected": self.rejected,
            "ambiguous": self.ambiguous,
            "duplicates": self.duplicates,
        }
        output.write_text(json.dumps(payload, indent=2), encoding="utf-8")


class CdscoApprovalEventPdfAdapter:
    """Extracts positive approval events from an inspected CDSCO list schema.

    Supported categories are deliberately limited to positive new-drug and FDC
    approval lists. Prohibition, restriction, withdrawal, and regularisation
    documents require separate source-specific adapters.
    """

    source_authority = (
        "Central Drugs Standard Control Organization, Directorate General of Health Services, "
        "Ministry of Health & Family Welfare, Government of India"
    )
    jurisdiction = "India"

    def __init__(
        self,
        *,
        category: str,
        release: str,
        source_url: str,
    ) -> None:
        normalized = category.strip().casefold().replace("_", "-")
        if normalized not in {"new-drug", "fdc-marketing-permission"}:
            raise ValueError("CDSCO adapter supports only positive new-drug or FDC approval lists.")
        if not release.strip() or not source_url.strip():
            raise ValueError("CDSCO release and official source URL are required.")
        self.category = normalized
        self.release = release.strip()
        self.source_url = source_url.strip()
        self.source_dataset = (
            "cdsco_approved_new_drugs"
            if normalized == "new-drug"
            else "cdsco_fdc_marketing_permissions"
        )

    def load(self, path: str | Path, *, max_records: int | None = None) -> CdscoApprovalDryRunReport:
        pdf_path = Path(path)
        if not pdf_path.is_file():
            raise FileNotFoundError(f"Official CDSCO PDF does not exist: {pdf_path}")
        if pdf_path.suffix.casefold() != ".pdf":
            raise OfficialSourceSchemaError("CDSCO approval-event input must be PDF.")
        limit = _positive_limit(max_records) if max_records is not None else None
        digest = _file_sha256(pdf_path)
        accepted: list[RegulatoryApprovalEvent] = []
        deferred: list[dict[str, object]] = []
        rejected: list[dict[str, object]] = []
        ambiguous: list[dict[str, object]] = []
        duplicates: list[dict[str, object]] = []
        document = pymupdf.open(pdf_path)
        try:
            document_title = _document_title(document)
            for candidate in self._iter_rows(document):
                if limit is not None and len(accepted) + len(deferred) + len(rejected) + len(ambiguous) >= limit:
                    break
                outcome, payload = self._adapt(candidate, digest, document_title)
                if outcome == "accepted":
                    accepted.append(payload)
                elif outcome == "deferred":
                    deferred.append(payload)
                else:
                    rejected.append(payload)
        finally:
            document.close()
        if not accepted and not deferred and not rejected:
            raise OfficialSourceSchemaError("No supported CDSCO approval table was found in the PDF.")
        seen: dict[tuple[str, str | None, str], RegulatoryApprovalEvent] = {}
        for event in accepted:
            key = (_key(event.approved_name), event.approval_date, event.permission_category)
            previous = seen.get(key)
            if previous is None:
                seen[key] = event
            elif previous.raw_source_text == event.raw_source_text:
                duplicates.append({
                    "event_ids": [previous.event_id, event.event_id],
                    "reason": "Exact repeated approval event within the same source document.",
                })
            else:
                ambiguous.append({
                    "event_ids": [previous.event_id, event.event_id],
                    "reason": "Same approval identity has conflicting source text within the document.",
                })
        return CdscoApprovalDryRunReport(
            source=self.source_dataset,
            release=self.release,
            accepted=accepted,
            deferred=deferred,
            rejected=rejected,
            ambiguous=ambiguous,
            duplicates=duplicates,
        )

    def _iter_rows(self, document: pymupdf.Document) -> Iterator[dict[str, object]]:
        pending: dict[str, object] | None = None
        for page_number, page in enumerate(document, start=1):
            for table_index, table in enumerate(page.find_tables().tables, start=1):
                rows = table.extract()
                if not rows:
                    continue
                header_index, headers = _find_headers(rows)
                start = header_index + 1 if header_index is not None else 0
                for table_row, cells in enumerate(rows[start:], start=start + 1):
                    values = _positional_values(cells, headers)
                    if not any(values.values()):
                        continue
                    if _looks_like_header(values):
                        continue
                    candidate = {
                        "values": values,
                        "page": page_number,
                        "table": table_index,
                        "row": table_row,
                    }
                    if _is_continuation(values):
                        if pending is not None:
                            _merge_continuation(pending["values"], values)
                            pending.setdefault("continuation_pages", []).append(page_number)
                        continue
                    if pending is not None:
                        yield pending
                    pending = candidate
        if pending is not None:
            yield pending

    def _adapt(
        self,
        candidate: dict[str, object],
        document_hash: str,
        document_title: str | None,
    ) -> tuple[str, RegulatoryApprovalEvent | dict[str, object]]:
        values = candidate["values"]
        name = values.get("name")
        serial = values.get("serial")
        date_text = values.get("approval_date")
        page = int(candidate["page"])
        row = int(candidate["row"])
        raw = " | ".join(str(values.get(key) or "") for key in (
            "serial", "name", "composition", "indication", "approval_date", "applicant", "reference"
        ))
        if not name:
            return "rejected", _issue(candidate, "Missing approved drug/formulation name.")
        approval_date = _parse_date(date_text)
        if date_text and approval_date is None:
            return "deferred", _issue(candidate, "Approval date format is unclear.")
        if not date_text:
            return "deferred", _issue(candidate, "Approval date is missing.")
        source_record_id = (
            f"{self.category}:{document_hash[:12]}:{serial or f'p{page}-r{row}'}:{approval_date}"
        )
        event_id = f"cdsco:{source_record_id}"
        ingredients = _explicit_ingredients(values.get("composition") or name)
        source_values = {
            "event_id": event_id,
            "event_type": "approval",
            "permission_category": self.category,
            "approved_name": name,
            "composition": values.get("composition"),
            "approval_date": approval_date,
            "document_release_date": self.release,
            "applicant": values.get("applicant"),
            "indication": values.get("indication"),
            "official_reference": values.get("reference"),
            "source_page": page,
            "source_row": row,
            "raw_source_text": raw,
            "source_document_title": document_title,
        }
        source = SourceMetadata(
            source_dataset=self.source_dataset,
            source_record_id=source_record_id,
            source_url=self.source_url,
            source_record_hash=create_record_hash(source_values),
            source_release=self.release,
            source_authority=self.source_authority,
            jurisdiction=self.jurisdiction,
        )
        form = _FORM.search(name)
        route = _ROUTE.search(name)
        event = RegulatoryApprovalEvent(
            event_id=event_id,
            event_type="approval",
            permission_category=self.category,
            approved_name=name,
            composition=values.get("composition"),
            approval_date=approval_date,
            document_release_date=self.release,
            applicant=values.get("applicant"),
            indication=values.get("indication"),
            dosage_form=form.group(1) if form else None,
            route=route.group(1) if route else None,
            ingredients=ingredients,
            official_reference=values.get("reference"),
            source_page=page,
            source_row=row,
            source_document_sha256=document_hash,
            source_document_title=document_title,
            raw_source_text=raw,
            is_fdc=self.category == "fdc-marketing-permission",
            establishes_current_status=False,
            source=source,
        )
        return "accepted", event


def get_cdsco_approval_adapter(
    source: str, *, release: str, source_url: str
) -> CdscoApprovalEventPdfAdapter:
    """Small source registry kept separate from medicine-catalog ingestion."""
    normalized = source.strip().casefold()
    categories = {
        "cdsco-approved-new-drugs": "new-drug",
        "cdsco-fdc-marketing-permissions": "fdc-marketing-permission",
    }
    if normalized not in categories:
        raise OfficialSourceSchemaError(
            "Unsupported CDSCO approval-event source; negative regulatory events require a separate adapter."
        )
    return CdscoApprovalEventPdfAdapter(
        category=categories[normalized], release=release, source_url=source_url
    )


def _map_headers(row: list[str | None]) -> dict[str, int]:
    mapped: dict[str, int] = {}
    for index, value in enumerate(row):
        normalized = _header(value)
        for field, aliases in _HEADER_ALIASES.items():
            if normalized in aliases:
                mapped[field] = index
                break
    return mapped


def _find_headers(rows: list[list[str | None]]) -> tuple[int | None, dict[str, int]]:
    for index, row in enumerate(rows[:4]):
        direct = _map_headers(row)
        if "name" in direct and "approval_date" in direct:
            return index, direct
        combined = list(row)
        if index + 1 < len(rows):
            following = rows[index + 1]
            combined = [
                " ".join(filter(None, (_clean(value), _clean(following[column] if column < len(following) else None))))
                for column, value in enumerate(row)
            ]
        mapped = _map_headers(combined)
        if "name" in mapped and "approval_date" in mapped:
            return index + 1 if index + 1 < len(rows) and _is_header_fragment(rows[index + 1]) else index, mapped
    return None, {}


def _positional_values(
    cells: list[str | None], headers: dict[str, int]
) -> dict[str, str | None]:
    if headers:
        values = {
            field: _clean(cells[index] if index < len(cells) else None)
            for field, index in headers.items()
        }
    elif len(cells) >= 5:
        values = {
            "serial": _clean(cells[0]),
            "name": _clean(cells[1]),
            "composition": _clean(cells[2]),
            "indication": _clean(cells[3]),
            "approval_date": _clean(cells[4]),
        }
    elif len(cells) >= 4:
        values = {
            "serial": _clean(cells[0]),
            "name": _clean(cells[1]),
            "indication": _clean(cells[2]),
            "approval_date": _clean(cells[3]),
        }
    else:
        return {}
    if not _parse_date(values.get("approval_date")):
        for cell in reversed(cells[3:]):
            candidate = _clean(cell)
            if _parse_date(candidate):
                values["approval_date"] = candidate
                break
    return values


def _is_header_fragment(row: list[str | None]) -> bool:
    text = _header(" ".join(value or "" for value in row))
    return text in {"approval", "date of approval", "approval date"} or (
        "approval" in text and not any(char.isdigit() for char in text)
    )


def _looks_like_header(values: dict[str, str | None]) -> bool:
    name = _header(values.get("name"))
    return name in _HEADER_ALIASES["name"] or "approved by dcg" in name


def _is_continuation(values: dict[str, str | None]) -> bool:
    return (
        not _clean(values.get("serial"))
        and not _clean(values.get("name"))
        and not _parse_date(values.get("approval_date"))
        and bool(_clean(values.get("composition")) or _clean(values.get("indication")))
    )


def _merge_continuation(
    target: dict[str, str | None], continuation: dict[str, str | None]
) -> None:
    for field in ("name", "composition", "indication"):
        extra = _clean(continuation.get(field))
        if extra:
            target[field] = _clean(" ".join(filter(None, (target.get(field), extra))))


def _document_title(document: pymupdf.Document) -> str | None:
    if document.page_count < 1:
        return None
    for line in document[0].get_text("text").splitlines():
        cleaned = _clean(line)
        if cleaned:
            return cleaned
    return None


def _explicit_ingredients(value: str) -> list[dict[str, str | None]]:
    ingredients = []
    for match in _STRENGTH.finditer(value):
        ingredient = _clean(match.group("ingredient"))
        ingredient = re.sub(r"^(?:and|&|\+)\s+", "", ingredient, flags=re.I)
        ingredients.append({
            "name": ingredient,
            "strength_value": match.group("value"),
            "strength_unit": match.group("unit"),
        })
    return ingredients


def _parse_date(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.strip()
    for pattern in ("%d.%m.%Y", "%d-%m-%Y", "%d-%m-%y", "%d/%m/%Y", "%d/%m/%y", "%b-%y"):
        try:
            parsed = datetime.strptime(cleaned, pattern).date()
            if "%y" in pattern and parsed.year > 2026:
                parsed = parsed.replace(year=parsed.year - 100)
            if pattern == "%b-%y":
                return parsed.replace(day=1).isoformat()
            return parsed.isoformat()
        except ValueError:
            continue
    return None


def _issue(candidate: dict[str, object], message: str) -> dict[str, object]:
    return {
        "page": candidate["page"],
        "table": candidate["table"],
        "row": candidate["row"],
        "source_values": candidate["values"],
        "issues": [message],
    }


def _file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _header(value: str | None) -> str:
    return re.sub(r"[^a-z0-9#]+", " ", (value or "").casefold()).strip()


def _clean(value: str | None) -> str | None:
    cleaned = re.sub(r"\s+", " ", value or "").strip()
    return cleaned or None


def _key(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").casefold()).strip()


def _positive_limit(value: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError("max_records must be a positive integer.")
    return value
