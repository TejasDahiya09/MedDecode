-- Operational artifact. Hosted execution requires separate explicit approval.
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
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT set_config('meddecode.expected_database', :'meddecode_expected_database', true);
SELECT set_config('meddecode.expected_project', :'meddecode_expected_project', true);
SELECT set_config('meddecode.expected_test_account', :'meddecode_expected_test_account', true);
SELECT set_config('meddecode.v3_local_readiness', :'meddecode_v3_local_readiness', true);
DO $activate$
DECLARE
  v_policy public.meddecode_auto_worker_policy%ROWTYPE;
  v_allowlist_count bigint;
  v_generation_1_admissions bigint;
  v_generation_1_created_at timestamptz;
  v_generation_1_activated_at timestamptz;
  v_generation_1_retired_at timestamptz;
BEGIN
  IF current_database() <> 'postgres'
     OR current_database() <> current_setting('meddecode.expected_database')
     OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('meddecode.expected_project') <> 'wyripeqruhvbksjfsvlr'
     OR current_setting('meddecode.v3_local_readiness') <> 'PASS'
  THEN RAISE EXCEPTION 'generation 2 activation identity or local-readiness failure'; END IF;
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('meddecode_scoped_worker') IS NULL
     OR to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)') IS NULL
  THEN RAISE EXCEPTION 'automatic issuer RPC or expected role is missing'; END IF;
  IF has_function_privilege(
       'anon',
       'public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.meddecode_scoped_authorize_next_automatic_job_v1(text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.meddecode_scoped_authorize_next_automatic_job_v1(text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'meddecode_scoped_worker',
       'public.meddecode_scoped_authorize_next_automatic_job_v1(text)',
       'EXECUTE'
     )
  THEN RAISE EXCEPTION 'automatic issuer RPC execution privileges are invalid'; END IF;
  IF (
       SELECT count(*)
       FROM pg_proc
       WHERE oid IN (
         to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)'),
         to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')
       )
     ) <> 2
     OR EXISTS (
       SELECT FROM pg_proc AS p
       WHERE p.oid IN (
         to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)'),
         to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')
       )
         AND (
           NOT p.prosecdef
           OR pg_get_userbyid(p.proowner) <> 'postgres'
           OR NOT EXISTS (
             SELECT FROM unnest(p.proconfig) AS config
             WHERE config IN ('search_path=""', 'search_path=')
           )
         )
     )
  THEN RAISE EXCEPTION 'automatic issuer RPC owner, SECURITY DEFINER, or fixed search_path is invalid'; END IF;
  SELECT * INTO v_policy FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE;
  PERFORM 1 FROM public.meddecode_auto_rollout_generations WHERE generation=2 FOR UPDATE;
  PERFORM 1 FROM public.meddecode_auto_rollout_generations WHERE generation=1 FOR SHARE;
  PERFORM 1 FROM public.meddecode_auto_test_account WHERE singleton FOR SHARE;
  SELECT count(*) INTO v_allowlist_count FROM public.meddecode_auto_test_account;
  SELECT count(*) INTO v_generation_1_admissions
    FROM public.meddecode_auto_authorized_jobs
    WHERE rollout_generation=1;
  SELECT created_at, activated_at, retired_at
    INTO v_generation_1_created_at, v_generation_1_activated_at, v_generation_1_retired_at
    FROM public.meddecode_auto_rollout_generations
    WHERE generation=1;
  -- Migration 008 has no max-jobs column: its serialized admission RPC caps
  -- each generation through the rollout_generation ledger.
  IF v_policy.singleton IS DISTINCT FROM true OR v_allowlist_count <> 1
     OR NOT EXISTS (SELECT FROM public.meddecode_auto_test_account WHERE singleton AND user_id=current_setting('meddecode.expected_test_account')::uuid)
     OR v_policy.current_rollout_generation <> 2 OR v_policy.enabled OR v_policy.activated_at IS NOT NULL
     OR v_policy.worker_login <> 'meddecode_auto_worker_login'::name
     OR v_policy.worker_instance_id <> 'meddecode-auto-worker-001'
     OR v_policy.scope_seconds <> 1200
     OR NOT EXISTS (
       SELECT FROM pg_proc AS p
       WHERE p.oid=to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)')
         AND p.prosrc ILIKE '%IF v_job.created THEN%'
         AND p.prosrc ILIKE '%rollout_generation=v_policy.current_rollout_generation%'
         AND p.prosrc ILIKE '%automatic test job limit reached%'
         AND p.prosrc ILIKE '%FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE%'
     )
     OR to_regrole('meddecode_auto_worker_login') IS NULL
     OR to_regrole('meddecode_scoped_worker') IS NULL
     OR NOT EXISTS (
       SELECT FROM pg_roles
       WHERE oid=to_regrole('meddecode_auto_worker_login')
         AND rolcanlogin
         AND NOT (rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
     )
     OR NOT EXISTS (
       SELECT FROM pg_auth_members
       WHERE roleid=to_regrole('meddecode_scoped_worker')
         AND member=to_regrole('meddecode_auto_worker_login')
         AND set_option AND NOT inherit_option AND NOT admin_option
     )
     OR EXISTS (
       SELECT FROM pg_auth_members
       WHERE member=to_regrole('meddecode_auto_worker_login')
         AND roleid<>to_regrole('meddecode_scoped_worker')
     )
     OR NOT EXISTS (SELECT FROM public.meddecode_auto_rollout_generations WHERE generation=2 AND activated_at IS NULL AND retired_at IS NULL)
     OR v_generation_1_activated_at IS NULL
     OR v_generation_1_admissions < 1
     OR EXISTS (SELECT FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation<>1)
     OR EXISTS (
       SELECT FROM public.meddecode_auto_authorized_jobs AS a
       LEFT JOIN public.ai_jobs AS j ON j.id=a.job_id
       LEFT JOIN public.prescriptions AS p ON p.id=a.prescription_id
       WHERE a.rollout_generation=1
         AND (
           a.admitted_at IS NULL
           OR j.id IS NULL
           OR j.prescription_id IS DISTINCT FROM a.prescription_id
           OR j.user_id IS DISTINCT FROM a.user_id
           OR p.id IS NULL
           OR p.user_id IS DISTINCT FROM a.user_id
         )
     )
     OR EXISTS (SELECT FROM public.meddecode_scoped_worker_scope s JOIN public.ai_jobs j ON j.id=s.job_id WHERE s.worker_login=v_policy.worker_login AND s.enabled AND s.expires_at>clock_timestamp() AND j.status IN ('queued','processing'))
     OR EXISTS (SELECT FROM pg_stat_activity WHERE usename IN ('meddecode_auto_worker_login','meddecode_scoped_worker_login','meddecode_worker_login') AND pid<>pg_backend_pid())
     OR EXISTS (SELECT FROM public.ai_jobs WHERE status='processing' AND lease_expires_at>clock_timestamp())
  THEN RAISE EXCEPTION 'generation 2 activation safety preconditions failed'; END IF;
  UPDATE public.meddecode_auto_rollout_generations SET activated_at=clock_timestamp() WHERE generation=2;
  UPDATE public.meddecode_auto_worker_policy SET enabled=true,activated_at=clock_timestamp() WHERE singleton;
  IF (SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=1)
       IS DISTINCT FROM v_generation_1_admissions
     OR NOT EXISTS (
       SELECT FROM public.meddecode_auto_rollout_generations
       WHERE generation=1
         AND created_at IS NOT DISTINCT FROM v_generation_1_created_at
         AND activated_at IS NOT DISTINCT FROM v_generation_1_activated_at
         AND retired_at IS NOT DISTINCT FROM v_generation_1_retired_at
     )
     OR EXISTS (SELECT FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation<>1)
  THEN
    RAISE EXCEPTION 'Generation 1 history changed during activation';
  END IF;
END $activate$;
SELECT
  (SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=1)
    AS preserved_generation_1_admissions,
  (SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=2)
    AS generation_2_admissions_created;
SELECT 'AUTOMATIC_ROLLOUT_GENERATION_2_ACTIVATED';
COMMIT;
