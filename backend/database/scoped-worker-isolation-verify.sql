-- READ ONLY. Privilege inspection does not replace isolated concurrency tests.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $check$
DECLARE f regprocedure; signatures text[] := ARRAY[
  'public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer)',
  'public.meddecode_scoped_heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer)',
  'public.meddecode_scoped_complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb)',
  'public.meddecode_scoped_fail_prescription_analysis_job_v1(uuid,uuid,text,bigint,text,boolean,text,timestamptz)',
  'public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(integer)'];
DECLARE signature text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('public.meddecode_scoped_worker_scope') AND relrowsecurity) OR
     EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','meddecode_worker','meddecode_scoped_worker']) r(name)
       CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
       WHERE has_table_privilege(r.name,'public.meddecode_scoped_worker_scope',p.priv)) OR
     EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','meddecode_worker','meddecode_scoped_worker']) r(name)
       CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(priv)
       WHERE has_any_column_privilege(r.name,'public.meddecode_scoped_worker_scope',p.priv)) OR
     pg_has_role('meddecode_scoped_worker','meddecode_worker','MEMBER') OR
     has_function_privilege('meddecode_scoped_worker','public.claim_next_prescription_analysis_job_v1(text,integer)','EXECUTE') OR
     has_function_privilege('meddecode_scoped_worker','public.recover_expired_prescription_analysis_jobs_v1(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'scope table access is not restricted';
  END IF;
  FOREACH signature IN ARRAY signatures LOOP
    f := to_regprocedure(signature);
    IF f IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=f AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig @> ARRAY['search_path=""']) OR
      NOT has_function_privilege('meddecode_scoped_worker',f,'EXECUTE') OR has_function_privilege('anon',f,'EXECUTE') OR
      has_function_privilege('authenticated',f,'EXECUTE') OR has_function_privilege('meddecode_worker',f,'EXECUTE') OR
      EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=f AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'scoped function security check failed';
    END IF;
  END LOOP;
END $check$;
SELECT 'SCOPED_WORKER_VERIFY_OK';
ROLLBACK;
