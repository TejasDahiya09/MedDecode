\set ON_ERROR_STOP on

INSERT INTO public.processing_finalization_concurrency_probe (session_id, backend_pid, started_at)
VALUES (1, pg_backend_pid(), clock_timestamp());

BEGIN;
-- Session-scoped advisory lock is solely a deterministic test rendezvous. The
-- actual contention is the row lock taken by the real recovery function.
SELECT pg_advisory_lock(72003001);
-- This outer lock is acquired by the postgres test connection. It does not
-- grant meddecode_worker table access; the real RPC below remains role-bound.
SELECT id FROM public.ai_jobs
WHERE id = '73000000-0000-4000-8000-000000000001'::uuid
FOR UPDATE;
SELECT pg_sleep(2);
SET LOCAL ROLE meddecode_worker;
SELECT * FROM public.recover_expired_prescription_analysis_jobs_v1(1);
RESET ROLE;
UPDATE public.processing_finalization_concurrency_probe
SET finished_at = clock_timestamp(), outcome = 'recovered'
WHERE session_id = 1;
SELECT pg_advisory_unlock(72003001);
COMMIT;
\echo PHASE7_CONCURRENT_RECOVERY_PASS
