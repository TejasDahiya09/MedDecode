import "dotenv/config";
import { readFileSync, statSync } from "node:fs";
import { S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { PostgresWorkerRpcCaller, type WorkerPgPool, type ExactJobRetry } from "./repositories/postgres-worker-rpc.transport.js";
import { createDisabledProcessingWorkerComposition } from "./services/processing-worker.composition.js";
import { parseWorkerRuntimeConfig } from "./services/processing-worker.runtime.js";
import { HttpPythonIntelligenceClient } from "./services/http-python-intelligence.client.js";
import { RpcPrescriptionReviewWorkerStore } from "./repositories/prescription-review-worker.rpc-store.js";
import { LocalConfirmedReviewIntelligenceClient } from "./services/confirmed-review-intelligence.client.js";
import { CATALOGUE_ENV_KEYS, type CatalogueEnvironment } from "./services/local-python-intelligence.client.js";

export interface WorkerStartupConfig {
  readonly rpcMode: "standard" | "scoped";
  readonly singleAttempt: boolean;
  readonly automaticAuthorization: boolean;
  readonly databaseUrl: string;
  readonly databaseCaPath: string;
  readonly region: string;
  readonly bucket: string;
  readonly intelligenceUrl: string;
  readonly intelligenceToken: string;
  readonly reviewV3: boolean;
  readonly pythonExecutable?: string;
  readonly intelligenceDirectory?: string;
  readonly catalogueEnvironment?: CatalogueEnvironment;
  readonly exactRetry?: ExactJobRetry;
}

export function assertWorkerDatabaseIdentity(row: Record<string, unknown> | undefined, mode: "standard" | "scoped" = "standard", automatic = false, controlled = false, reviewV3 = false): void {
  const required = ["claim_rpc", "heartbeat_rpc", "complete_rpc", "fail_rpc", "recover_rpc",
    "login_restricted", "login_no_table_access", "role_no_table_access"];
  if (!row || row.role !== (mode === "scoped" ? "meddecode_scoped_worker" : "meddecode_worker") || required.some(key => row[key] !== true) ||
      (automatic && (row.automatic_login !== true || row.issuer_rpc !== true)) ||
      (reviewV3 && row.review_v3_rpcs !== true) ||
      (controlled && row.no_competing_worker_sessions !== true)) {
    throw new Error("Worker database identity or RPC prerequisites are unavailable.");
  }
}

/** Runs at most one recovery operation at a time and waits for it on shutdown. */
export function scheduleWorkerRecovery(recover: () => Promise<unknown>, intervalMs: number): { tick(): Promise<void>; stop(): Promise<void> } {
  let stopped = false;
  let pending: Promise<void> | undefined;
  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    pending = (async () => {
      try { await recover(); }
      catch { console.warn(JSON.stringify({ level: "warn", event: "worker_recovery_failed" })); }
    })().finally(() => { pending = undefined; });
    return pending;
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  return { tick, async stop() { stopped = true; clearInterval(timer); await pending; } };
}

/** In controlled mode, never restart after the first claimed job returns. */
export async function runWorkerLoop(runtime: { start(): Promise<void> }, isStopping: () => boolean, singleAttempt: boolean): Promise<void> {
  while (!isStopping()) {
    await runtime.start();
    if (singleAttempt) break;
  }
}

/** Never recover an expired claim in the controlled one-attempt demonstration. */
export function automaticClaimGate(issue: () => Promise<boolean>, recover: () => Promise<unknown>, singleAttempt: boolean): () => Promise<boolean> {
  return async () => {
    if (!await issue()) return false;
    if (!singleAttempt) await recover();
    return true;
  };
}

/** Pure configuration validation: constructing or importing this file never connects. */
export function workerStartupConfig(source: Readonly<Record<string, string | undefined>>): WorkerStartupConfig {
  if (source.PROCESSING_WORKER_ENABLED !== "true") throw new Error("Worker is disabled.");
  // An enabled worker must explicitly select its privilege boundary. In
  // particular, a missing setting must never silently select the shared queue.
  const rpcMode = source.WORKER_RPC_MODE;
  if (rpcMode !== "standard" && rpcMode !== "scoped") throw new Error("Invalid worker RPC mode.");
  const oneShot = source.WORKER_SINGLE_ATTEMPT ?? "false";
  if (oneShot !== "true" && oneShot !== "false") throw new Error("Invalid worker single-attempt configuration.");
  if (oneShot === "true" && rpcMode !== "scoped") throw new Error("Single-attempt workers require scoped RPCs.");
  const auto = source.WORKER_AUTOMATIC_AUTHORIZATION_ENABLED ?? "false";
  if (auto !== "true" && auto !== "false") throw new Error("Invalid automatic authorization configuration.");
  if (auto === "true" && rpcMode !== "scoped") throw new Error("Automatic authorization requires scoped mode.");
  if ((source.NODE_ENV ?? "development") !== "production" && rpcMode !== "scoped") {
    throw new Error("Development workers require database-enforced scoped RPCs.");
  }
  parseWorkerRuntimeConfig(source);
  const required = (key: string): string => {
    const value = source[key]?.trim();
    if (!value) throw new Error(`Missing worker configuration: ${key}`);
    return value;
  };
  const databaseUrl = required("WORKER_DATABASE_URL");
  const intelligenceUrl = required("PYTHON_INTELLIGENCE_URL");
  const intelligenceToken = required("MEDDECODE_INTERNAL_TOKEN");
  // Validate the service boundary at startup, not after a job has been claimed.
  new HttpPythonIntelligenceClient("", intelligenceUrl, intelligenceToken);
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error("Invalid worker database URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username ||
      ["postgres", "service_role", "authenticated", "anon", "meddecode_worker"].includes(decodeURIComponent(url.username).toLowerCase()) ||
      url.search || url.hash) throw new Error("Invalid restricted worker database configuration.");
  if (auto === "true" && (decodeURIComponent(url.username) !== "meddecode_auto_worker_login" ||
      url.hostname !== "db.wyripeqruhvbksjfsvlr.supabase.co" || url.port !== "5432" || url.pathname !== "/postgres")) {
    throw new Error("Automatic worker requires the dedicated direct database connection.");
  }
  const reviewV3 = source.MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED === "true";
  const retryKeys = ['WORKER_EXACT_RETRY_PERMIT_ID','WORKER_EXACT_RETRY_JOB_ID','WORKER_EXACT_RETRY_PRESCRIPTION_ID','WORKER_EXACT_RETRY_EXPECTED_GENERATION'];
  let exactRetry: ExactJobRetry | undefined;
  if (retryKeys.some(key => source[key] !== undefined)) {
    if (!reviewV3 || oneShot !== 'true' || auto !== 'true' || rpcMode !== 'scoped' || source.PROCESSING_WORKER_INSTANCE_ID !== 'meddecode-auto-worker-001' ||
        !retryKeys.slice(0,3).every(key => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source[key] ?? '')) ||
        !/^[1-9]\d*$/.test(source.WORKER_EXACT_RETRY_EXPECTED_GENERATION ?? '') || !Number.isSafeInteger(Number(source.WORKER_EXACT_RETRY_EXPECTED_GENERATION)) ||
        Number(source.WORKER_EXACT_RETRY_EXPECTED_GENERATION)>Number.MAX_SAFE_INTEGER-2) throw new Error('Invalid exact retry configuration.');
    exactRetry = { permitId: source.WORKER_EXACT_RETRY_PERMIT_ID!, jobId: source.WORKER_EXACT_RETRY_JOB_ID!,
      prescriptionId: source.WORKER_EXACT_RETRY_PRESCRIPTION_ID!, expectedClaimGeneration: Number(source.WORKER_EXACT_RETRY_EXPECTED_GENERATION) };
  }
  const catalogueEnvironment = Object.fromEntries(CATALOGUE_ENV_KEYS.flatMap(key => source[key] === undefined ? [] : [[key, source[key]!]])) as CatalogueEnvironment;
  if (reviewV3 && catalogueEnvironment.MEDDECODE_CATALOGUE_ENV === "hosted" &&
      (!catalogueEnvironment.MEDDECODE_CATALOGUE_HOST || !catalogueEnvironment.MEDDECODE_CATALOGUE_DATABASE ||
       !catalogueEnvironment.MEDDECODE_CATALOGUE_USER || !catalogueEnvironment.MEDDECODE_CATALOGUE_SSLROOTCERT ||
       (!catalogueEnvironment.MEDDECODE_CATALOGUE_PASSWORD && !catalogueEnvironment.MEDDECODE_CATALOGUE_PASSFILE))) {
    throw new Error("Restricted catalogue configuration is incomplete.");
  }
  return {
    rpcMode, singleAttempt: oneShot === "true", automaticAuthorization: auto === "true",
    databaseUrl, databaseCaPath: required("WORKER_DATABASE_CA_FILE"), region: required("AWS_REGION"),
    bucket: required("AWS_S3_BUCKET"), intelligenceUrl, intelligenceToken,
    reviewV3,
    ...(exactRetry ? { exactRetry } : {}),
    ...(Object.keys(catalogueEnvironment).length === 0 ? {} : { catalogueEnvironment }),
    ...(reviewV3 ? { pythonExecutable: required("WORKER_PYTHON_EXECUTABLE"), intelligenceDirectory: required("WORKER_INTELLIGENCE_DIRECTORY") } : {}),
  };
}

