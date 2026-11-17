"""Offline adapters for official CDSCO prohibition and restriction PDFs."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path
import re

import pymupdf

from .loader import create_record_hash
from .models import RegulatoryRestrictionEvent, SourceMetadata
from .official_sources import OfficialSourceSchemaError


_DATE = re.compile(r"(?<!\d)(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})(?!\d)")
_SERIAL = re.compile(r"^\s*(\d+)\s*\.")
_FOOTNOTE = re.compile(r"(?:^|\s)([1-9])#(?:\s|$)")
_REFERENCE = re.compile(
    r"\b(?:(?:G\.?\s*S\.?\s*R\.?|S\.?\s*O\.?)\s*(?:NO\.?\s*)?\d+\s*\(E\))",
    re.I,
)
_STRENGTH = re.compile(r"(?P<name>.*?)(?P<value>\d+(?:\.\d+)?(?:/\d+(?:\.\d+)?)?)\s*(?P<unit>mcg|mg|g|iu|%)\b", re.I)
_FORM = re.compile(r"\b(hard gelatin capsules?|capsules?|tablets?|syrups?|injections?|creams?|ointments?|solutions?|suspensions?|inhalers?)\b", re.I)
_ROUTE = re.compile(r"\b(oral|intravenous|intramuscular|subcutaneous|topical|inhalation|internal use|external use)\b", re.I)


@dataclass
class CdscoRestrictionDryRunReport:
    source: str
    release: str
    category: str
    accepted: list[RegulatoryRestrictionEvent]
    deferred: list[dict[str, object]]
    rejected: list[dict[str, object]]
    ambiguous: list[dict[str, object]]
    duplicates: list[dict[str, object]]

    @property
    def total(self) -> int:
        return len(self.accepted) + len(self.deferred) + len(self.rejected)

    def export(self, path: str | Path) -> None:
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({
            "mode": "offline_regulatory_restriction_dry_run",
            "source": self.source,
            "release": self.release,
            "category": self.category,
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
        }, indent=2), encoding="utf-8")


class CdscoRestrictionPdfAdapter:
    """Extract exact notice-scoped events without asserting present legal status."""

    source_authority = (
        "Central Drugs Standard Control Organization, Directorate General of Health Services, "
        "Ministry of Health & Family Welfare, Government of India"
    )

    def __init__(self, *, category: str, release: str, source_url: str) -> None:
        category = category.strip().casefold().replace("_", "-")
        if category not in {"prohibited", "banned", "restricted", "historical-prohibition"}:
            raise ValueError("Unsupported CDSCO restriction category.")
        if not release.strip() or not source_url.strip():
            raise ValueError("Release and official source URL are required.")
        self.category = category
        self.release = release.strip()
        self.source_url = source_url.strip()

    def load(self, path: str | Path, *, max_records: int | None = None) -> CdscoRestrictionDryRunReport:
        pdf_path = Path(path)
        if not pdf_path.is_file() or pdf_path.suffix.casefold() != ".pdf":
            raise OfficialSourceSchemaError("CDSCO restriction input must be an existing PDF.")
        digest = _file_sha256(pdf_path)
        accepted: list[RegulatoryRestrictionEvent] = []
        deferred: list[dict[str, object]] = []
        rejected: list[dict[str, object]] = []
        ambiguous: list[dict[str, object]] = []
        duplicates: list[dict[str, object]] = []
        seen: dict[tuple[str, str | None, str | None], RegulatoryRestrictionEvent] = {}
        document = pymupdf.open(pdf_path)
        try:
            title = _document_title(document)
            notes = _footnotes(document) if self.category == "historical-prohibition" else {}
            for candidate in _iter_table_rows(document):
                if max_records is not None and len(accepted) + len(deferred) + len(rejected) >= max_records:
                    break
                outcome, payload = self._adapt(candidate, digest, title, notes)
                if outcome == "accepted":
                    key = (_key(payload.restricted_name), payload.effective_date, payload.notification_reference)
                    prior = seen.get(key)
                    if prior is not None:
                        duplicates.append({"event_id": payload.event_id, "duplicates": prior.event_id})
                        continue
                    seen[key] = payload
                    accepted.append(payload)
                    if payload.footnote_marker and not payload.conditions:
                        ambiguous.append({"event_id": payload.event_id, "reason": "footnote marker has no extracted condition"})
                elif outcome == "deferred":
                    deferred.append(payload)
                else:
                    rejected.append(payload)
        finally:
            document.close()
        return CdscoRestrictionDryRunReport(str(pdf_path), self.release, self.category, accepted, deferred, rejected, ambiguous, duplicates)

    def _adapt(self, row: dict[str, object], digest: str, title: str | None, notes: dict[str, str]):
        name = _clean(row.get("name"))
        notification = _clean(row.get("notification"))
        if not name:
            return "rejected", {"page": row["page"], "row": row["row"], "reason": "missing restricted drug text"}
        effective = _parse_date(notification)
        reference_match = _REFERENCE.search(notification)
        reference = _clean(reference_match.group(0)) if reference_match else None
        if not effective:
            return "deferred", {"page": row["page"], "row": row["row"], "name": name, "reason": "missing or unclear notification date", "raw": row["raw"]}
        marker_match = _FOOTNOTE.search(name)
        marker = marker_match.group(1) if marker_match else None
        clean_name = _FOOTNOTE.sub(" ", name)
        clean_name = _clean(clean_name) or name
        condition = notes.get(marker or "")
        form_match = _FORM.search(clean_name)
        route_match = _ROUTE.search(clean_name)
        qualifiers = []
        for keyword in ("except", "excluding", "subject to", "only", "for internal use", "for external use"):
            if keyword in clean_name.casefold():
                qualifiers.append(keyword)
        legal_scope = "Exact listed drug/formulation or class wording only; no ingredient-level generalization."
        if qualifiers:
            legal_scope += " Source qualifiers: " + ", ".join(qualifiers) + "."
        raw = _clean(row.get("raw")) or " | ".join(filter(None, [name, notification]))
        event_id = f"{self.category}:{digest[:12]}:{row['serial']}:{effective}"
        source = SourceMetadata(
            source_dataset=f"cdsco_{self.category.replace('-', '_')}_notices",
            source_record_id=event_id,
            source_url=self.source_url,
            source_record_hash=create_record_hash({"name": name, "notification": notification, "page": row["page"]}),
            source_release=self.release,
            source_authority=self.source_authority,
            jurisdiction="India",
        )
        return "accepted", RegulatoryRestrictionEvent(
            event_id=event_id,
            event_type="regulatory-restriction-notice",
            regulatory_category=self.category,
            restricted_name=clean_name,
            effective_date=effective,
            publication_date=None,
            document_as_of_date="2021-11-22" if self.category == "historical-prohibition" else None,
            notification_reference=reference,
            dosage_form=form_match.group(0) if form_match else None,
            route=route_match.group(0) if route_match else None,
            ingredients=_ingredients(clean_name),
            legal_scope=legal_scope,
            conditions=condition,
            exemptions=_qualifier_text(clean_name),
            footnote_marker=marker,
            source_page=int(row["page"]),
            source_row=int(row["row"]),
            source_document_sha256=digest,
            source_document_title=title,
            raw_source_text=raw,
            establishes_current_status=False,
            source=source,
        )


def _iter_table_rows(document: pymupdf.Document):
    current: dict[str, object] | None = None
    for page_number, page in enumerate(document, start=1):
        for table in page.find_tables().tables:
            for row_number, row in enumerate(table.extract(), start=1):
                cells = [_clean(value) or "" for value in row]
                if len(cells) < 3:
                    continue
                match = _SERIAL.match(cells[0])
                if match:
                    if current:
                        yield current
                    current = {
                        "serial": int(match.group(1)), "name": cells[1], "notification": cells[2],
                        "page": page_number, "row": row_number,
                    }
                elif current and not _is_header(cells):
                    if _FOOTNOTE.search(cells[0]):
                        current["name"] = _join(current["name"], cells[0])
                    current["name"] = _join(current["name"], cells[1])
                    current["notification"] = _join(current["notification"], cells[2])
                if current:
                    current["raw"] = " | ".join(filter(None, [str(current["name"]), str(current["notification"])]))
    if current:
        yield current


def _footnotes(document: pymupdf.Document) -> dict[str, str]:
    text = "\n".join(page.get_text("text") for page in document)
    matches = list(re.finditer(r"(?m)^\s*([1-9])#\s*", text))
    notes: dict[str, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        notes[match.group(1)] = _clean(text[match.start():end]) or ""
    return notes


def _ingredients(name: str) -> list[dict[str, str | None]]:
    if "+" not in name:
        return []
    result = []
    for part in name.split("+"):
        part = _clean(part)
        if not part:
            continue
        match = _STRENGTH.search(part)
        ingredient_name = _clean(match.group("name")) if match else part
        result.append({
            "name": ingredient_name,
            "strength_value": match.group("value") if match else None,
            "strength_unit": match.group("unit") if match else None,
        })
    return result


def _qualifier_text(name: str) -> str | None:
    match = re.search(r"\b(except|excluding|subject to)\b.*", name, re.I)
    return _clean(match.group(0)) if match else None


def _parse_date(value: str | None) -> str | None:
    normalized = value or ""
    normalized = re.sub(r"(?<=\d)\s+(?=\d[.\-/])", "", normalized)
    normalized = re.sub(r"\s*([.\-/])\s*", r"\1", normalized)
    match = _DATE.search(normalized)
    if not match:
        return None
    day, month, year = (int(item) for item in match.groups())
    if year < 100:
        year += 2000 if year <= 26 else 1900
    try:
        return datetime(year, month, day).date().isoformat()
    except ValueError:
        return None


def _document_title(document: pymupdf.Document) -> str | None:
    if not document.page_count:
        return None
    lines = [line.strip() for line in document[0].get_text("text").splitlines() if line.strip()]
    return " ".join(lines[:3])[:500] or None


def _is_header(cells: list[str]) -> bool:
    text = " ".join(cells).casefold()
    return "drugs name" in text or "notification" in text or "sr. no" in text or "s. no" in text


def _join(left: object, right: object) -> str:
    return " ".join(filter(None, [_clean(left), _clean(right)]))


def _clean(value: object) -> str | None:
    text = " ".join(str(value or "").split()).strip()
    return text or None


def _key(value: str) -> str:
    return " ".join(value.casefold().split())


def _file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
