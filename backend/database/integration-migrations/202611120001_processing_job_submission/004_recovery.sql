\set ON_ERROR_STOP on

-- OPERATOR-CONTROLLED RECOVERY ONLY. NOT A DEPLOYMENT SCRIPT.
--
-- Required psql variables must come from an independently captured and reviewed
-- pre-deployment baseline. The script intentionally fails before BEGIN unless
-- the operator supplies an explicit approval flag.
\if :{?meddecode_recovery_approved}
\else
  \echo 'Recovery refused: meddecode_recovery_approved was not supplied.'
  \quit 3
\endif
\if :meddecode_recovery_approved
\else
  \echo 'Recovery refused: meddecode_recovery_approved is not true.'
  \quit 3
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE meddecode_processing_job_recovery_baseline (
  ai_jobs_count bigint NOT NULL,
  result_count bigint NOT NULL,
  result_identity_fingerprint text NOT NULL,
  prescription_count bigint NOT NULL,
  prescription_status_fingerprint text NOT NULL
) ON COMMIT DROP;

INSERT INTO meddecode_processing_job_recovery_baseline (
  ai_jobs_count,
  result_count,
  result_identity_fingerprint,
  prescription_count,
  prescription_status_fingerprint
) VALUES (
  :'baseline_ai_jobs_count'::bigint,
  :'baseline_result_count'::bigint,
  :'baseline_result_identity_fingerprint',
  :'baseline_prescription_count'::bigint,
  :'baseline_prescription_status_fingerprint'
);

-- Callers must already be paused. These locks make the checked snapshots stable
-- for the remainder of the recovery transaction and fail quickly if writes are
-- still active.
LOCK TABLE public.prescriptions,
  public.ai_jobs,
  public.prescription_intelligence_results
  IN SHARE ROW EXCLUSIVE MODE;

DO $recovery_guard$
DECLARE
  v_baseline meddecode_processing_job_recovery_baseline%ROWTYPE;
  v_ai_jobs_count bigint;
  v_result_count bigint;
  v_result_fingerprint text;
  v_prescription_count bigint;
  v_prescription_fingerprint text;
  v_index_oid oid;
  v_index_valid boolean;
  v_index_ready boolean;
  v_index_unique boolean;
  v_index_key_count smallint;
  v_index_attribute_count smallint;
  v_index_access_method name;
  v_index_first_key text;
  v_index_second_key text;
  v_index_predicate text;
  v_normalized_predicate text;
  v_submission_oid oid;
  v_status_oid oid;
  v_named_function_count bigint;
  v_owner name;
  v_security_definer boolean;
  v_function_config text[];
  v_volatility "char";
  v_language name;
  v_result_signature text;
  v_source_hash text;
  v_public_execute boolean;
  v_policy_command text;
  v_policy_roles name[];
  v_policy_check text;
  v_public_insert boolean;