export async function runWorker(source: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  const settings = workerStartupConfig(source);
  try { if (!statSync(settings.databaseCaPath).isFile()) throw new Error(); }
  catch { throw new Error("Required worker certificate is unavailable."); }
  const ca = readFileSync(settings.databaseCaPath, "utf8");
  if (!ca.includes("-----BEGIN CERTIFICATE-----")) throw new Error("Worker database CA certificate is invalid.");
  const pool = new Pool({ connectionString: settings.databaseUrl, max: 2, connectionTimeoutMillis: 10_000, statement_timeout: 10_000,
    ssl: { ca, rejectUnauthorized: true } });
  const s3 = new S3Client({ region: settings.region });
  const controlled = settings.automaticAuthorization && settings.singleAttempt;
  const rpcCaller = new PostgresWorkerRpcCaller(pool as unknown as WorkerPgPool, settings.rpcMode, controlled, settings.exactRetry);
  const runtimeConfig = parseWorkerRuntimeConfig(source);
  const issueScope = async (): Promise<boolean> => {
    const issuer = settings.reviewV3 ? "meddecode_scoped_authorize_next_v3_job_v1" : "authorize_next_automatic_job_v1";
    const result = await rpcCaller.rpc(issuer, { p_worker_instance_id: runtimeConfig.workerInstanceId });
    if (result.error || !Array.isArray(result.data) || result.data.length !== 1 ||
        typeof result.data[0]?.authorized !== "boolean") throw new Error("Automatic issuer unavailable.");
    return result.data[0].authorized;
  };
  let composition: ReturnType<typeof createDisabledProcessingWorkerComposition>;
  composition = createDisabledProcessingWorkerComposition({
    runtimeConfig, rpcCaller,
    intelligenceService: { url: settings.intelligenceUrl, token: settings.intelligenceToken },
    s3: { region: settings.region, bucket: settings.bucket, client: s3 },
    logger: event => { console.log(JSON.stringify(event)); },
    ...(controlled ? { controlledSingleAttempt: true } : {}),
    ...(settings.exactRetry ? { exactJobRetry: true, beforeClaim: async () => true } : settings.automaticAuthorization ? { beforeClaim: automaticClaimGate(issueScope, () => composition.recoverExpired(1), controlled) } : {}),
    ...(settings.reviewV3 ? { review: {
      store: new RpcPrescriptionReviewWorkerStore(rpcCaller),
      intelligence: new LocalConfirmedReviewIntelligenceClient({
        pythonExecutable: settings.pythonExecutable!, intelligenceDirectory: settings.intelligenceDirectory!, officialCatalogue: true,
        ...(settings.catalogueEnvironment === undefined ? {} : { catalogueEnvironment: settings.catalogueEnvironment }),
      }),
    } } : {}),
  });
  let stopping = false;
  let recovery: ReturnType<typeof scheduleWorkerRecovery> | undefined;
  const shutdown = () => { stopping = true; void composition.runtime.stop().catch(() => undefined); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      const scoped = settings.rpcMode === "scoped";
      const role = scoped ? "meddecode_scoped_worker" : "meddecode_worker";
      const prefix = scoped ? "meddecode_scoped_" : "";
      await connection.query(`SET LOCAL ROLE ${role}`);
      const check = await connection.query(`SELECT current_user AS role,
        EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=session_user
          AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
          AND NOT r.rolreplication AND NOT r.rolbypassrls)
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles prohibited
            WHERE prohibited.rolname IN ('postgres','service_role','authenticated','anon')
            AND pg_has_role(session_user,prohibited.rolname,'MEMBER'))
          AND ${scoped ? "NOT pg_has_role(session_user,'meddecode_worker','MEMBER')" : "true"} AS login_restricted,
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS privilege(name)
          WHERE n.nspname='public' AND c.relname IN ('users','health_profiles','family_members','medicine_cabinet','ai_jobs','prescriptions','prescription_intelligence_results',
            'prescription_medicines','prescription_medicine_alternatives','prescription_recommendations','prescription_warnings')
          AND has_table_privilege(session_user,c.oid,privilege.name))
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS privilege(name)
            WHERE n.nspname='public' AND c.relname IN ('users','health_profiles','family_members','medicine_cabinet','ai_jobs','prescriptions','prescription_intelligence_results',
              'prescription_medicines','prescription_medicine_alternatives','prescription_recommendations','prescription_warnings')
            AND has_any_column_privilege(session_user,c.oid,privilege.name)) AS login_no_table_access,
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS privilege(name)
          WHERE n.nspname='public' AND c.relname IN ('users','health_profiles','family_members','medicine_cabinet','ai_jobs','prescriptions','prescription_intelligence_results',
            'prescription_medicines','prescription_medicine_alternatives','prescription_recommendations','prescription_warnings')
          AND has_table_privilege(current_user,c.oid,privilege.name))
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS privilege(name)
            WHERE n.nspname='public' AND c.relname IN ('users','health_profiles','family_members','medicine_cabinet','ai_jobs','prescriptions','prescription_intelligence_results',
              'prescription_medicines','prescription_medicine_alternatives','prescription_recommendations','prescription_warnings')
            AND has_any_column_privilege(current_user,c.oid,privilege.name)) AS role_no_table_access,
        has_function_privilege(current_user, to_regprocedure('public.${prefix}claim_next_prescription_analysis_job_v1(text,integer)'), 'EXECUTE') AS claim_rpc,
        has_function_privilege(current_user, to_regprocedure('public.${prefix}heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer)'), 'EXECUTE') AS heartbeat_rpc,
        has_function_privilege(current_user, to_regprocedure('public.${prefix}complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb)'), 'EXECUTE') AS complete_rpc,
        has_function_privilege(current_user, to_regprocedure('public.${prefix}fail_prescription_analysis_job_v1(uuid,uuid,text,bigint,text,boolean,text,timestamp with time zone)'), 'EXECUTE') AS fail_rpc,
        has_function_privilege(current_user, to_regprocedure('public.${prefix}recover_expired_prescription_analysis_jobs_v1(integer)'), 'EXECUTE') AS recover_rpc,
        ${settings.automaticAuthorization ? "session_user='meddecode_auto_worker_login'" : "true"} AS automatic_login,
        ${settings.automaticAuthorization ? "coalesce(has_function_privilege(current_user,to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)'),'EXECUTE'),false)" : "true"} AS issuer_rpc,
        ${settings.reviewV3 ? "coalesce(has_function_privilege(current_user,to_regprocedure('public.meddecode_scoped_authorize_next_v3_job_v1(text)'),'EXECUTE'),false) AND coalesce(has_function_privilege(current_user,to_regprocedure('public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)'),'EXECUTE'),false) AND coalesce(has_function_privilege(current_user,to_regprocedure('public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)'),'EXECUTE'),false) AND coalesce(has_function_privilege(current_user,to_regprocedure('public.meddecode_load_confirmed_review_job_v1(uuid,uuid,uuid,text,text,bigint)'),'EXECUTE'),false) AND coalesce(has_function_privilege(current_user,to_regprocedure('public.meddecode_finalize_review_result_v1(uuid,uuid,uuid,text,text,bigint,jsonb)'),'EXECUTE'),false) AND coalesce(has_function_privilege(current_user,to_regprocedure('public.meddecode_fail_review_job_v1(uuid,uuid,uuid,text,text,bigint,text)'),'EXECUTE'),false)" : "true"} AS review_v3_rpcs,
        ${controlled ? "NOT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity a WHERE a.usename IN ('meddecode_worker_login','meddecode_scoped_worker_login','meddecode_auto_worker_login') AND a.pid <> pg_backend_pid())" : "true"} AS no_competing_worker_sessions`);
      const row = check.rows[0] as Record<string, unknown> | undefined;
      assertWorkerDatabaseIdentity(row, settings.rpcMode, settings.automaticAuthorization, controlled, settings.reviewV3);
      if (settings.exactRetry) {
        const prerequisites = await connection.query(`SELECT
          coalesce(has_function_privilege(current_user,to_regprocedure('public.meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer)'),'EXECUTE'),false)
          AND coalesce(has_function_privilege(current_user,to_regprocedure('public.meddecode_initialize_exact_retry_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,integer,bigint,uuid)'),'EXECUTE'),false) AS ok`);
        if (prerequisites.rows[0]?.ok !== true) throw new Error('Exact retry RPCs unavailable.');
      }
      await connection.query("ROLLBACK");
    } catch {
      try { await connection.query("ROLLBACK"); } catch { /* release below */ }
      throw new Error("Worker role or RPC prerequisites are unavailable.");
    } finally { connection.release(true); }
    // Continuous mode recovers leases; the controlled single attempt must not
    // requeue or retry any earlier claim automatically.
    if (settings.automaticAuthorization && !settings.exactRetry) {
      // Renew while an authorized claim is processing. Admission failures
      // stop future claims, while lease/scope fencing protects an active job.
      recovery = scheduleWorkerRecovery(async () => { await issueScope(); }, 30_000);
    } else if (!settings.singleAttempt) {
      await composition.recoverExpired(50);
      recovery = scheduleWorkerRecovery(() => composition.recoverExpired(50), 30_000);
    }
    await runWorkerLoop(composition.runtime, () => stopping, settings.singleAttempt);
  } finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    try { await composition.runtime.stop(); }
    finally {
      try { await recovery?.stop(); }
      finally { s3.destroy(); await pool.end(); }
    }
  }
}

if (require.main === module) {
  void runWorker().catch(() => { console.error("Worker startup or execution failed safely."); process.exitCode = 1; });
}
