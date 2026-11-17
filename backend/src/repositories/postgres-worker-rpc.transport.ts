import { validatePrescriptionReviewContractV1 } from '../domain/prescription-review/index.js';

/** A dedicated connection from a worker-only pool; no credentials are accepted here. */
export interface WorkerPgConnection {
  query(sql: string, parameters?: readonly unknown[]): Promise<{ rows: readonly Record<string, unknown>[] }>;
  release(destroy?: boolean): void;
}
export interface WorkerPgPool { connect(): Promise<WorkerPgConnection>; }
export interface ExactJobRetry {
  readonly permitId: string;
  readonly jobId: string;
  readonly prescriptionId: string;
  readonly expectedClaimGeneration: number;
}

// These parameters are jsonb in the reviewed SQL. Ordinary PostgreSQL arrays
// and scalar values must retain pg's native encoding.
const jsonParameters = new Set(['p_result_json','p_evidence','p_review','p_medicines','p_event']);
function encodeJson(value: unknown): string {
  const ancestors = new Set<object>();
  const check = (item: unknown): void => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || ancestors.has(item) ||
        (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) throw new Error('Invalid JSON parameter');
    ancestors.add(item);
    if (Object.getOwnPropertySymbols(item).length) throw new Error('Invalid JSON parameter');
    for (const entry of Array.isArray(item) ? Array.from(item) : Object.values(item)) check(entry);
    ancestors.delete(item);
  };
  check(value);
  return JSON.stringify(value);
}

const calls: Readonly<Record<string, readonly string[]>> = {
  claim_next_prescription_analysis_job_v1: ["p_worker_instance_id", "p_lease_seconds"],
  heartbeat_prescription_analysis_job_v1: ["p_job_id", "p_worker_instance_id", "p_claim_generation", "p_extend_seconds"],
  complete_prescription_analysis_job_v1: ["p_job_id", "p_prescription_id", "p_worker_instance_id", "p_claim_generation", "p_result_json"],
  fail_prescription_analysis_job_v1: ["p_job_id", "p_prescription_id", "p_worker_instance_id", "p_claim_generation", "p_failure_code", "p_retryable", "p_contract_code", "p_retry_at"],
  recover_expired_prescription_analysis_jobs_v1: ["p_limit"],
  authorize_next_automatic_job_v1: ["p_worker_instance_id"],
  meddecode_scoped_authorize_next_v3_job_v1: ["p_worker_instance_id"],
  meddecode_initialize_prescription_review_v1: ["p_job_id", "p_prescription_id", "p_evidence", "p_review", "p_medicines", "p_event"],
  meddecode_complete_initial_review_job_v1: ["p_job_id", "p_prescription_id", "p_worker_instance_id", "p_attempt_count", "p_claim_generation"],
  meddecode_load_confirmed_review_job_v1: ["p_job_id", "p_prescription_id", "p_review_revision_id", "p_input_fingerprint", "p_worker_instance_id", "p_claim_generation"],
  meddecode_finalize_review_result_v1: ["p_job_id", "p_prescription_id", "p_review_revision_id", "p_input_fingerprint", "p_worker_instance_id", "p_claim_generation", "p_result_json"],
  meddecode_fail_review_job_v1: ["p_job_id", "p_prescription_id", "p_review_revision_id", "p_input_fingerprint", "p_worker_instance_id", "p_claim_generation", "p_failure_code"],
};

/**
 * Inject only a dedicated, TLS-verified pool using an approved login allowed to
 * SET ROLE meddecode_worker. Each RPC has its own transaction and role scope.
 * Construction opens no connection; this is not registered with Express.
 */
export class PostgresWorkerRpcCaller {
  private exactClaimAttempted = false;
  constructor(private readonly pool: WorkerPgPool, private readonly mode: "standard" | "scoped" = "standard", private readonly firstAttemptOnly = false,
    private readonly exactRetry?: ExactJobRetry) {
    if (mode !== "standard" && mode !== "scoped") throw new Error("Invalid worker RPC mode.");
    if (firstAttemptOnly && mode !== "scoped") throw new Error("Controlled attempts require scoped RPCs.");
    if (exactRetry && (!firstAttemptOnly || mode !== 'scoped' ||
        ![exactRetry.permitId, exactRetry.jobId, exactRetry.prescriptionId].every(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) ||
        !Number.isSafeInteger(exactRetry.expectedClaimGeneration) || exactRetry.expectedClaimGeneration<1 || exactRetry.expectedClaimGeneration>Number.MAX_SAFE_INTEGER-2)) {
      throw new Error('Invalid exact retry configuration.');
    }
  }

