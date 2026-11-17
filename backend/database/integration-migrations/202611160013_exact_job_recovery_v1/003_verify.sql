\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='2s';
DO $verify$
DECLARE item record; role_name text; privilege_name text; relation oid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid=to_regclass('public.meddecode_exact_job_retry_permits') AND r.rolname='postgres' AND c.relrowsecurity)
 THEN RAISE EXCEPTION 'retry audit table protection invalid'; END IF;
 FOR item IN SELECT * FROM (VALUES
('meddecode_authorize_exact_job_retry_v1','59a4591b8106212f5b6ad249017a927ce506b68fc237690c979b907c964cdf55'),
('meddecode_recover_claim_exact_job_v1','23509640fb3e38af35fa8798c29dbd80578b8bbfa17a31ddd3ef33c4177132a1'),
('meddecode_initialize_retry_review_core_v1','64a180563d00dfd5373756dbc33b2c359583738a8361521914badef034050930'),
('meddecode_initialize_prescription_review_v1','21606cce69d469be85795ae4b520512618ff3c9af9ccf5b2fc8ff614a09add0a'),
('meddecode_scoped_claim_next_prescription_analysis_job_v1','04d2a9900c049ad5ec5538e997e618915f77d903772c12ec1fc4d18bdf3ff06e'),
('meddecode_scoped_recover_expired_prescription_analysis_jobs_v1','119619c13fd1708bacc49a5b6bbc876778b3c4fdbc1d3c2325738728107df6a8'),
('meddecode_scoped_authorize_next_automatic_job_v1','cebad947ab75f92bf0c48ff095d91018c5a3c80fc06d2c86c87695bc50d61be2'),
('meddecode_initialize_exact_retry_review_v1','3fa632427304adc1cda29529d14769f2445ff5d1f3cb7321b705c9ec69c95fc3')
 ) AS expected(name,hash) LOOP
   IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=item.name)<>1
   OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND p.proname=item.name AND r.rolname='postgres' AND p.prosecdef AND
     (p.proconfig @> ARRAY['search_path=pg_catalog, public'] OR p.proconfig @> ARRAY['search_path=""']) AND encode(sha256(convert_to(replace(p.prosrc,E'\r',''),'UTF8')),'hex')=item.hash)
   THEN RAISE EXCEPTION 'retry function definition invalid: %',item.name; END IF;
 END LOOP;
 relation:='public.meddecode_exact_job_retry_permits'::regclass;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=relation AND a.grantee=0)
 OR EXISTS(SELECT 1 FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a WHERE c.attrelid=relation AND a.grantee=0)
 OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=relation AND a.grantee<>c.relowner)
 THEN RAISE EXCEPTION 'public retry table grant'; END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','meddecode_worker','meddecode_scoped_worker','meddecode_auto_worker_login'] LOOP
   FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
     IF has_table_privilege(role_name,relation,privilege_name) OR (privilege_name IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege(role_name,relation,privilege_name))
     THEN RAISE EXCEPTION 'retry direct table privilege invalid'; END IF;
   END LOOP;
   IF has_function_privilege(role_name,'public.meddecode_authorize_exact_job_retry_v1(uuid,uuid,integer,bigint)','EXECUTE')
   OR has_function_privilege(role_name,'public.meddecode_initialize_retry_review_core_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
   OR has_function_privilege(role_name,'public.meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer)','EXECUTE') IS DISTINCT FROM (role_name IN ('meddecode_scoped_worker'))
   OR has_function_privilege(role_name,'public.meddecode_initialize_exact_retry_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,integer,bigint,uuid)','EXECUTE') IS DISTINCT FROM (role_name IN ('meddecode_scoped_worker'))
   THEN RAISE EXCEPTION 'retry execute privileges invalid: %',role_name; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE n.nspname='public' AND p.proname IN ('meddecode_authorize_exact_job_retry_v1','meddecode_initialize_retry_review_core_v1','meddecode_recover_claim_exact_job_v1','meddecode_initialize_exact_retry_review_v1') AND a.grantee=0)
 THEN RAISE EXCEPTION 'public retry execute grant'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE n.nspname='public' AND p.proname IN ('meddecode_authorize_exact_job_retry_v1','meddecode_initialize_retry_review_core_v1','meddecode_recover_claim_exact_job_v1','meddecode_initialize_exact_retry_review_v1') AND a.grantee<>p.proowner
 AND NOT (p.proname IN ('meddecode_recover_claim_exact_job_v1','meddecode_initialize_exact_retry_review_v1') AND a.grantee='meddecode_scoped_worker'::regrole))
 THEN RAISE EXCEPTION 'unexpected retry execute grant'; END IF;
END $verify$;
SELECT 'EXACT_JOB_RETRY_VERIFY_OK';
ROLLBACK;
