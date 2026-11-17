\set ON_ERROR_STOP on
\if :{?meddecode_expected_test_account}
\else
\quit
\endif
BEGIN READ ONLY;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT set_config('meddecode.expected_test_account', :'meddecode_expected_test_account', true);
DO $verify$
DECLARE r record;
BEGIN
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres'
     OR session_user <> 'postgres'
  THEN
    RAISE EXCEPTION 'generation 2 activation verification identity failure';
  END IF;

  IF to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)') IS NULL
  THEN
    RAISE EXCEPTION 'automatic issuer RPC is missing';
  END IF;
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'expected Supabase roles are missing';
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_proc AS p
    WHERE p.oid=to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)')
      AND p.prosrc ILIKE '%IF v_job.created THEN%'
      AND p.prosrc ILIKE '%rollout_generation=v_policy.current_rollout_generation%'
      AND p.prosrc ILIKE '%automatic test job limit reached%'
      AND p.prosrc ILIKE '%FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE%'
  ) THEN
    RAISE EXCEPTION 'Migration 008 one-job-per-generation admission contract is missing';
  END IF;

  IF NOT EXISTS (
       SELECT FROM public.meddecode_auto_worker_policy
       WHERE singleton
         AND current_rollout_generation=2
         AND enabled
         AND activated_at IS NOT NULL
         AND worker_login='meddecode_auto_worker_login'
         AND worker_instance_id='meddecode-auto-worker-001'
         AND scope_seconds=1200
     )
     OR NOT EXISTS (
       SELECT FROM public.meddecode_auto_rollout_generations
       WHERE generation=2 AND activated_at IS NOT NULL AND retired_at IS NULL
     )
     OR NOT EXISTS (
       SELECT FROM public.meddecode_auto_rollout_generations
       WHERE generation=1 AND activated_at IS NOT NULL
     )
     OR (SELECT count(*) FROM public.meddecode_auto_rollout_generations) <> 2
     OR (SELECT count(*) FROM public.meddecode_auto_test_account) <> 1
     OR NOT EXISTS (
       SELECT FROM public.meddecode_auto_test_account
       WHERE singleton
         AND user_id=current_setting('meddecode.expected_test_account')::uuid
     )
     OR (SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=1) < 1
     OR EXISTS (
       SELECT FROM public.meddecode_auto_authorized_jobs
       WHERE rollout_generation<>1
     )
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
     OR EXISTS (
       SELECT FROM public.meddecode_auto_authorized_jobs
       WHERE rollout_generation=2
     )
  THEN
    RAISE EXCEPTION 'generation 2 activation or Generation 1 audit verification failed';
  END IF;

  IF to_regrole('meddecode_auto_worker_login') IS NULL
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
  THEN
    RAISE EXCEPTION 'automatic worker login role configuration is invalid';
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'meddecode_scoped_worker',
       'public.meddecode_scoped_authorize_next_automatic_job_v1(text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.meddecode_scoped_authorize_next_automatic_job_v1(text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.meddecode_scoped_authorize_next_automatic_job_v1(text)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'automatic issuer RPC execution privileges are invalid';
  END IF;

  FOR r IN
    SELECT p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig
    FROM pg_proc AS p
    WHERE p.oid IN (
      to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)'),
      to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')
    )
  LOOP
    IF NOT r.prosecdef
       OR r.owner <> 'postgres'
       OR NOT EXISTS (
         SELECT FROM unnest(r.proconfig) AS config
         WHERE config IN ('search_path=""', 'search_path=')
       )
    THEN
      RAISE EXCEPTION 'automatic issuer RPC owner, SECURITY DEFINER, or fixed search_path is invalid';
    END IF;
  END LOOP;
END $verify$;
SELECT
  (SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=1)
    AS preserved_generation_1_admissions,
  (SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=2)
    AS generation_2_admissions;
SELECT 'AUTOMATIC_ROLLOUT_GENERATION_2_ACTIVATION_VERIFY_OK';
ROLLBACK;