BEGIN
  SELECT * INTO STRICT v_baseline
  FROM meddecode_processing_job_recovery_baseline;

  -- The reviewed hosted baseline contained no ai_jobs. Any job after deployment
  -- requires manual reconciliation; this script never deletes or rewrites it.
  IF v_baseline.ai_jobs_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'recovery refused: captured ai_jobs baseline must be the independently verified zero';
  END IF;

  SELECT count(*) INTO v_ai_jobs_count FROM public.ai_jobs;
  IF v_ai_jobs_count IS DISTINCT FROM v_baseline.ai_jobs_count THEN
    RAISE EXCEPTION
      'recovery blocked: ai_jobs changed from captured baseline';
  END IF;

  SELECT
    count(*),
    md5(coalesce(string_agg(
      concat_ws('|', r.id::text, r.prescription_id::text,
        coalesce(r.job_id::text, '<null>')),
      E'\n' ORDER BY r.id
    ), ''))
  INTO v_result_count, v_result_fingerprint
  FROM public.prescription_intelligence_results AS r;

  IF v_result_count IS DISTINCT FROM v_baseline.result_count
     OR v_result_fingerprint IS DISTINCT FROM
       v_baseline.result_identity_fingerprint THEN
    RAISE EXCEPTION
      'recovery blocked: intelligence result identities changed from captured baseline';
  END IF;

  SELECT
    count(*),
    md5(coalesce(string_agg(
      concat_ws('|', p.id::text, p.status),
      E'\n' ORDER BY p.id
    ), ''))
  INTO v_prescription_count, v_prescription_fingerprint
  FROM public.prescriptions AS p;

  IF v_prescription_count IS DISTINCT FROM v_baseline.prescription_count
     OR v_prescription_fingerprint IS DISTINCT FROM
       v_baseline.prescription_status_fingerprint THEN
    RAISE EXCEPTION
      'recovery blocked: prescription identities or statuses changed from captured baseline';
  END IF;

  SELECT
    i.indexrelid,
    i.indisvalid,
    i.indisready,
    i.indisunique,
    i.indnkeyatts,
    i.indnatts,
    am.amname,
    pg_get_indexdef(i.indexrelid, 1, true),
    pg_get_indexdef(i.indexrelid, 2, true),
    pg_get_expr(i.indpred, i.indrelid)
  INTO
    v_index_oid,
    v_index_valid,
    v_index_ready,
    v_index_unique,
    v_index_key_count,
    v_index_attribute_count,
    v_index_access_method,
    v_index_first_key,
    v_index_second_key,
    v_index_predicate
  FROM pg_catalog.pg_index AS i
  JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = i.indexrelid
  JOIN pg_catalog.pg_am AS am ON am.oid = index_relation.relam
  WHERE i.indexrelid =
    to_regclass('public.ai_jobs_one_active_prescription_analysis_uq')
    AND i.indrelid = 'public.ai_jobs'::regclass;

  v_normalized_predicate := regexp_replace(
    lower(regexp_replace(v_index_predicate, '::[[:alnum:]_".]+', '', 'g')),
    '[[:space:]()"]',
    '',
    'g'
  );

  IF v_index_oid IS NULL
     OR v_index_valid IS DISTINCT FROM true
     OR v_index_ready IS DISTINCT FROM true
     OR v_index_unique IS DISTINCT FROM true
     OR v_index_key_count IS DISTINCT FROM 2
     OR v_index_attribute_count IS DISTINCT FROM 2
     OR v_index_access_method IS DISTINCT FROM 'btree'
     OR v_index_first_key IS DISTINCT FROM 'prescription_id'
     OR v_index_second_key IS DISTINCT FROM 'job_type'
     OR v_normalized_predicate IS DISTINCT FROM
       'prescription_idisnotnullandjob_type=''prescription_analysis''andstatus=anyarray[''queued'',''processing'']' THEN
    RAISE EXCEPTION
      'recovery refused: migration-owned active-job index differs from expected definition';
  END IF;

  SELECT count(*) INTO v_named_function_count
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'submit_prescription_analysis_job_v1',
      'get_prescription_analysis_status_v1'
    );

  v_submission_oid :=
    to_regprocedure('public.submit_prescription_analysis_job_v1(uuid,jsonb)');
  v_status_oid :=
    to_regprocedure('public.get_prescription_analysis_status_v1(uuid)');

  IF v_named_function_count IS DISTINCT FROM 2
     OR v_submission_oid IS NULL OR v_status_oid IS NULL THEN
    RAISE EXCEPTION
      'recovery refused: migration-owned RPC identity or overload set differs';
  END IF;

  SELECT
    owner_role.rolname,
    p.prosecdef,
    p.proconfig,
    p.provolatile,
    language.lanname,
    pg_get_function_result(p.oid),
    md5(regexp_replace(p.prosrc, E'\r\n?', E'\n', 'g')),
    EXISTS (
      SELECT 1
      FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )
  INTO
    v_owner,
    v_security_definer,
    v_function_config,
    v_volatility,
    v_language,
    v_result_signature,
    v_source_hash,
    v_public_execute
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = p.proowner
  JOIN pg_catalog.pg_language AS language ON language.oid = p.prolang
  WHERE p.oid = v_submission_oid;

  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_security_definer IS DISTINCT FROM true
     OR v_function_config IS DISTINCT FROM ARRAY['search_path=""']
     OR v_volatility IS DISTINCT FROM 'v'
     OR v_language IS DISTINCT FROM 'plpgsql'
     OR v_result_signature IS DISTINCT FROM
       'TABLE(job_id uuid, prescription_id uuid, job_status text, created boolean)'
     OR v_source_hash IS DISTINCT FROM 'f79ebc543f5128eea5e653d8cd9e1d6d'
     OR v_public_execute
     OR has_function_privilege('anon', v_submission_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_submission_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'recovery refused: submission RPC differs from expected migration definition';
  END IF;

  SELECT
    owner_role.rolname,
    p.prosecdef,
    p.proconfig,
    p.provolatile,
    language.lanname,
    pg_get_function_result(p.oid),
    md5(regexp_replace(p.prosrc, E'\r\n?', E'\n', 'g')),
    EXISTS (
      SELECT 1
      FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )
  INTO
    v_owner,
    v_security_definer,
    v_function_config,
    v_volatility,
    v_language,
    v_result_signature,
    v_source_hash,
    v_public_execute
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = p.proowner
  JOIN pg_catalog.pg_language AS language ON language.oid = p.prolang
  WHERE p.oid = v_status_oid;

  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_security_definer IS DISTINCT FROM false
     OR v_function_config IS DISTINCT FROM ARRAY['search_path=""']
     OR v_volatility IS DISTINCT FROM 's'
     OR v_language IS DISTINCT FROM 'sql'
     OR v_result_signature IS DISTINCT FROM
       'TABLE(prescription_id uuid, job_id uuid, job_status text, created_at timestamp with time zone, started_at timestamp with time zone, completed_at timestamp with time zone)'
     OR v_source_hash IS DISTINCT FROM '303abe8ae15afd81d7a75c574eb93132'
     OR v_public_execute
     OR has_function_privilege('anon', v_status_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_status_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'recovery refused: status RPC differs from expected migration definition';
  END IF;

  IF has_table_privilege('authenticated', 'public.ai_jobs', 'INSERT')
     OR has_any_column_privilege('authenticated', 'public.ai_jobs', 'INSERT') THEN
    RAISE EXCEPTION
      'recovery refused: authenticated ai_jobs INSERT is not in migrated state';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS table_relation
    CROSS JOIN LATERAL aclexplode(
      coalesce(table_relation.relacl, acldefault('r', table_relation.relowner))
    ) AS acl
    WHERE table_relation.oid = 'public.ai_jobs'::regclass
      AND acl.grantee = 0
      AND acl.privilege_type = 'INSERT'
  ) INTO v_public_insert;

  IF v_public_insert THEN
    RAISE EXCEPTION
      'recovery refused: PUBLIC has unexpected ai_jobs INSERT privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS table_relation
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.oid = table_relation.relowner
    WHERE table_relation.oid = 'public.ai_jobs'::regclass
      AND table_relation.relrowsecurity
      AND owner_role.rolname = 'postgres'
  ) THEN
    RAISE EXCEPTION
      'recovery refused: ai_jobs ownership or RLS state differs from baseline';
  END IF;

  SELECT p.cmd, p.roles, p.with_check
  INTO v_policy_command, v_policy_roles, v_policy_check
  FROM pg_catalog.pg_policies AS p
  WHERE p.schemaname = 'public'
    AND p.tablename = 'ai_jobs'
    AND p.policyname = 'ai_jobs_insert_own';

  IF v_policy_command IS DISTINCT FROM 'INSERT'
     OR NOT ('authenticated' = ANY(v_policy_roles))
     OR regexp_replace(coalesce(v_policy_check, ''), '[[:space:]()]', '', 'g')
       IS DISTINCT FROM 'user_id=auth.uid' THEN
    RAISE EXCEPTION
      'recovery refused: owner-scoped ai_jobs INSERT policy differs from baseline';
  END IF;
