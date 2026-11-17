/*
NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED

Phase 5.7h revision of the Phase 5.7f schema proposal. This is an inert design
draft. Concurrent and transactional phases are intentionally separated. Every
name, owner, grant, policy, default privilege, and existing constraint must be
recaptured from the target catalog before conversion into a migration.

BLOCKING PREREQUISITES
1. Re-run zero-anomaly audits for jobs, result lineage, and owner correlation.
2. Confirm PostgreSQL version and exact table/constraint/index/policy names.
3. Approve the worker authentication model and prove hosted Supabase support.
4. Create or verify a private schema and a non-login function owner only after
   the deployment identity and rollback privileges are proven.
5. Approve the endpoint-to-privilege matrix, including prescription deletion.
6. Capture current grants and policies so rollback restores evidence, not
   guessed broad privileges.

------------------------------------------------------------------------
PRE-MIGRATION EXISTING-ROW SAFETY AUDIT (read-only design; STOP on anomalies)
------------------------------------------------------------------------

-- Re-run immediately before every isolated/staging attempt. These aggregates
-- are evidence gates, not remediation. Any non-zero value stops the phase.
SELECT
  count(*) FILTER (WHERE r.job_id IS NULL) AS results_missing_job_id,
  count(*) FILTER (
    WHERE r.job_id IS NOT NULL
      AND (j.id IS NULL OR j.prescription_id IS DISTINCT FROM r.prescription_id)
  ) AS results_with_invalid_job_lineage
FROM public.prescription_intelligence_results AS r
LEFT JOIN public.ai_jobs AS j ON j.id = r.job_id;

-- STOP CONDITIONS:
-- * any processing job lacks complete lease state;
-- * any non-processing job retains lease state;
-- * any lifecycle counter/generation is incompatible;
-- * any result has NULL job_id or mismatched/missing job lineage.
-- Historical rows must be handled by a separately reviewed and approved
-- remediation or quarantine plan. This migration must not silently assign a
-- job, invent lease state, rewrite clinical JSON, or coerce a lifecycle status.
-- Repeat both aggregates after any authorized remediation and again directly
-- before Phase B, Phase C validation, and the SET NOT NULL operation.

------------------------------------------------------------------------
PHASE A - SUPPORTING INDEXES (each outside a transaction)
------------------------------------------------------------------------

CREATE UNIQUE INDEX CONCURRENTLY prescriptions_id_user_id_uq_idx
    ON public.prescriptions (id, user_id);

CREATE UNIQUE INDEX CONCURRENTLY ai_jobs_id_prescription_id_uq_idx
    ON public.ai_jobs (id, prescription_id);

CREATE UNIQUE INDEX CONCURRENTLY ai_jobs_one_active_prescription_job_uq_idx
    ON public.ai_jobs (prescription_id, job_type)
    WHERE prescription_id IS NOT NULL
      AND status IN ('queued', 'processing');

------------------------------------------------------------------------
PHASE B - TRANSACTIONAL SCHEMA ADDITIONS
------------------------------------------------------------------------

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.prescriptions
  ADD CONSTRAINT prescriptions_id_user_id_key
  UNIQUE USING INDEX prescriptions_id_user_id_uq_idx;

ALTER TABLE public.ai_jobs
  ADD CONSTRAINT ai_jobs_id_prescription_id_key
  UNIQUE USING INDEX ai_jobs_id_prescription_id_uq_idx;

ALTER TABLE public.ai_jobs
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN claim_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN last_error_code text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.ai_jobs
  ADD CONSTRAINT ai_jobs_attempts_check
    CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 20
           AND attempt_count <= max_attempts) NOT VALID,
  ADD CONSTRAINT ai_jobs_claim_generation_check
    CHECK (claim_generation >= 0) NOT VALID,
  ADD CONSTRAINT ai_jobs_prescription_analysis_requires_prescription_check
    CHECK (job_type <> 'prescription_analysis' OR prescription_id IS NOT NULL)
    NOT VALID,
  ADD CONSTRAINT ai_jobs_lease_shape_check
    CHECK (
      (status = 'processing'
       AND lease_owner IS NOT NULL
       AND lease_expires_at IS NOT NULL
       AND heartbeat_at IS NOT NULL)
      OR
      (status <> 'processing'
       AND lease_owner IS NULL
       AND lease_expires_at IS NULL
       AND heartbeat_at IS NULL)
    ) NOT VALID;

ALTER TABLE public.ai_jobs
  ADD CONSTRAINT ai_jobs_prescription_owner_fkey
  FOREIGN KEY (prescription_id, user_id)
  REFERENCES public.prescriptions (id, user_id)
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.prescription_intelligence_results
  ADD CONSTRAINT intelligence_results_job_prescription_fkey
  FOREIGN KEY (job_id, prescription_id)
  REFERENCES public.ai_jobs (id, prescription_id)
  ON DELETE RESTRICT
  NOT VALID;

COMMIT;

------------------------------------------------------------------------
PHASE C - VALIDATION (separate approved operations)
------------------------------------------------------------------------

-- The proposed lease/counter columns now exist. Existing processing rows are
-- expected to surface here because no lease state was silently fabricated.
SELECT
  count(*) FILTER (
    WHERE j.status = 'processing'
      AND (j.lease_owner IS NULL
        OR j.lease_expires_at IS NULL
        OR j.heartbeat_at IS NULL)
  ) AS processing_jobs_missing_lease_state,
  count(*) FILTER (
    WHERE j.status <> 'processing'
      AND (j.lease_owner IS NOT NULL
        OR j.lease_expires_at IS NOT NULL
        OR j.heartbeat_at IS NOT NULL)
  ) AS nonprocessing_jobs_with_lease_state,
  count(*) FILTER (
    WHERE j.attempt_count < 0
       OR j.max_attempts NOT BETWEEN 1 AND 20
       OR j.attempt_count > j.max_attempts
       OR j.claim_generation < 0
  ) AS incompatible_lifecycle_rows
FROM public.ai_jobs AS j;

-- STOP and re-run both pre-migration aggregate audits before this phase.
-- Constraint validation and SET NOT NULL are forbidden while any anomaly is
-- non-zero; no inline UPDATE/backfill is authorized by this proposal.

ALTER TABLE public.ai_jobs VALIDATE CONSTRAINT ai_jobs_attempts_check;
ALTER TABLE public.ai_jobs VALIDATE CONSTRAINT ai_jobs_claim_generation_check;
ALTER TABLE public.ai_jobs
  VALIDATE CONSTRAINT ai_jobs_prescription_analysis_requires_prescription_check;
ALTER TABLE public.ai_jobs VALIDATE CONSTRAINT ai_jobs_lease_shape_check;
ALTER TABLE public.ai_jobs VALIDATE CONSTRAINT ai_jobs_prescription_owner_fkey;
ALTER TABLE public.prescription_intelligence_results
  VALIDATE CONSTRAINT intelligence_results_job_prescription_fkey;

ALTER TABLE public.prescription_intelligence_results
  ALTER COLUMN job_id SET NOT NULL;

CREATE INDEX CONCURRENTLY ai_jobs_claimable_idx
    ON public.ai_jobs (available_at, created_at, id)
    WHERE status = 'queued';

CREATE INDEX CONCURRENTLY ai_jobs_expired_lease_idx
    ON public.ai_jobs (lease_expires_at, id)
    WHERE status = 'processing';

------------------------------------------------------------------------
PHASE D - FOREIGN-KEY CUTOVER DECISION
------------------------------------------------------------------------

-- BLOCKED: inventory the existing scalar FKs. The composite FKs may coexist
-- temporarily for validation, but the approved cutover must explicitly retain
-- or drop each redundant scalar FK by its verified live name. Never guess a
-- name. Rollback must restore captured definitions and delete actions.

------------------------------------------------------------------------
PHASE E - PERMISSION HARDENING (BLOCKED pending dependency matrix)
------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON TABLE public.ai_jobs FROM authenticated;

REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.prescription_medicines,
           public.prescription_recommendations,
           public.prescription_warnings,
           public.prescription_medicine_alternatives,
           public.prescription_intelligence_results
  FROM authenticated;

-- The historical policy ai_jobs_insert_own must be removed only after its
-- exact live definition and all application dependencies are captured:
-- DROP POLICY ai_jobs_insert_own ON public.ai_jobs;

-- BLOCKED: direct prescription UPDATE/DELETE remains until approved user-edit
-- and deletion RPCs exist. Concurrent deletion must not bypass the lifecycle
-- lock strategy.

-- BLOCKED: decide whether to add a narrow job_type CHECK. Do not constrain
-- future job types without an approved vocabulary. A reviewed trigger or every
-- privileged function must maintain ai_jobs.updated_at; no trigger is asserted
-- to exist until catalog evidence proves it.

END OF INERT PROPOSAL
*/
