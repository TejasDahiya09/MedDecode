import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

import { createApp } from "../src/app.js";
import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import { createAuthenticateMiddleware, requireAuthenticatedIdentity } from "../src/middleware/authenticate.middleware.js";
import { PostgresPrescriptionReviewRepository } from "../src/repositories/postgres-prescription-review.repository.js";
import type { PrescriptionResultsRepository } from "../src/repositories/prescription-results.repository.js";
import { LocalConfirmedReviewIntelligenceClient } from "../src/services/confirmed-review-intelligence.client.js";
import { createLocalSyntheticAuth } from "../src/services/local-synthetic-auth.js";
import { createLocalSyntheticDocumentStore } from "../src/services/local-synthetic-document.store.js";
import { PrescriptionDocumentPreviewError, type PrescriptionDocumentPreviewService } from "../src/services/prescription-document-preview.service.js";
import { createInitialReviewFromIntelligence } from "../src/services/prescription-review-initializer.js";
import { validateIntelligenceResponseV1 } from "../src/services/intelligence-contract-v1.validator.js";

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const PRESCRIPTION = "f1000000-0000-4000-8000-000000000001";
const EVIDENCE = "f2000000-0000-4000-8000-000000000001";
const OCR_JOB = "f3000000-0000-4000-8000-000000000001";
const WORKER_INSTANCE = "phase1f-browser-worker";
const DATABASE = "meddecode_phase1f_20261115";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

class LocalRpcClient {
  constructor(private readonly pool: Pool, private readonly role: "authenticated" | "meddecode_scoped_worker", private readonly owner?: string) {}
  rpc = async (name: string, args: Record<string, unknown>) => {
    if (!/^meddecode_[a-z0-9_]+_v1$/.test(name)) return { data: null, error: { message: "rpc_rejected" } };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ WRITE");
      await client.query(`SET LOCAL ROLE ${this.role}`);
      if (this.owner) await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [this.owner]);
      const keys = Object.keys(args);
      const values = keys.map((key) => {
        const value = args[key];
        return typeof value === "object" && value !== null ? JSON.stringify(value) : value;
      });
      const result = await client.query(`SELECT public.${name}(${keys.map((_, index) => `$${index + 1}`).join(",")}) AS value`, values);
      await client.query("COMMIT");
      return { data: result.rows[0]?.value ?? null, error: null };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return { data: null, error: { message: error instanceof Error ? error.message : "rpc_failed" } };
    } finally { client.release(); }
  };
}

