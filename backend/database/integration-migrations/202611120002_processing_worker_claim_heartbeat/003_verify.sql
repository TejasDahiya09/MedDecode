\set ON_ERROR_STOP on

DO $verify$
DECLARE
  v_claim oid := to_regprocedure('public.claim_next_prescription_analysis_job_v1(text,integer)');
  v_heartbeat oid := to_regprocedure('public.heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer)');
  v_bad bigint;
BEGIN
  IF v_claim IS NULL OR v_heartbeat IS NULL THEN
    RAISE EXCEPTION 'worker claim or heartbeat RPC is missing';
  END IF;
  SELECT count(*) INTO v_bad
  FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
  WHERE p.oid IN (v_claim, v_heartbeat)
    AND (r.rolname IS DISTINCT FROM 'postgres' OR p.prosecdef IS DISTINCT FROM true
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']);
  IF v_bad <> 0 THEN RAISE EXCEPTION 'worker RPC owner, security mode, or search path is invalid'; END IF;
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p,
         LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
       WHERE p.oid IN (v_claim, v_heartbeat)
         AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', v_claim, 'EXECUTE')
     OR has_function_privilege('anon', v_heartbeat, 'EXECUTE')
     OR has_function_privilege('authenticated', v_claim, 'EXECUTE')
     OR has_function_privilege('authenticated', v_heartbeat, 'EXECUTE')
     OR NOT has_function_privilege('meddecode_worker', v_claim, 'EXECUTE')
     OR NOT has_function_privilege('meddecode_worker', v_heartbeat, 'EXECUTE') THEN
    RAISE EXCEPTION 'worker RPC grants are invalid';
  END IF;
  IF NOT has_schema_privilege('meddecode_worker', 'public', 'USAGE')
     OR has_schema_privilege('meddecode_worker', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'worker schema privileges are invalid';
  END IF;
  IF has_table_privilege('meddecode_worker', 'public.ai_jobs', 'SELECT')
     OR has_table_privilege('meddecode_worker', 'public.ai_jobs', 'INSERT')
     OR has_table_privilege('meddecode_worker', 'public.ai_jobs', 'UPDATE')
     OR has_table_privilege('meddecode_worker', 'public.ai_jobs', 'DELETE')
     OR has_table_privilege('meddecode_worker', 'public.ai_jobs', 'TRUNCATE')
     OR has_table_privilege('meddecode_worker', 'public.ai_jobs', 'REFERENCES')
     OR has_table_privilege('meddecode_worker', 'public.ai_jobs', 'TRIGGER')
     OR has_table_privilege('meddecode_worker', 'public.ai_jobs', 'MAINTAIN')
     OR has_any_column_privilege('meddecode_worker', 'public.ai_jobs', 'SELECT')
     OR has_any_column_privilege('meddecode_worker', 'public.ai_jobs', 'INSERT')
     OR has_any_column_privilege('meddecode_worker', 'public.ai_jobs', 'UPDATE')
     OR has_any_column_privilege('meddecode_worker', 'public.ai_jobs', 'REFERENCES')
     OR has_table_privilege('meddecode_worker', 'public.prescriptions', 'SELECT')
     OR has_table_privilege('meddecode_worker', 'public.prescriptions', 'INSERT')
     OR has_table_privilege('meddecode_worker', 'public.prescriptions', 'UPDATE')
     OR has_table_privilege('meddecode_worker', 'public.prescriptions', 'DELETE')
     OR has_table_privilege('meddecode_worker', 'public.prescriptions', 'TRUNCATE')
     OR has_table_privilege('meddecode_worker', 'public.prescriptions', 'REFERENCES')
     OR has_table_privilege('meddecode_worker', 'public.prescriptions', 'TRIGGER')
     OR has_table_privilege('meddecode_worker', 'public.prescriptions', 'MAINTAIN')
     OR has_any_column_privilege('meddecode_worker', 'public.prescriptions', 'SELECT')
     OR has_any_column_privilege('meddecode_worker', 'public.prescriptions', 'INSERT')
     OR has_any_column_privilege('meddecode_worker', 'public.prescriptions', 'UPDATE')
     OR has_any_column_privilege('meddecode_worker', 'public.prescriptions', 'REFERENCES') THEN
    RAISE EXCEPTION 'worker role has direct table privileges';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.ai_jobs'::regclass
        AND conname IN ('ai_jobs_attempt_bounds_check', 'ai_jobs_claim_generation_check',
                        'ai_jobs_lease_state_check') AND convalidated) <> 3 THEN
    RAISE EXCEPTION 'worker constraints are missing or unvalidated';
  END IF;
  IF to_regclass('public.ai_jobs_worker_available_idx') IS NULL
     OR to_regclass('public.ai_jobs_worker_lease_expiry_idx') IS NULL THEN
    RAISE EXCEPTION 'worker scheduling indexes are missing';
  END IF;
END
$verify$;
