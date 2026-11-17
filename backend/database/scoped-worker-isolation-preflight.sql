-- READ ONLY. Candidate is not approved for deployment.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $check$
DECLARE r record;
BEGIN
  IF current_user <> 'postgres' OR current_setting('server_version_num')::integer / 10000 <> 17 OR
     to_regclass('public.meddecode_scoped_worker_scope') IS NOT NULL OR
     to_regrole('meddecode_scoped_worker') IS NULL OR to_regrole('meddecode_worker') IS NULL OR
     to_regrole('authenticated') IS NULL OR to_regrole('anon') IS NULL OR
     to_regprocedure('public.claim_next_prescription_analysis_job_v1(text,integer)') IS NULL OR
     to_regprocedure('public.heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer)') IS NULL OR
     to_regprocedure('public.complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb)') IS NULL OR
     to_regprocedure('public.fail_prescription_analysis_job_v1(uuid,uuid,text,bigint,text,boolean,text,timestamptz)') IS NULL OR
     to_regprocedure('public.recover_expired_prescription_analysis_jobs_v1(integer)') IS NULL THEN
    RAISE EXCEPTION 'scoped worker prerequisites not met';
  END IF;
  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = 'meddecode_scoped_worker';
  IF r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit OR
     pg_has_role('meddecode_scoped_worker','meddecode_worker','MEMBER') OR
     pg_has_role('authenticated','meddecode_scoped_worker','MEMBER') OR
     pg_has_role('anon','meddecode_scoped_worker','MEMBER') OR
     has_function_privilege('meddecode_scoped_worker','public.claim_next_prescription_analysis_job_v1(text,integer)','EXECUTE') OR
     has_function_privilege('meddecode_scoped_worker','public.heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer)','EXECUTE') OR
     has_function_privilege('meddecode_scoped_worker','public.complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb)','EXECUTE') OR
     has_function_privilege('meddecode_scoped_worker','public.fail_prescription_analysis_job_v1(uuid,uuid,text,bigint,text,boolean,text,timestamptz)','EXECUTE') OR
     has_function_privilege('meddecode_scoped_worker','public.recover_expired_prescription_analysis_jobs_v1(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'scoped worker role is not restricted';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
      WHERE n.nspname='public' AND c.relname IN ('users','prescriptions','ai_jobs','prescription_intelligence_results','prescription_medicines','prescription_medicine_alternatives','prescription_recommendations','prescription_warnings')
        AND has_table_privilege('meddecode_scoped_worker',c.oid,p.priv)) OR
     EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(priv)
      WHERE n.nspname='public' AND c.relname IN ('users','prescriptions','ai_jobs','prescription_intelligence_results','prescription_medicines','prescription_medicine_alternatives','prescription_recommendations','prescription_warnings')
        AND has_any_column_privilege('meddecode_scoped_worker',c.oid,p.priv)) THEN
    RAISE EXCEPTION 'scoped worker has direct application table privileges';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'meddecode_scoped_%prescription_analysis_job%') THEN
    RAISE EXCEPTION 'scoped worker functions already exist';
  END IF;
END $check$;
SELECT 'SCOPED_WORKER_PREFLIGHT_OK';
ROLLBACK;
