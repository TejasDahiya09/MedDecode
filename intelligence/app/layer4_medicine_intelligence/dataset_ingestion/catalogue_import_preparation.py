"""Database-independent preparation of official catalogue source records.

This module deliberately emits source-aware candidates rather than database
rows. It performs no I/O beyond reading explicit JSON exports and writing an
explicitly requested local report.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from hashlib import sha256
import json
from pathlib import Path
import re
from typing import Any, Iterable


PARSER_VERSION = "catalogue-import-preparation-v1"


@dataclass(frozen=True)
class PreparedSourceRecord:
    stable_id: str
    source_dataset: str
    source_release: str | None
    source_record_id: str
    content_hash: str
    parser_version: str
    original_payload: dict[str, Any]
    entities: tuple[str, ...]


@dataclass(frozen=True)
class CatalogueCandidate:
    candidate_id: str
    source_record_stable_id: str
    entity_type: str
    identity: dict[str, Any]
    evidence: dict[str, Any]


@dataclass(frozen=True)
class LinkageCandidate:
    left_candidate_id: str
    right_candidate_id: str | None
    status: str
    reason: str
    identity_signature: str | None = None


@dataclass
class CataloguePreparationReport:
    parser_version: str = PARSER_VERSION
    source_records: list[PreparedSourceRecord] = field(default_factory=list)
    candidates: list[CatalogueCandidate] = field(default_factory=list)
    linkages: list[LinkageCandidate] = field(default_factory=list)
    duplicate_replays: list[dict[str, str]] = field(default_factory=list)
    conflicting_replays: list[dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        statuses = {"exact": 0, "uncertain": 0, "unmatched": 0}
        for linkage in self.linkages:
            statuses[linkage.status] += 1
        entity_counts: dict[str, int] = {}
        for candidate in self.candidates:
            entity_counts[candidate.entity_type] = entity_counts.get(candidate.entity_type, 0) + 1
        return {
            "mode": "offline_catalogue_import_preparation",
            "parser_version": self.parser_version,
            "counts": {
                "source_records": len(self.source_records),
                "candidates": len(self.candidates),
                "entities": entity_counts,
                "linkages": statuses,
                "duplicate_replays": len(self.duplicate_replays),
                "conflicting_replays": len(self.conflicting_replays),
            },
            "source_records": [asdict(item) for item in self.source_records],
            "candidates": [asdict(item) for item in self.candidates],
            "linkages": [asdict(item) for item in self.linkages],
            "duplicate_replays": self.duplicate_replays,
            "conflicting_replays": self.conflicting_replays,
        }

    def export(self, path: str | Path) -> None:
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")


def prepare_catalogue_import(
    export_paths: Iterable[str | Path], *, max_records_per_export: int | None = None
) -> CataloguePreparationReport:
    report = CataloguePreparationReport()
    seen_records: dict[str, PreparedSourceRecord] = {}
    for export_path in export_paths:
        path = Path(export_path)
        payload = json.loads(path.read_text(encoding="utf-8"))
        accepted = payload.get("accepted")
        if not isinstance(accepted, list):
            raise ValueError(f"Normalized export has no accepted record list: {path}")
        records = accepted[:max_records_per_export] if max_records_per_export is not None else accepted
        for ordinal, original in enumerate(records, start=1):
            if not isinstance(original, dict):
                continue
            source = _source_metadata(original)
            dataset = _required(source.get("source_dataset"), "source_dataset", path)
            record_id = _required(
                source.get("source_record_id") or original.get("event_id"), "source_record_id", path
            )
            release = _optional(source.get("source_release") or payload.get("release"))
            stable_id = _stable_id(dataset, release, record_id)
            content_hash = _optional(source.get("source_record_hash")) or _hash_json(original)
            entities = _entities_for(original)
            prepared = PreparedSourceRecord(
                stable_id=stable_id,
                source_dataset=dataset,
                source_release=release,
                source_record_id=record_id,
                content_hash=content_hash,
                parser_version=PARSER_VERSION,
                original_payload=original,
                entities=tuple(entities),
            )
            prior = seen_records.get(stable_id)
            if prior:
                item = {"stable_id": stable_id, "first_hash": prior.content_hash, "replay_hash": content_hash}
                if prior.content_hash == content_hash:
                    report.duplicate_replays.append(item)
                else:
                    report.conflicting_replays.append(item)
                continue
            seen_records[stable_id] = prepared
            report.source_records.append(prepared)
            report.candidates.extend(_candidates(prepared, original, ordinal))
    report.linkages = _link_candidates(report.candidates)
    return report


def _candidates(record: PreparedSourceRecord, payload: dict[str, Any], ordinal: int) -> list[CatalogueCandidate]:
    normalized: dict[str, Any] = {}
    raw_normalized = payload.get("normalized_record")
    if isinstance(raw_normalized, dict):
        normalized = raw_normalized
    source_fields: dict[str, Any] = {}
    raw_source_fields = payload.get("source_fields")
    if isinstance(raw_source_fields, dict):
        source_fields = raw_source_fields
    product_kind = _optional(source_fields.get("source_pmbi_product_kind"))
    result: list[CatalogueCandidate] = []
    ingredients = normalized.get("ingredients") if isinstance(normalized.get("ingredients"), list) else payload.get("ingredients", [])
    ingredient_identity = []
    for index, item in enumerate(ingredients or [], start=1):
        if not isinstance(item, dict):
            continue
        raw_ingredient = item.get("ingredient")
        ingredient = raw_ingredient if isinstance(raw_ingredient, dict) else item
        name = _optional(ingredient.get("normalized_name") or ingredient.get("ingredient_name") or ingredient.get("name"))
        strength_value = _optional(item.get("ingredient_strength_value") or item.get("strength_value"))
        strength_unit = _normalize(item.get("ingredient_strength_unit") or item.get("strength_unit"))
        if not name:
            continue
        identity = {"name": _normalize(name), "strength_value": strength_value, "strength_unit": strength_unit}
        ingredient_identity.append(identity)
        result.append(_candidate(record, "ingredient", index, identity, item))

    if normalized and product_kind == "surgical_medical_consumable":
        # A PMBI consumable is retained as a product/package source record, not
        # misclassified as a medicine formulation merely because it shares the
        # CSV with medicine products.
        result.append(_candidate(record, "surgical_medical_consumable", ordinal, {
            "name": _normalize(normalized.get("canonical_name")),
            "category": _optional(source_fields.get("source_pmbi_group_name")),
            "drug_code": _optional(source_fields.get("source_pmbi_drug_code")),
        }, normalized))
        for index, price in enumerate(normalized.get("prices") or [], start=1):
            if not isinstance(price, dict):
                continue
            result.append(_candidate(
                record, "price_observation",
                index, _price_identity(price, record, source_fields), price,
            ))
            result.append(_candidate(record, "product_package", index, {
                "description": _optional(price.get("package_description")),
                "unit": _optional(price.get("package_quantity_unit")),
                "quantity": _optional(price.get("quantity")),
                "product_kind": product_kind,
                "special_feature_qualifier": _optional(
                    price.get("special_feature_qualifier")
                ),
            }, price))
    elif normalized:
        form_identity = {
            "ingredients": sorted(ingredient_identity, key=_canonical_json),
            "dosage_form": _normalize(normalized.get("dosage_form")),
            "release_type": _normalize(source_fields.get("source_release_type")),
        }
        result.append(_candidate(record, "formulation", ordinal, form_identity, normalized))
        brand = _optional(normalized.get("brand_name"))
        if brand:
            result.append(_candidate(record, "brand_product", ordinal, {
                "brand_name": _normalize(brand), "formulation": form_identity,
                "manufacturer": _normalize(source_fields.get("manufacturer_name")),
            }, normalized))
        for index, price in enumerate(normalized.get("prices") or [], start=1):
            if not isinstance(price, dict):
                continue
            price_identity = _price_identity(price, record, source_fields)
            result.append(_candidate(record, "price_observation", index, price_identity, price))
            if price.get("package_description") or price.get("price_unit"):
                result.append(_candidate(record, "product_package", index, {
                    "description": _optional(price.get("package_description")),
                    "unit": _optional(price.get("package_quantity_unit")),
                    "quantity": _optional(price.get("quantity")),
                    "special_feature_qualifier": _optional(
                        price.get("special_feature_qualifier")
                    ),
                    "formulation": form_identity,
                }, price))
    elif payload.get("event_type"):
        category = payload.get("permission_category") or payload.get("regulatory_category")
        result.append(_candidate(record, "regulatory_event", ordinal, {
            "event_type": _optional(payload.get("event_type")),
            "category": _optional(category),
            "event_date": _optional(payload.get("approval_date") or payload.get("effective_date")),
            "notification_reference": _optional(payload.get("official_reference") or payload.get("notification_reference")),
            "source_record_id": record.source_record_id,
        }, payload))
    return result


def _link_candidates(candidates: list[CatalogueCandidate]) -> list[LinkageCandidate]:
    formulations = [item for item in candidates if item.entity_type == "formulation"]
    by_signature: dict[str, list[CatalogueCandidate]] = {}
    incomplete: set[str] = set()
    for item in formulations:
        signature = _formulation_signature(item.identity)
        if signature is None:
            incomplete.add(item.candidate_id)
        else:
            by_signature.setdefault(signature, []).append(item)
    links: list[LinkageCandidate] = []
    for item in formulations:
        signature = _formulation_signature(item.identity)
        if signature is None:
            links.append(LinkageCandidate(item.candidate_id, None, "uncertain", "required formulation identity fields are incomplete"))
            continue
        peers = [peer for peer in by_signature[signature] if peer.source_record_stable_id != item.source_record_stable_id]
        if peers:
            for peer in peers:
                if item.candidate_id < peer.candidate_id:
                    links.append(LinkageCandidate(item.candidate_id, peer.candidate_id, "exact", "identical ingredient strengths and dosage form", signature))
        else:
            links.append(LinkageCandidate(item.candidate_id, None, "unmatched", "no exact source-aware formulation peer", signature))
    return links


def _formulation_signature(identity: dict[str, Any]) -> str | None:
    ingredients = identity.get("ingredients")
    dosage_form = identity.get("dosage_form")
    if not ingredients or not dosage_form:
        return None
    for item in ingredients:
        if not item.get("name") or item.get("strength_value") is None or not item.get("strength_unit"):
            return None
    return sha256(_canonical_json(identity).encode("utf-8")).hexdigest()


def _entities_for(payload: dict[str, Any]) -> list[str]:
    normalized = payload.get("normalized_record")
    if isinstance(normalized, dict):
        source_fields: dict[str, Any] = {}
        raw_source_fields = payload.get("source_fields")
        if isinstance(raw_source_fields, dict):
            source_fields = raw_source_fields
        if source_fields.get("source_pmbi_product_kind") == "surgical_medical_consumable":
            entities = ["surgical_medical_consumable"]
            if normalized.get("prices"):
                entities.extend(["price_observation", "product_package"])
            return entities
        entities = ["formulation"]
        if normalized.get("ingredients"):
            entities.append("ingredient")
        if normalized.get("brand_name"):
            entities.append("brand_product")
        if normalized.get("prices"):
            entities.extend(["price_observation", "product_package"])
        return entities
    if payload.get("event_type"):
        return ["regulatory_event"]
    return ["unclassified"]


def _price_identity(
    price: dict[str, Any],
    record: PreparedSourceRecord,
    source_fields: dict[str, Any],
) -> dict[str, Any]:
    return {
        "price_basis": _required(price.get("price_basis"), "price_basis", Path(record.source_dataset)),
        "currency": _normalize(price.get("currency")),
        "value": _optional(price.get("price")),
        "quantity": _optional(price.get("quantity")),
        "effective_date": _optional(price.get("effective_date")),
        "publication_date": _optional(price.get("publication_date")),
        "previous_value": _optional(price.get("previous_value") or price.get("previous_price")),
        "notification_number": _optional(price.get("notification_number")),
        "notification_date": _optional(price.get("notification_date")),
        "package_description": _optional(price.get("package_description")),
        "price_unit": _optional(price.get("price_unit")),
        "package_quantity_unit": _optional(price.get("package_quantity_unit")),
        "source_dataset": record.source_dataset,
        "source_release": record.source_release,
        "source_record_id": _optional(price.get("source_record_id")),
        "pmbi_drug_code": _optional(source_fields.get("source_pmbi_drug_code")),
        "pmbi_product_kind": _optional(source_fields.get("source_pmbi_product_kind")),
        "special_feature_qualifier": _optional(
            price.get("special_feature_qualifier")
        ),
    }


def _source_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = payload.get("normalized_record")
    if isinstance(normalized, dict) and isinstance(normalized.get("sources"), list) and normalized["sources"]:
        return normalized["sources"][0]
    source = payload.get("source")
    return source if isinstance(source, dict) else {}


def _candidate(record: PreparedSourceRecord, entity_type: str, index: int, identity: dict[str, Any], evidence: dict[str, Any]) -> CatalogueCandidate:
    candidate_id = sha256(f"{record.stable_id}|{entity_type}|{index}|{_canonical_json(identity)}".encode("utf-8")).hexdigest()
    return CatalogueCandidate(candidate_id, record.stable_id, entity_type, identity, evidence)


def _stable_id(dataset: str, release: str | None, record_id: str) -> str:
    return sha256(_canonical_json({"dataset": dataset, "release": release, "record_id": record_id}).encode("utf-8")).hexdigest()


def _hash_json(value: Any) -> str:
    return sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _normalize(value: Any) -> str | None:
    text = _optional(value)
    return re.sub(r"[^a-z0-9%/]+", " ", text.casefold()).strip() if text else None


def _optional(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _required(value: Any, field_name: str, path: Path) -> str:
    text = _optional(value)
    if not text:
        raise ValueError(f"Missing {field_name} in normalized export {path}")
    return text