async function workerCall(client: PoolClient, sql: string, values: unknown[]): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE meddecode_scoped_worker");
    await client.query(sql, values);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "test") throw new Error("PHASE1F_TEST_ENVIRONMENT_GUARD_FAILED");
  if (required("PHASE1F_DATABASE") !== DATABASE || required("PGHOST") !== "127.0.0.1" || required("PGPORT") !== "55440") {
    throw new Error("PHASE1F_LOCAL_DATABASE_GUARD_FAILED");
  }
  if (process.env.MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED !== "false" || process.env.PROCESSING_WORKER_ENABLED !== "false") {
    throw new Error("PHASE1F_PRODUCTION_FEATURE_GUARD_FAILED");
  }
  const documentPath = resolve(required("PHASE1F_DOCUMENT"));
  const contractPath = resolve(required("PHASE1F_CONTRACT"));
  const storageRoot = resolve(required("PHASE1F_STORAGE_ROOT"));
  await mkdir(storageRoot, { recursive: true });
  const adminPool = new Pool({ host: "127.0.0.1", port: 55440, database: DATABASE, user: "phase1f_admin", max: 4 });
  const workerPool = new Pool({ host: "127.0.0.1", port: 55440, database: DATABASE, user: "meddecode_scoped_login", max: 1 });
  const localAuth = createLocalSyntheticAuth({ alice: required("PHASE1F_ALICE_SECRET"), bob: required("PHASE1F_BOB_SECRET") }, true);
  const tokenOwners = new Map<string, string>();
  const localStore = await createLocalSyntheticDocumentStore({ root: storageRoot, bucket: "meddecode-local-synthetic" });
  const documentBytes = await readFile(documentPath);
  const objectKey = `private/prescriptions/${PRESCRIPTION}/source.pdf`;
  await localStore.storage.delete(objectKey).catch(() => undefined);
  await localStore.storage.upload({ objectKey, bytes: documentBytes, fileType: "application/pdf" });

  const source = JSON.parse(await readFile(contractPath, "utf8")) as Record<string, unknown>;
  source.job_id = OCR_JOB; source.prescription_id = PRESCRIPTION;
  const ocr = validateIntelligenceResponseV1(source, { jobId: OCR_JOB, prescriptionId: PRESCRIPTION });
  if (ocr.status === "failed") throw new Error("PHASE1F_OCR_CONTRACT_FAILED");
  const initial = createInitialReviewFromIntelligence({
    result: ocr, evidenceSetId: EVIDENCE, evidenceSchemaVersion: "1.0",
    documentSha256: createHash("sha256").update(documentBytes).digest("hex"), now: new Date().toISOString(),
  });
  await cleanup(adminPool);
  await adminPool.query("INSERT INTO public.users(id) VALUES($1),($2) ON CONFLICT DO NOTHING", [OWNER, OTHER]);
  await adminPool.query("INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,status) VALUES($1,$2,'local','meddecode-local-synthetic',$3,'processing')", [PRESCRIPTION, OWNER, objectKey]);
  await adminPool.query("INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status) VALUES($1,$2,$3,'prescription_analysis','queued')", [OCR_JOB, OWNER, PRESCRIPTION]);
  await adminPool.query("INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at) VALUES($1,$2,$3,'meddecode_scoped_login',$4,true,clock_timestamp()+interval '1 hour')", [OCR_JOB, PRESCRIPTION, OWNER, WORKER_INSTANCE]);
  const worker = await workerPool.connect();
  try {
    await workerCall(worker, "SELECT public.meddecode_initialize_prescription_review_v1($1,$2,$3,$4,$5,$6)", [
      OCR_JOB, PRESCRIPTION,
      { evidenceSetId: EVIDENCE, schemaVersion: "1.0", documentSha256: initial.evidence.documentSha256, pageCount: 1, providerCount: 1, payload: {} },
      initial,
      JSON.stringify(initial.medicines.map((medicine) => ({ medicineId: medicine.medicineId, origin: medicine.origin, status: medicine.status, position: medicine.position, original: medicine.original, current: medicine.current, provenance: medicine.provenance, addedByCommandId: medicine.addedByCommandId, removedAt: medicine.removedAt }))),
      JSON.stringify({ eventId: randomUUID(), type: "draft_created", medicineId: null, changedFields: [], idempotencyKey: "phase1f-init", occurredAt: initial.createdAt }),
    ]);
  } finally { worker.release(); }

  const clients = (token: string) => {
    const owner = tokenOwners.get(token);
    if (!owner) throw new Error("Unknown local acceptance session.");
    return new LocalRpcClient(adminPool, "authenticated", owner) as unknown as UserSupabaseClient;
  };
  const results: PrescriptionResultsRepository = {
    async findOwnedPrescription(_client, userId, prescriptionId) {
      const result = await adminPool.query("SELECT id,user_id,status FROM public.prescriptions WHERE id=$1 AND user_id=$2", [prescriptionId, userId]);
      return result.rows[0] ?? null;
    },
    async findOwnedResult(_client, prescriptionId) {
      const result = await adminPool.query("SELECT prescription_id,job_id,schema_version,status,result_json,created_at,is_current FROM public.prescription_intelligence_results WHERE prescription_id=$1 AND is_current", [prescriptionId]);
      const row = result.rows[0];
      return row ? { ...row, created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at } : null;
    },
  };
  const preview: PrescriptionDocumentPreviewService = { async load(_client, ownerId, prescriptionId) {
    const owned = await adminPool.query("SELECT object_key FROM public.prescriptions WHERE id=$1 AND user_id=$2", [prescriptionId, ownerId]);
    if (!owned.rowCount) throw new PrescriptionDocumentPreviewError("NOT_FOUND", "metadata_lookup", "not_found");
    const response = await localStore.client.send({ input: { Bucket: "meddecode-local-synthetic", Key: owned.rows[0].object_key } } as never);
    const chunks: Buffer[] = []; for await (const chunk of response.Body) chunks.push(Buffer.from(chunk));
    return { bytes: Buffer.concat(chunks), contentType: "application/pdf" };
  } };
  const authenticate = createAuthenticateMiddleware(localAuth.verifier, clients);
  const python = new LocalConfirmedReviewIntelligenceClient({ pythonExecutable: required("MEDDECODE_PYTHON"), intelligenceDirectory: required("MEDDECODE_INTELLIGENCE_DIR"), timeoutMs: 30_000 });
  const app = createApp((router) => {
    router.post("/__acceptance/auth/sign-in", (request, response) => {
      const account = request.body?.account; const secret = request.body?.secret;
      const token = localAuth.signIn(account, secret);
      if (!token) return response.status(401).json({ error: { code: "UNAUTHORIZED" } });
      const owner = account === "alice" ? OWNER : OTHER; tokenOwners.set(token, owner);
      return response.status(200).json({ token, user: { id: owner, email: account === "alice" ? "alice@synthetic.invalid" : "bob@synthetic.invalid" } });
    });
    router.post("/__acceptance/prescriptions/:prescriptionId/finalize", authenticate, async (request, response) => {
      const identity = requireAuthenticatedIdentity(request);
      if (request.params.prescriptionId !== PRESCRIPTION || identity.userId !== OWNER) return response.status(404).json({ error: { code: "NOT_FOUND" } });
      const userRepo = new PostgresPrescriptionReviewRepository(new LocalRpcClient(adminPool, "authenticated", OWNER) as unknown as UserSupabaseClient);
      const review = await userRepo.getCurrentRevision(OWNER, PRESCRIPTION);
      if (!review || review.status !== "confirmed" || !review.canonicalInputFingerprint) return response.status(409).json({ error: { code: "REVIEW_NOT_CONFIRMED" } });
      const pending = await userRepo.getPendingIntelligenceRequest(OWNER, PRESCRIPTION);
      if (!pending) return response.status(409).json({ error: { code: "NO_PENDING_INTELLIGENCE" } });
      const jobId = randomUUID();
      await adminPool.query("INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status,lease_owner,lease_expires_at,heartbeat_at,started_at,claim_generation,attempt_count) VALUES($1,$2,$3,'prescription_analysis','processing',$4,clock_timestamp()+interval '10 minutes',clock_timestamp(),clock_timestamp(),1,1)", [jobId, OWNER, PRESCRIPTION, WORKER_INSTANCE]);
      await adminPool.query("INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at) VALUES($1,$2,$3,'meddecode_scoped_login',$4,true,clock_timestamp()+interval '1 hour')", [jobId, PRESCRIPTION, OWNER, WORKER_INSTANCE]);
      const workerRepo = new PostgresPrescriptionReviewRepository(new LocalRpcClient(workerPool, "meddecode_scoped_worker") as unknown as UserSupabaseClient);
      await workerRepo.bindProcessingJob(OWNER, pending.requestKey, jobId);
      const result = await python.analyzeConfirmed({ jobId, prescriptionId: PRESCRIPTION, review });
      const connection = await workerPool.connect();
      try { await workerCall(connection, "SELECT public.meddecode_finalize_review_result_v1($1,$2,$3,$4,$5,$6,$7)", [jobId, PRESCRIPTION, review.revisionId, review.canonicalInputFingerprint.value, WORKER_INSTANCE, 1, result]); }
      finally { connection.release(); }
      return response.status(200).json({ jobId, revisionId: review.revisionId, result });
    });
    router.get("/__acceptance/prescriptions/:prescriptionId/result-history", authenticate, async (request, response) => {
      const identity = requireAuthenticatedIdentity(request);
      if (request.params.prescriptionId !== PRESCRIPTION) return response.status(404).end();
      const result = await adminPool.query("SELECT r.job_id,r.review_revision_id,r.is_current,r.status,r.result_json FROM public.prescription_intelligence_results r JOIN public.prescriptions p ON p.id=r.prescription_id WHERE r.prescription_id=$1 AND p.user_id=$2 ORDER BY r.created_at", [PRESCRIPTION, identity.userId]);
      return response.status(200).json({ results: result.rows });
    });
    router.post("/__acceptance/cleanup", authenticate, async (request, response) => {
      const identity = requireAuthenticatedIdentity(request);
      if (identity.userId !== OWNER) return response.status(404).end();
      await cleanup(adminPool);
      await localStore.storage.delete(objectKey).catch(() => undefined);
      return response.status(200).json({ marker: "PHASE1F_FIXTURE_CLEANUP_OK" });
    });
  }, localAuth.verifier, clients, undefined, undefined, undefined, undefined, undefined, undefined, results, { enabled: true, repositoryFactory: (client) => new PostgresPrescriptionReviewRepository(client), documentPreviewService: preview });
  const server = app.listen(3011, "127.0.0.1", () => console.log(`PHASE1F_SERVER_READY:${PRESCRIPTION}`));
  const stop = async () => { server.close(); await adminPool.end(); await workerPool.end(); };
  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM public.prescription_intelligence_results WHERE prescription_id=$1", [PRESCRIPTION]);
  await pool.query("DELETE FROM public.prescription_medicine_alternatives WHERE prescription_medicine_id IN (SELECT id FROM public.prescription_medicines WHERE prescription_id=$1)", [PRESCRIPTION]);
  await pool.query("DELETE FROM public.prescription_recommendations WHERE prescription_id=$1", [PRESCRIPTION]);
  await pool.query("DELETE FROM public.prescription_warnings WHERE prescription_id=$1", [PRESCRIPTION]);
  await pool.query("DELETE FROM public.prescription_medicines WHERE prescription_id=$1", [PRESCRIPTION]);
  await pool.query("DELETE FROM public.meddecode_scoped_worker_scope WHERE prescription_id=$1", [PRESCRIPTION]);
  await pool.query("DELETE FROM public.prescription_review_events WHERE prescription_id=$1", [PRESCRIPTION]);
  await pool.query("DELETE FROM public.prescription_review_medicines WHERE prescription_id=$1", [PRESCRIPTION]);
  await pool.query("DELETE FROM public.prescription_review_revisions WHERE prescription_id=$1", [PRESCRIPTION]);
  await pool.query("DELETE FROM public.prescription_ocr_evidence_sets WHERE prescription_id=$1", [PRESCRIPTION]);
  await pool.query("DELETE FROM public.ai_jobs WHERE prescription_id=$1", [PRESCRIPTION]);
  await pool.query("DELETE FROM public.prescriptions WHERE id=$1", [PRESCRIPTION]);
}

void main().catch((error) => { console.error(`PHASE1F_SERVER_FAILED:${error instanceof Error ? error.stack ?? error.message : "unknown"}`); process.exitCode = 1; });
