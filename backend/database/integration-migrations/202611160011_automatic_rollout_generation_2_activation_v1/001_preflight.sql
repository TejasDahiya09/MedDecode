\set ON_ERROR_STOP on
\if :{?meddecode_expected_database}
\else
\quit
\endif
\if :{?meddecode_expected_project}
\else
\quit
\endif
\if :{?meddecode_expected_test_account}
\else
\quit
\endif
\if :{?meddecode_v3_local_readiness}
\else
\quit
\endif
BEGIN READ ONLY;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT set_config('meddecode.expected_database', :'meddecode_expected_database', true);
SELECT set_config('meddecode.expected_project', :'meddecode_expected_project', true);
SELECT set_config('meddecode.expected_test_account', :'meddecode_expected_test_account', true);
SELECT set_config('meddecode.v3_local_readiness', :'meddecode_v3_local_readiness', true);
DO $preflight$
DECLARE v_allowlist_count bigint; v_worker_sessions bigint; v_active_leases bigint;
BEGIN
  IF current_database() <> current_setting('meddecode.expected_database')
     OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('meddecode.expected_project') <> 'wyripeqruhvbksjfsvlr'
     OR current_setting('meddecode.v3_local_readiness') <> 'PASS'
     OR to_regclass('public.meddecode_auto_worker_policy') IS NULL
     OR to_regclass('public.meddecode_auto_rollout_generations') IS NULL
     OR to_regclass('public.meddecode_auto_authorized_jobs') IS NULL
     OR to_regclass('public.meddecode_auto_test_account') IS NULL
     OR to_regclass('public.meddecode_scoped_worker_scope') IS NULL
     OR to_regprocedure('public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)') IS NULL
  THEN RAISE EXCEPTION 'generation 2 activation preflight identity or schema failure'; END IF;
  SELECT count(*) INTO v_allowlist_count FROM public.meddecode_auto_test_account;
  SELECT count(*) INTO v_worker_sessions FROM pg_stat_activity WHERE usename IN ('meddecode_auto_worker_login','meddecode_scoped_worker_login','meddecode_worker_login') AND pid <> pg_backend_pid();
  SELECT count(*) INTO v_active_leases FROM public.ai_jobs WHERE status='processing' AND lease_expires_at > clock_timestamp();
  IF v_allowlist_count <> 1
     OR NOT EXISTS (SELECT FROM public.meddecode_auto_test_account WHERE singleton AND user_id=current_setting('meddecode.expected_test_account')::uuid)
     OR NOT EXISTS (SELECT FROM public.meddecode_auto_worker_policy WHERE singleton AND current_rollout_generation=2 AND NOT enabled AND activated_at IS NULL)
     OR NOT EXISTS (SELECT FROM public.meddecode_auto_rollout_generations WHERE generation=2 AND activated_at IS NULL AND retired_at IS NULL)
     OR NOT EXISTS (SELECT FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=1)
     OR EXISTS (SELECT FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=2)
     OR EXISTS (SELECT FROM public.meddecode_scoped_worker_scope s JOIN public.ai_jobs j ON j.id=s.job_id WHERE s.worker_login='meddecode_auto_worker_login' AND s.enabled AND s.expires_at>clock_timestamp() AND j.status IN ('queued','processing'))
     OR v_worker_sessions <> 0 OR v_active_leases <> 0
  THEN RAISE EXCEPTION 'generation 2 activation preflight safety failure'; END IF;
END $preflight$;
SELECT 'AUTOMATIC_ROLLOUT_GENERATION_2_ACTIVATION_PREFLIGHT_OK';
ROLLBACK;
