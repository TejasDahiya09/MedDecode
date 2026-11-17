from __future__ import annotations
import json
from pathlib import Path
from app.layer4_medicine_intelligence.dataset_ingestion.catalogue_import_preparation import prepare_catalogue_import
from app.layer4_medicine_intelligence.dataset_ingestion.local_catalogue_importer import import_prepared_catalogue, stable_uuid
class FakeCursor:
    def __init__(self): self.calls=[]; self.rowcount=1
    def execute(self, statement, parameters=()): self.calls.append((statement,parameters)); self.rowcount=1
class FakeConnection:
    def __init__(self): self.c=FakeCursor(); self.commits=0; self.rollbacks=0
    def cursor(self): return self.c
    def commit(self): self.commits+=1
    def rollback(self): self.rollbacks+=1

class FailingCursor(FakeCursor):
    def execute(self, statement, parameters=()):
        super().execute(statement, parameters)
        if 'official_catalogue.formulations' in statement:
            raise RuntimeError('simulated local database failure')

class FailingConnection(FakeConnection):
    def __init__(self): self.c=FailingCursor(); self.commits=0; self.rollbacks=0

class ReplayCursor(FakeCursor):
    def execute(self, statement, parameters=()):
        super().execute(statement, parameters)
        if statement.startswith('INSERT INTO official_catalogue.source_records') or 'catalogue_entities' in statement or 'official_catalogue.ingredients' in statement or 'official_catalogue.formulations' in statement:
            self.rowcount=0

class ReplayConnection(FakeConnection):
    def __init__(self): self.c=ReplayCursor(); self.commits=0; self.rollbacks=0
def _report(tmp_path: Path):
    payload={"release":"r1","accepted":[{"normalized_record":{"canonical_name":"Example 10 mg tablet","dosage_form":"tablet","ingredients":[{"ingredient":{"ingredient_name":"example","normalized_name":"example"},"ingredient_strength_value":"10","ingredient_strength_unit":"mg"}],"sources":[{"source_dataset":"official_example","source_record_id":"1","source_record_hash":"h1","source_release":"r1"}]}}]}
    path=tmp_path/'source.json'; path.write_text(json.dumps(payload),encoding='utf-8'); return prepare_catalogue_import([path])
def test_dry_run_never_executes_sql(tmp_path):
    db=FakeConnection(); result=import_prepared_catalogue(db,_report(tmp_path),dry_run=True)
    assert result.dry_run and not db.c.calls and db.rollbacks==1
def test_explicit_import_is_transactional_and_replay_safe(tmp_path):
    db=FakeConnection(); result=import_prepared_catalogue(db,_report(tmp_path),dry_run=False)
    sql='\n'.join(c[0] for c in db.c.calls)
    assert result.source_records==1 and db.commits==1 and 'BEGIN' in sql and 'source_records' in sql and 'DO NOTHING' in sql
    assert 'ingredients' in sql and 'formulations' in sql and 'formulation_ingredients' in sql
    assert 'import_batches' in sql and "status='completed'" in sql

def test_projects_package_and_distinct_price_basis(tmp_path):
    report = _report(tmp_path)
    record = report.source_records[0].original_payload
    record['normalized_record']['prices'] = [{"price":"12.50","currency":"INR","price_basis":"special feature ceiling price","package_description":"10 tablets","price_unit":"pack"}]
    # Re-prepare so candidates reflect the evidence modification.
    path=tmp_path/'priced.json'; path.write_text(json.dumps({"release":"r1","accepted":[record]}),encoding='utf-8')
    db=FakeConnection(); import_prepared_catalogue(db,prepare_catalogue_import([path]),dry_run=False)
    sql='\n'.join(c[0] for c in db.c.calls)
    values=[params for _,params in db.c.calls if params]
    assert 'product_packages' in sql and 'price_observations' in sql
    assert any('special_feature_ceiling_price' in params for params in values)

def test_uncertain_link_is_not_persisted(tmp_path):
    report=_report(tmp_path)
    report.linkages = [type('Link', (), {'left_candidate_id':report.candidates[0].candidate_id,'right_candidate_id':None,'status':'uncertain','reason':'incomplete','identity_signature':None})()]
    db=FakeConnection(); import_prepared_catalogue(db,report,dry_run=False)
    assert 'link_candidates' not in '\n'.join(c[0] for c in db.c.calls)

def test_unmatched_link_uses_null_safe_additive_index_contract(tmp_path):
    report=_report(tmp_path)
    formulation=next(item for item in report.candidates if item.entity_type=='formulation')
    report.linkages=[type('Link',(),{'left_candidate_id':formulation.candidate_id,'right_candidate_id':None,'status':'unmatched','reason':'no exact peer','identity_signature':'sig'})()]
    db=FakeConnection(); import_prepared_catalogue(db,report,dry_run=False)
    statement=next(sql for sql,_ in db.c.calls if 'link_candidates' in sql)
    assert 'ON CONFLICT DO NOTHING' in statement

def test_failure_rolls_back_evidence_before_recording_failed_batch(tmp_path):
    db=FailingConnection()
    try:
        import_prepared_catalogue(db,_report(tmp_path),dry_run=False)
    except RuntimeError:
        pass
    else:
        raise AssertionError('expected simulated database failure')
    assert db.rollbacks >= 1
    assert any('import_batches' in sql and "'failed'" in sql for sql,_ in db.c.calls)

def test_per_release_batch_reports_and_replay_counts(tmp_path):
    a=_report(tmp_path).source_records[0].original_payload
    b=json.loads(json.dumps(a)); b['normalized_record']['sources'][0]['source_dataset']='official_second'; b['normalized_record']['sources'][0]['source_record_id']='2'; b['normalized_record']['sources'][0]['source_record_hash']='h2'
    path=tmp_path/'two.json'; path.write_text(json.dumps({'release':'r1','accepted':[a,b]}),encoding='utf-8')
    db=ReplayConnection(); import_prepared_catalogue(db,prepare_catalogue_import([path]),dry_run=False)
    reports=[json.loads(params[0]) for sql,params in db.c.calls if "status='completed'" in sql]
    assert len(reports)==2
    assert all(item['input_records']==1 and item['existing_source_records']==1 and item['new_source_records']==0 for item in reports)
    assert all(item['committed'] is True for item in reports)

def test_batch_uses_clock_timestamp_for_distinct_completion_time(tmp_path):
    db=FakeConnection(); import_prepared_catalogue(db,_report(tmp_path),dry_run=False)
    sql='\n'.join(item[0] for item in db.c.calls)
    assert 'started_at,report' in sql and 'clock_timestamp()' in sql
def test_stable_uuid_preserves_versions():
    assert stable_uuid('record','h1')==stable_uuid('record','h1')
    assert stable_uuid('record','h1')!=stable_uuid('record','h2')
