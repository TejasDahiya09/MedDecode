-- REVIEW ONLY. This is not an automatic rollback artifact.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $review$
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
     OR EXISTS (SELECT FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=2)
     OR EXISTS (SELECT FROM public.meddecode_scoped_worker_scope s JOIN public.meddecode_auto_authorized_jobs a ON a.job_id=s.job_id WHERE a.rollout_generation=2 AND s.enabled)
  THEN RAISE EXCEPTION 'generation 2 activation rollback is unsafe'; END IF;
  -- A separately approved rollback may disable policy admission only. It must never erase admissions or rewrite Generation 1 history.
END $review$;
ROLLBACK;
