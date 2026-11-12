\set ON_ERROR_STOP on

-- LOCAL INTEGRATION CANDIDATE ONLY. NOT APPROVED FOR HOSTED DEPLOYMENT.
DO $verify$
DECLARE
  v_complete oid := to_regprocedure('public.complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb)');
  v_fail oid := to_regprocedure('public.fail_prescription_analysis_job_v1(uuid,uuid,text,bigint,text,boolean,text,timestamp with time zone)');
  v_recover oid := to_regprocedure('public.recover_expired_prescription_analysis_jobs_v1(integer)');
  v_bad bigint;
BEGIN
  IF v_complete IS NULL OR v_fail IS NULL OR v_recover IS NULL THEN
    RAISE EXCEPTION 'worker finalization or recovery function is missing';
  END IF;
  SELECT count(*) INTO v_bad
  FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
  WHERE p.oid IN (v_complete, v_fail, v_recover)
    AND (r.rolname IS DISTINCT FROM 'postgres' OR p.prosecdef IS DISTINCT FROM true
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']);
  IF v_bad <> 0 THEN RAISE EXCEPTION 'worker finalization function security is invalid'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p,
      LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE p.oid IN (v_complete, v_fail, v_recover)
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) OR has_function_privilege('anon', v_complete, 'EXECUTE')
    OR has_function_privilege('anon', v_fail, 'EXECUTE')
    OR has_function_privilege('anon', v_recover, 'EXECUTE')
    OR has_function_privilege('authenticated', v_complete, 'EXECUTE')
    OR has_function_privilege('authenticated', v_fail, 'EXECUTE')
    OR has_function_privilege('authenticated', v_recover, 'EXECUTE')
    OR NOT has_function_privilege('meddecode_worker', v_complete, 'EXECUTE')
    OR NOT has_function_privilege('meddecode_worker', v_fail, 'EXECUTE')
    OR NOT has_function_privilege('meddecode_worker', v_recover, 'EXECUTE') THEN
    RAISE EXCEPTION 'worker finalization function grants are invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'public.ai_jobs', 'public.prescriptions', 'public.prescription_intelligence_results',
      'public.prescription_medicines', 'public.prescription_recommendations',
      'public.prescription_warnings'
    ]) AS t(name)
    WHERE has_table_privilege('meddecode_worker', t.name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       OR has_any_column_privilege('meddecode_worker', t.name, 'SELECT,INSERT,UPDATE,REFERENCES')
  ) THEN
    RAISE EXCEPTION 'worker role has direct finalization table privileges';
  END IF;
END
$verify$;
