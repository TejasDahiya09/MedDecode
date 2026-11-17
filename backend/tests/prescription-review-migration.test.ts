import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const directory = join(process.cwd(), "database", "integration-migrations", "202611150001_prescription_review_v1");
const sql = (name: string) => readFile(join(directory, name), "utf8");

test("review migration is additive, RLS-protected and grants no authenticated mutations", async () => {
  const up = await sql("002_up.sql");
  for (const table of ["prescription_ocr_evidence_sets", "prescription_review_revisions", "prescription_review_medicines", "prescription_review_events"]) {
    assert.match(up, new RegExp(`CREATE TABLE public\\.${table}`));
    assert.match(up, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(up, /FOREIGN KEY \(prescription_id, user_id\) REFERENCES public\.prescriptions\(id, user_id\)/);
  assert.match(up, /REVOKE ALL[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(up, /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[\s\S]+TO authenticated/i);
  assert.match(up, /GRANT SELECT \(id,prescription_id,user_id,schema_version,document_sha256,page_count,provider_count,created_at\)/);
  assert.doesNotMatch(up, /GRANT SELECT \([^)]*evidence_payload/);
});

test("review migration models concurrency, idempotency and stale-result binding", async () => {
  const up = await sql("002_up.sql");
  assert.match(up, /lock_version bigint NOT NULL DEFAULT 0/);
  assert.match(up, /UNIQUE \(prescription_id, revision_number\)/);
  assert.match(up, /UNIQUE \(prescription_id, confirmation_idempotency_key\)/);
  assert.match(up, /prescription_review_event_idempotency_idx/);
  assert.match(up, /review_revision_id uuid REFERENCES public\.prescription_review_revisions/);
  assert.match(up, /review_input_fingerprint text/);
  assert.match(up, /prescription_result_review_binding_complete/);
  assert.match(up, /processing_job_id uuid REFERENCES public\.ai_jobs/);
  assert.match(up, /meddecode_apply_prescription_review_draft_v1[\s\S]+FOR UPDATE/);
  assert.match(up, /meddecode_confirm_prescription_review_v1[\s\S]+review_stale/);
  assert.match(up, /meddecode_fence_review_result_v1[\s\S]+intelligence_state='completed'/);
  assert.match(up, /WHERE r\.processing_job_id=NEW\.job_id FOR UPDATE[\s\S]+NEW\.review_revision_id:=v_bound\.id/);
  assert.match(up, /CREATE TRIGGER prescription_result_review_fence/);
});

test("review RPCs are fixed-search-path security definers with scoped grants", async () => {
  const up = await sql("002_up.sql");
  for (const name of [
    "meddecode_apply_prescription_review_draft_v1",
    "meddecode_confirm_prescription_review_v1",
    "meddecode_reopen_prescription_review_v1",
    "meddecode_initialize_prescription_review_v1",
    "meddecode_bind_review_intelligence_job_v1",
    "meddecode_assert_current_review_result_v1",
  ]) {
    assert.match(up, new RegExp(`CREATE FUNCTION public\\.${name}[\\s\\S]+?SECURITY DEFINER SET search_path=pg_catalog,public`));
  }
  assert.match(up, /v_role IS DISTINCT FROM 'meddecode_scoped_worker'/);
  assert.match(up, /meddecode_scoped_worker_scope[\s\S]+worker_login=session_user[\s\S]+expires_at>clock_timestamp\(\)/);
  assert.doesNotMatch(up, /TO meddecode_worker/);
  assert.doesNotMatch(up, /EXECUTE\s+format|EXECUTE\s+p_/i);
});

test("preflight and independent verification fail closed", async () => {
  const preflight = await sql("001_preflight.sql");
  const verify = await sql("003_verify.sql");
  assert.match(preflight, /SET TRANSACTION READ ONLY/);
  assert.match(preflight, /prescription review objects already exist/);
  assert.match(preflight, /PRESCRIPTION_REVIEW_PREFLIGHT_OK/);
  assert.match(verify, /SET TRANSACTION READ ONLY/);
  assert.match(verify, /has_column_privilege\('authenticated'.*'evidence_payload'.*'SELECT'\)/s);
  assert.match(verify, /PRESCRIPTION_REVIEW_VERIFY_OK/);
  assert.match(verify, /unsafe worker RPC ACL/);
  assert.match(verify, /worker has direct review table access/);
});

test("rollback is explicit, reviewed and never invoked by application code", async () => {
  const rollback = await sql("004_rollback_review.sql");
  assert.match(rollback, /REVIEW ONLY/);
  assert.match(rollback, /DROP TABLE IF EXISTS public\.prescription_review_events/);
  assert.match(rollback, /DROP COLUMN IF EXISTS review_revision_id/);
  assert.match(rollback, /DROP TRIGGER IF EXISTS prescription_result_review_fence/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.meddecode_initialize_prescription_review_v1/);
});
