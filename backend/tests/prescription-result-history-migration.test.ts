import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const backendRoot = path.basename(process.cwd()).toLowerCase() === "backend"
  ? process.cwd()
  : path.resolve(process.cwd(), "backend");
const root = path.join(backendRoot, "database/integration-migrations/202611150002_prescription_result_history_v1");
const sql = (name: string) => readFile(path.join(root, name), "utf8");

describe("Prescription result history migration", () => {
  it("replaces prescription uniqueness with job idempotency and one-current selection", async () => {
    const up = await sql("002_up.sql");
    assert.match(up, /DROP CONSTRAINT/);
    assert.match(up, /UNIQUE INDEX prescription_intelligence_results_job_uq/);
    assert.match(up, /UNIQUE INDEX prescription_intelligence_results_one_current_uq[\s\S]*WHERE is_current/);
    assert.match(up, /UPDATE public\.prescription_intelligence_results SET is_current=false/);
  });

  it("fences finalization by owner, revision, fingerprint, job, worker and lease", async () => {
    const up = await sql("002_up.sql");
    for (const evidence of ["v_prescription.user_id<>v_job.user_id", "NOT v_revision.is_current",
      "v_revision.input_fingerprint<>p_input_fingerprint", "v_revision.processing_job_id<>p_job_id",
      "s.worker_login=session_user", "s.worker_instance_id=p_worker_instance_id",
      "v_job.claim_generation<>p_claim_generation", "v_job.lease_expires_at<=v_now"]) {
      assert.ok(up.includes(evidence), evidence);
    }
  });

  it("keeps readers owner scoped and rollback fail-closed after history exists", async () => {
    const up = await sql("002_up.sql");
    const rollback = await sql("004_rollback_review.sql");
    assert.match(up, /p\.user_id=auth\.uid\(\)/g);
    assert.match(up, /REVOKE ALL[\s\S]*FROM PUBLIC,anon/);
    assert.match(rollback, /rollback refused: historical results exist/);
  });
});
