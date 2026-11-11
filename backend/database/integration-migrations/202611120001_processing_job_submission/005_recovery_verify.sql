\set ON_ERROR_STOP on

-- Independent verification after an approved 004_recovery.sql run. The temp
-- table carries only operator-supplied fingerprints and creates no persistent
-- database state.
BEGIN;

CREATE TEMP TABLE meddecode_processing_job_recovery_verify_baseline (
  ai_jobs_count bigint NOT NULL,
  result_count bigint NOT NULL,
  result_identity_fingerprint text NOT NULL,
  prescription_count bigint NOT NULL,
  prescription_status_fingerprint text NOT NULL
) ON COMMIT DROP;

INSERT INTO meddecode_processing_job_recovery_verify_baseline (
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

DO $recovery_verify$
DECLARE
  v_baseline meddecode_processing_job_recovery_verify_baseline%ROWTYPE;
  v_ai_jobs_count bigint;
  v_result_count bigint;
  v_result_fingerprint text;
  v_prescription_count bigint;
  v_prescription_fingerprint text;
  v_policy_command text;
  v_policy_roles name[];
  v_policy_check text;
  v_public_insert boolean;
BEGIN
  SELECT * INTO STRICT v_baseline
  FROM meddecode_processing_job_recovery_verify_baseline;

  IF to_regprocedure(
       'public.submit_prescription_analysis_job_v1(uuid,jsonb)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.get_prescription_analysis_status_v1(uuid)'
     ) IS NOT NULL
     OR to_regclass(
       'public.ai_jobs_one_active_prescription_analysis_uq'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'post-recovery verification: migration-owned objects remain';
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

  IF NOT has_table_privilege('authenticated', 'public.ai_jobs', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.ai_jobs', 'SELECT')
     OR v_public_insert THEN
    RAISE EXCEPTION
      'post-recovery verification: ai_jobs privilege state is incompatible';
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
      'post-recovery verification: ai_jobs ownership or RLS changed';
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
      'post-recovery verification: owner-scoped INSERT policy is incompatible';
  END IF;

  SELECT count(*) INTO v_ai_jobs_count FROM public.ai_jobs;
  IF v_ai_jobs_count IS DISTINCT FROM v_baseline.ai_jobs_count THEN
    RAISE EXCEPTION 'post-recovery verification: ai_jobs baseline changed';
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
      'post-recovery verification: intelligence result identities changed';
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
      'post-recovery verification: prescription identities or statuses changed';
  END IF;
END
$recovery_verify$;

COMMIT;