END
$recovery_guard$;

-- RESTRICT is intentional: unexpected dependencies stop recovery.
DROP FUNCTION public.submit_prescription_analysis_job_v1(uuid, jsonb) RESTRICT;
DROP FUNCTION public.get_prescription_analysis_status_v1(uuid) RESTRICT;
DROP INDEX public.ai_jobs_one_active_prescription_analysis_uq RESTRICT;

-- This is the only privilege restored. It is supported by the captured hosted
-- baseline and the exact owner-scoped INSERT policy checked above.
GRANT INSERT ON TABLE public.ai_jobs TO authenticated;

DO $recovery_transaction_verify$
DECLARE
  v_public_insert boolean;
BEGIN
  IF to_regprocedure(
       'public.submit_prescription_analysis_job_v1(uuid,jsonb)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.get_prescription_analysis_status_v1(uuid)'
     ) IS NOT NULL
     OR to_regclass(
       'public.ai_jobs_one_active_prescription_analysis_uq'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'recovery failed: migration-owned objects remain';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.ai_jobs', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.ai_jobs', 'SELECT') THEN
    RAISE EXCEPTION
      'recovery failed: documented authenticated ai_jobs privileges were not restored';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS table_relation
    CROSS JOIN LATERAL aclexplode(
      coalesce(table_relation.relacl, acldefault('r', table_relation.relowner))
    ) AS acl
    WHERE table_relation.oid = 'public.ai_jobs'::regclass
      AND acl.grantee = 0
      AND acl.privilege_type = 'INSERT'
  ) INTO v_public_insert;

  IF v_public_insert THEN
    RAISE EXCEPTION 'recovery failed: PUBLIC gained ai_jobs INSERT';
  END IF;
END
$recovery_transaction_verify$;

COMMIT;
