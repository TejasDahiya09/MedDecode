\set ON_ERROR_STOP on
\if :{?meddecode_expected_database}
\else
\set meddecode_expected_database postgres
\endif
BEGIN READ ONLY;
SELECT set_config('meddecode.expected_database', :'meddecode_expected_database', true);
DO $preflight$
BEGIN
  IF current_database() <> current_setting('meddecode.expected_database')
     OR to_regclass('public.prescription_ocr_evidence_sets') IS NULL
     OR to_regclass('public.prescription_review_revisions') IS NULL
     OR to_regclass('public.meddecode_auto_authorized_jobs') IS NULL
     OR to_regprocedure('public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.meddecode_scoped_authorize_next_v3_job_v1(text)') IS NULL
     OR to_regrole('meddecode_scoped_worker') IS NULL
     OR to_regprocedure('public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.meddecode_auto_worker_policy WHERE singleton AND enabled)
     OR EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope s JOIN public.ai_jobs j ON j.id=s.job_id
                WHERE s.worker_login='meddecode_auto_worker_login' AND s.enabled AND j.status IN ('queued','processing'))
  THEN RAISE EXCEPTION 'initial review completion preflight failed'; END IF;
END $preflight$;
SELECT 'PRESCRIPTION_REVIEW_INITIAL_COMPLETION_PREFLIGHT_OK';
ROLLBACK;
