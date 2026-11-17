-- READ ONLY; run independently after separately authorized provisioning.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $check$
DECLARE r text;
BEGIN
  IF current_database() <> 'postgres' OR session_user <> 'postgres'
     OR to_regrole('meddecode_scoped_worker') IS NULL OR to_regrole('meddecode_scoped_worker_login') IS NULL
     OR to_regclass('public.meddecode_scoped_worker_scope') IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected role deployment state';
  END IF;
  FOREACH r IN ARRAY ARRAY['meddecode_scoped_worker','meddecode_scoped_worker_login'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname=r AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls))
       OR pg_has_role(r,'meddecode_worker','MEMBER')
       OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
          WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND
           (has_table_privilege(r,c.oid,p.priv) OR (p.priv IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege(r,c.oid,p.priv))))
       OR has_function_privilege(r,'public.claim_next_prescription_analysis_job_v1(text,integer)','EXECUTE')
       OR has_function_privilege(r,'public.heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer)','EXECUTE')
       OR has_function_privilege(r,'public.complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb)','EXECUTE')
       OR has_function_privilege(r,'public.fail_prescription_analysis_job_v1(uuid,uuid,text,bigint,text,boolean,text,timestamptz)','EXECUTE')
       OR has_function_privilege(r,'public.recover_expired_prescription_analysis_jobs_v1(integer)','EXECUTE') THEN
      RAISE EXCEPTION 'unexpected scoped privilege';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='meddecode_scoped_worker' AND NOT rolcanlogin)
     OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname='meddecode_scoped_worker_login' AND rolcanlogin)
     OR NOT EXISTS (SELECT FROM pg_auth_members WHERE roleid='meddecode_scoped_worker'::regrole AND member='meddecode_scoped_worker_login'::regrole AND set_option AND NOT inherit_option AND NOT admin_option)
     OR EXISTS (SELECT FROM pg_auth_members m WHERE m.member IN ('meddecode_scoped_worker'::regrole,'meddecode_scoped_worker_login'::regrole)
       AND NOT (m.roleid='meddecode_scoped_worker'::regrole AND m.member='meddecode_scoped_worker_login'::regrole))
     OR EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
       WHERE r.rolname IN ('meddecode_scoped_worker','meddecode_scoped_worker_login')
       AND NOT ((member.rolname='postgres' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
         OR (r.rolname='meddecode_scoped_worker' AND member.rolname='meddecode_scoped_worker_login' AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option))) THEN
    RAISE EXCEPTION 'unexpected role membership';
  END IF;
END $check$;
SELECT 'SCOPED_ROLE_VERIFY_OK';
ROLLBACK;
