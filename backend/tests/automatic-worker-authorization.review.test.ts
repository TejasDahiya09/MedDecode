import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const sql = readFileSync(resolve(process.cwd(), "database/automatic-worker-authorization-review.sql"), "utf8");

test("automatic issuer remains owner-admitted, disabled by default, and scoped", () => {
  assert.match(sql, /VALUES \(true,false,'meddecode_auto_worker_login'/);
  assert.match(sql, /v_user uuid := auth\.uid\(\)/);
  assert.match(sql, /IF v_job\.created THEN[\s\S]*INSERT INTO public\.meddecode_auto_authorized_jobs/);
  assert.match(sql, /existing job is not automatically authorized/);
  assert.match(sql, /session_user IS DISTINCT FROM v_policy\.worker_login::text/);
  assert.match(sql, /p_worker_instance_id IS DISTINCT FROM v_policy\.worker_instance_id/);
  assert.match(sql, /a\.admitted_at>=v_policy\.activated_at/);
  assert.match(sql, /meddecode_scoped_worker_scope s WHERE s\.job_id=v_job\.id FOR UPDATE;[\s\S]*FOR UPDATE OF j;/);
  assert.doesNotMatch(sql, /SKIP LOCKED/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.meddecode_scoped_authorize_next_automatic_job_v1\(text\) TO meddecode_scoped_worker/);
});