  async rpc(name: string, parameters: Readonly<Record<string, unknown>>): Promise<{ data: unknown; error: unknown }> {
    const keys = Object.hasOwn(calls, name) ? calls[name] : undefined;
    if (this.exactRetry) {
      const allowed = ['claim_next_prescription_analysis_job_v1', 'heartbeat_prescription_analysis_job_v1',
        'fail_prescription_analysis_job_v1', 'meddecode_initialize_prescription_review_v1', 'meddecode_complete_initial_review_job_v1'];
      if (!allowed.includes(name) || ('p_job_id' in parameters && parameters.p_job_id !== this.exactRetry.jobId) ||
          ('p_prescription_id' in parameters && parameters.p_prescription_id !== this.exactRetry.prescriptionId) ||
          ('p_claim_generation' in parameters && parameters.p_claim_generation !== this.exactRetry.expectedClaimGeneration+2) ||
          ('p_attempt_count' in parameters && parameters.p_attempt_count !== 2) || parameters.p_retryable === true) {
        return { data: null, error: { code: '42501' } };
      }
      if (name === 'claim_next_prescription_analysis_job_v1') {
        if (this.exactClaimAttempted) return { data: null, error: { code: 'MD_PRIOR_ATTEMPT' } };
        this.exactClaimAttempted = true;
      }
    }
    if (this.firstAttemptOnly && name === "recover_expired_prescription_analysis_jobs_v1") {
      return { data: null, error: { code: "42501" } };
    }
    if ((name === "authorize_next_automatic_job_v1" || name.startsWith("meddecode_")) && this.mode !== "scoped") {
      return { data: null, error: { code: "42501" } };
    }
    if (!keys || Object.keys(parameters).length !== keys.length || keys.some(key => !Object.hasOwn(parameters, key))) {
      return { data: null, error: { code: "22023" } };
    }
    let connection: WorkerPgConnection | undefined;
    let discard = false;
    try {
      connection = await this.pool.connect();
      await connection.query("BEGIN");
      const role = this.mode === "scoped" ? "meddecode_scoped_worker" : "meddecode_worker";
      await connection.query(`SET LOCAL ROLE ${role}`);
      const identity = await connection.query("SELECT current_user AS role");
      if (identity.rows.length !== 1 || identity.rows[0]?.role !== role) throw new Error("worker role verification failed");
      let values = keys.map(key => jsonParameters.has(key) ? encodeJson(parameters[key]) : parameters[key]);
      // name is selected exclusively from the fixed allowlist above.
      let rpcName = name.startsWith("meddecode_") ? name : this.mode === "scoped" ? `meddecode_scoped_${name}` : name;
      if (this.exactRetry && name === 'claim_next_prescription_analysis_job_v1') {
        rpcName = 'meddecode_recover_claim_exact_job_v1';
        values = [this.exactRetry.permitId,this.exactRetry.jobId,this.exactRetry.prescriptionId,parameters.p_worker_instance_id,parameters.p_lease_seconds];
      }
      if (this.exactRetry && name === 'meddecode_initialize_prescription_review_v1') {
        rpcName = 'meddecode_initialize_exact_retry_review_v1';
        values.push('meddecode-auto-worker-001',2,this.exactRetry.expectedClaimGeneration+2,this.exactRetry.permitId);
      }
      const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
      const result = await connection.query(`SELECT * FROM public.${rpcName}(${placeholders})`, values);
      if (this.firstAttemptOnly && name === "claim_next_prescription_analysis_job_v1" &&
          result.rows.length > 0 && (result.rows.length !== 1 || result.rows[0]?.attempt_count !== (this.exactRetry ? 2 : 1) ||
            (this.exactRetry && (result.rows[0]?.job_id !== this.exactRetry.jobId || result.rows[0]?.prescription_id !== this.exactRetry.prescriptionId ||
              Number(result.rows[0]?.claim_generation) !== this.exactRetry.expectedClaimGeneration+2)))) {
        // Roll back any claim outside this mode's exact authorized attempt.
        // Normal controlled mode still permits attempt 1 only.
        await connection.query("ROLLBACK");
        return { data: null, error: { code: "MD_PRIOR_ATTEMPT" } };
      }
      const rows = result.rows.map(row => {
        const output = { ...row };
        const value = output.claim_generation;
        if (typeof value === "string") {
          if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("unsafe generation");
          output.claim_generation = Number(value);
        }
        for (const key of ["lease_expires_at", "available_at"]) {
          if (output[key] instanceof Date) output[key] = (output[key] as Date).toISOString();
        }
        return output;
      });
      let data: unknown = rows;
      if (name === 'meddecode_initialize_prescription_review_v1') {
        const scalar = rows[0]?.[rpcName];
        if (rows.length !== 1 || Object.keys(rows[0]!).length !== 1 ||
            scalar === null || typeof scalar !== 'object' || Array.isArray(scalar)) {
          throw new Error('Invalid scalar JSONB response');
        }
        // Validate before COMMIT so a corrupt response cannot durably initialize
        // a draft that the caller would then reject.
        data = validatePrescriptionReviewContractV1(scalar);
      }
      await connection.query("COMMIT");
      return { data, error: null };
    } catch (error) {
      if (connection) {
        try { await connection.query("ROLLBACK"); } catch { discard = true; }
      }
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
      const message = error instanceof Error && (
        (code === '55000' && ['stale or expired worker claim', 'stale finalization', 'stale failure'].includes(error.message)) ||
        (code === 'P0001' && ['review_forbidden', 'review_stale', 'review_not_found', 'review_conflict'].includes(error.message))
      ) ? error.message : null;
      // Preserve only safe categories, never provider messages or credentials.
      return { data: null, error: { code, message, rpcName: name, category: code === null ? 'RPC_CONTRACT_OR_TRANSPORT' : 'DATABASE' } };
    } finally {
      connection?.release(discard);
    }
  }
}
