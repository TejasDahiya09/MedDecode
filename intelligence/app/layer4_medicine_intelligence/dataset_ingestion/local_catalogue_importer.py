"""Explicit local PostgreSQL import plan for prepared official source records.

This module never opens a connection; callers must explicitly supply one only
after local-target identity checks. Source versions are append-only.
"""
from __future__ import annotations
import argparse
from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Any, Protocol
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5
from .catalogue_import_preparation import CataloguePreparationReport, prepare_catalogue_import

class Cursor(Protocol):
    rowcount: int
    def execute(self, statement: str, parameters: tuple[Any, ...] = ()) -> Any: ...
class Connection(Protocol):
    def cursor(self) -> Cursor: ...
    def commit(self) -> None: ...
    def rollback(self) -> None: ...
@dataclass(frozen=True)
class ImportResult:
    source_records: int; candidates: int; linkages: int; dry_run: bool; batches: int = 0
def stable_uuid(*parts: str) -> UUID:
    return uuid5(NAMESPACE_URL, "meddecode:official-catalogue:" + ":".join(parts))
def import_prepared_catalogue(connection: Connection, report: CataloguePreparationReport, *, dry_run: bool = True) -> ImportResult:
    cursor = connection.cursor()
    batches: dict[UUID, UUID] = {}
    stats: dict[UUID, dict[str, int]] = {}
    try:
        if not dry_run: cursor.execute("BEGIN")
        for record in report.source_records:
            release_id = stable_uuid(record.source_dataset, record.source_release or "unknown", "release")
            record_id = stable_uuid(record.stable_id, record.content_hash)
            dataset_hash = sha256(f"{record.source_dataset}:{record.source_release or ''}".encode()).hexdigest()
            _execute(cursor, "INSERT INTO official_catalogue.sources (source_key, authority) VALUES (%s, %s) ON CONFLICT (source_key) DO NOTHING", (record.source_dataset, "official-source-as-recorded"), dry_run)
            _execute(cursor, "INSERT INTO official_catalogue.releases (release_id, source_key, release_label, dataset_hash) VALUES (%s,%s,%s,%s) ON CONFLICT (source_key,release_label,dataset_hash) DO NOTHING", (release_id, record.source_dataset, record.source_release or "unknown", dataset_hash), dry_run)
            if release_id not in batches:
                batch_id = uuid4()
                batches[release_id] = batch_id
                stats[release_id] = {'input_records': 0, 'new_source_records': 0, 'existing_source_records': 0, 'new_typed_projections': 0, 'existing_typed_projections': 0, 'conflicts': 0, 'rejected': 0, 'link_candidates_processed': 0, 'new_link_candidates': 0, 'existing_link_candidates': 0}
                _execute(cursor, "INSERT INTO official_catalogue.import_batches (batch_id,release_id,parser_version,status,started_at,report) VALUES (%s,%s,%s,'started',clock_timestamp(),%s::jsonb)", (batch_id, release_id, report.parser_version, json.dumps(stats[release_id])), dry_run)
            stats[release_id]['input_records'] += 1
            inserted = _execute(cursor, "INSERT INTO official_catalogue.source_records (source_record_id,release_id,external_record_id,content_hash,parser_version,record_kind,original_payload) VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb) ON CONFLICT (release_id,external_record_id,content_hash) DO NOTHING", (record_id, release_id, record.source_record_id, record.content_hash, record.parser_version, ",".join(record.entities) or "source_record", json.dumps(record.original_payload, sort_keys=True)), dry_run)
            stats[release_id]['new_source_records' if inserted else 'existing_source_records'] += 1
        candidate_ids: dict[str, UUID] = {}
        ingredient_ids_by_source: dict[str, list[tuple[dict[str, Any], UUID, dict[str, Any]]]] = {}
        for candidate in report.candidates:
            # candidate IDs are stable across replay; identity hashes prevent a
            # second import from duplicating evidence while retaining conflicts.
            source_id = next(item for item in report.source_records if item.stable_id == candidate.source_record_stable_id)
            source_db_id = stable_uuid(source_id.stable_id, source_id.content_hash)
            identity_hash = sha256(json.dumps(candidate.identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            _execute(cursor, "INSERT INTO official_catalogue.catalogue_entities (entity_id,source_record_id,entity_type,identity,evidence,identity_hash) VALUES (%s,%s,%s,%s::jsonb,%s::jsonb,%s) ON CONFLICT (source_record_id,entity_type,identity_hash) DO NOTHING", (stable_uuid(candidate.candidate_id), source_db_id, candidate.entity_type, json.dumps(candidate.identity, sort_keys=True), json.dumps(candidate.evidence, sort_keys=True), identity_hash), dry_run)
            candidate_ids[candidate.candidate_id] = stable_uuid(candidate.candidate_id)
            if candidate.entity_type == 'ingredient':
                ingredient_ids_by_source.setdefault(candidate.source_record_stable_id, []).append((candidate.identity, candidate_ids[candidate.candidate_id], candidate.evidence))
            attempted, inserted = _write_typed(cursor, candidate, source_db_id, ingredient_ids_by_source, dry_run)
            release_id = stable_uuid(source_id.source_dataset, source_id.source_release or "unknown", "release")
            stats[release_id]['new_typed_projections'] += inserted
            stats[release_id]['existing_typed_projections'] += attempted - inserted
        for linkage in report.linkages:
            if linkage.status == "uncertain":
                continue  # uncertain links stay only in the evidence/report layer
            left = next((item for item in report.candidates if item.candidate_id == linkage.left_candidate_id), None)
            right = next((item for item in report.candidates if item.candidate_id == linkage.right_candidate_id), None)
            if left is None:
                continue
            left_record = next(item for item in report.source_records if item.stable_id == left.source_record_stable_id)
            right_record = next((item for item in report.source_records if right and item.stable_id == right.source_record_stable_id), None)
            # The additive expression index treats NULL right-side links as a
            # deterministic sentinel. Generic conflict handling is safe here:
            # this table contains immutable evidence rows only.
            release_id = stable_uuid(left_record.source_dataset, left_record.source_release or "unknown", "release")
            stats[release_id]['link_candidates_processed'] += 1
            inserted = _execute(cursor, "INSERT INTO official_catalogue.link_candidates (linkage_id,left_source_record_id,right_source_record_id,match_status,reason,identity_signature) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", (stable_uuid('link', linkage.left_candidate_id, linkage.right_candidate_id or 'none', linkage.status), stable_uuid(left_record.stable_id, left_record.content_hash), stable_uuid(right_record.stable_id, right_record.content_hash) if right_record else None, linkage.status, linkage.reason, linkage.identity_signature), dry_run)
            stats[release_id]['new_link_candidates' if inserted else 'existing_link_candidates'] += 1
        conflicts_by_release: dict[UUID, int] = {}
        for conflict in report.conflicting_replays:
            source = next((item for item in report.source_records if item.stable_id == conflict.get('stable_id')), None)
            if source:
                key = stable_uuid(source.source_dataset, source.source_release or "unknown", "release")
                conflicts_by_release[key] = conflicts_by_release.get(key, 0) + 1
        for release_id, batch_id in batches.items():
            release_stats = {**stats[release_id], 'conflicts': conflicts_by_release.get(release_id, 0), 'rejected': 0, 'committed': True}
            _execute(cursor, "UPDATE official_catalogue.import_batches SET status='completed',completed_at=clock_timestamp(),report=%s::jsonb WHERE batch_id=%s", (json.dumps(release_stats), batch_id), dry_run)
        if dry_run: connection.rollback()
        else: connection.commit()
    except Exception:
        connection.rollback()
        # Preserve failed-run telemetry without retaining partial evidence.
        if not dry_run and batches:
            try:
                cursor.execute("BEGIN")
                for release_id, batch_id in batches.items():
                    cursor.execute("INSERT INTO official_catalogue.import_batches (batch_id,release_id,parser_version,status,completed_at,report) VALUES (%s,%s,%s,'failed',now(),%s::jsonb)", (batch_id, release_id, report.parser_version, json.dumps({'failure': 'transaction rolled back; inspect local importer error log'})))
                connection.commit()
            except Exception:
                connection.rollback()
        raise
    return ImportResult(len(report.source_records), len(report.candidates), len(report.linkages), dry_run, len(batches))
def _execute(cursor: Cursor, statement: str, parameters: tuple[Any, ...], dry_run: bool) -> int:
    if dry_run: return 0
    cursor.execute(statement, parameters)
    return max(cursor.rowcount, 0)


def _write_typed(cursor: Cursor, candidate, source_id: UUID, ingredient_ids_by_source: dict[str, list[tuple[dict[str, Any], UUID, dict[str, Any]]]], dry_run: bool) -> tuple[int, int]:
    """Project validated evidence into dedicated tables; generic evidence stays intact."""
    kind, identity, evidence, entity_id = candidate.entity_type, candidate.identity, candidate.evidence, stable_uuid(candidate.candidate_id)
    encode = lambda value: json.dumps(value, sort_keys=True, default=str)
    attempted = inserted = 0
    def write(statement: str, parameters: tuple[Any, ...]) -> None:
        nonlocal attempted, inserted
        attempted += 1
        inserted += _execute(cursor, statement, parameters, dry_run)
    if kind == 'ingredient':
        ingredient = evidence.get('ingredient', evidence) if isinstance(evidence, dict) else {}
        display = ingredient.get('ingredient_name') if isinstance(ingredient, dict) else identity.get('name')
        write("INSERT INTO official_catalogue.ingredients (ingredient_id,source_record_id,normalized_name,display_name,evidence) VALUES (%s,%s,%s,%s,%s::jsonb) ON CONFLICT (source_record_id,normalized_name) DO NOTHING", (entity_id,source_id,identity['name'],display or identity['name'],encode(evidence)))
    elif kind == 'formulation':
        write("INSERT INTO official_catalogue.formulations (formulation_id,source_record_id,canonical_name,dosage_form,release_type,identity,evidence) VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb) ON CONFLICT (source_record_id,identity) DO NOTHING", (entity_id,source_id,evidence.get('canonical_name'),identity.get('dosage_form'),identity.get('release_type'),encode(identity),encode(evidence)))
        for ingredient_identity, ingredient_id, ingredient_evidence in ingredient_ids_by_source.get(candidate.source_record_stable_id, []):
            write("INSERT INTO official_catalogue.formulation_ingredients (formulation_id,ingredient_id,strength_value,strength_unit,evidence) VALUES (%s,%s,%s,%s,%s::jsonb) ON CONFLICT (formulation_id,ingredient_id) DO NOTHING", (entity_id,ingredient_id,ingredient_identity.get('strength_value'),ingredient_identity.get('strength_unit'),encode(ingredient_evidence)))
    elif kind in {'brand_product','surgical_medical_consumable'}:
        product_kind = 'surgical_medical_consumable' if kind == 'surgical_medical_consumable' else 'medicine'
        write("INSERT INTO official_catalogue.products (product_id,source_record_id,product_name,manufacturer_name,product_kind,evidence) VALUES (%s,%s,%s,%s,%s,%s::jsonb) ON CONFLICT DO NOTHING", (entity_id,source_id,identity.get('brand_name') or identity.get('name') or evidence.get('canonical_name'),identity.get('manufacturer'),product_kind,encode(evidence)))
    elif kind == 'product_package':
        write("INSERT INTO official_catalogue.product_packages (package_id,source_record_id,package_description,package_unit,evidence) VALUES (%s,%s,%s,%s,%s::jsonb) ON CONFLICT DO NOTHING", (entity_id,source_id,identity.get('description'),identity.get('unit'),encode(evidence)))
    elif kind == 'price_observation':
        basis = _price_basis(identity.get('price_basis'), evidence)
        value = evidence.get('price') or identity.get('value')
        write("INSERT INTO official_catalogue.price_observations (price_id,source_record_id,price,currency,price_basis,evidence) VALUES (%s,%s,%s,%s,%s,%s::jsonb) ON CONFLICT DO NOTHING", (entity_id,source_id,value,identity.get('currency') or evidence.get('currency') or 'INR',basis,encode(evidence)))
    elif kind == 'regulatory_event':
        write("INSERT INTO official_catalogue.regulatory_events (event_id,source_record_id,event_type,event_date,qualification,establishes_current_status,evidence) VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb) ON CONFLICT DO NOTHING", (entity_id,source_id,identity.get('event_type') or evidence.get('event_type') or 'official_notice',identity.get('event_date'),identity.get('category') or evidence.get('regulatory_category') or evidence.get('permission_category'),False,encode(evidence)))
    return attempted, inserted


def _price_basis(value: Any, evidence: dict[str, Any]) -> str:
    raw = str(value or '').casefold().replace('-', '_').replace(' ', '_')
    if 'special' in raw or evidence.get('special_feature') or evidence.get('special_feature_qualifier'): return 'special_feature_ceiling_price'
    if 'revised' in raw and 'mrp' in raw: return 'revised_mrp'
    if 'pmbi' in raw: return 'pmbi_listed_mrp'
    if 'ceiling' in raw: return 'ceiling_price_excluding_taxes'
    return 'unknown'


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Guarded local official catalogue importer')
    parser.add_argument('--manifest', nargs='+', required=True); parser.add_argument('--limit', type=int)
    parser.add_argument('--apply-local', action='store_true'); parser.add_argument('--host', default='127.0.0.1'); parser.add_argument('--port', type=int, default=5433); parser.add_argument('--database', default='meddecode_job_test'); parser.add_argument('--user', default='postgres')
    args = parser.parse_args(argv)
    report = prepare_catalogue_import(args.manifest, max_records_per_export=args.limit)
    if not args.apply_local:
        print(json.dumps({'dry_run':True,'source_records':len(report.source_records),'candidates':len(report.candidates),'linkages':len(report.linkages)})); return 0
    if (args.host,args.port,args.database) != ('127.0.0.1',5433,'meddecode_job_test'):
        raise SystemExit('--apply-local only permits 127.0.0.1:5433/meddecode_job_test')
    try: import psycopg
    except ImportError as error: raise SystemExit('Local apply needs psycopg installed separately.') from error
    with psycopg.connect(host=args.host,port=args.port,dbname=args.database,user=args.user) as connection:
        print(json.dumps(import_prepared_catalogue(connection,report,dry_run=False).__dict__))
    return 0

if __name__ == '__main__': raise SystemExit(main())
