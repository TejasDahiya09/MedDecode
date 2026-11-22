\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

DO $preflight$
DECLARE
  object_name text;
  function_name text;
  privilege_name text;
  affected_tables constant text[] := ARRAY[
    'active_ingredients','ai_jobs','analytics_events','audit_logs','family_members',
    'health_profiles','manufacturers','medicine_aliases','medicine_cabinet',
    'medicine_contract_identifiers','medicine_contraindications','medicine_ingredients',
    'medicine_interactions','medicine_precautions','medicine_prices',
    'medicine_side_effects','medicine_similarities','medicine_sources','medicines',
    'notifications','prescription_intelligence_results',
    'prescription_medicine_alternatives','prescription_medicines',
    'prescription_recommendations','prescription_warnings','prescriptions','users'
  ];
  affected_functions constant text[] := ARRAY[
    'handle_new_user','set_updated_at','update_updated_at_column',
    'validate_cabinet_family_member'
  ];
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres'
     OR session_user IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres'
     OR current_setting('transaction_read_only') IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'current object privilege preflight identity failure';
  END IF;
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'PostgreSQL 17 or newer is required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'anon','authenticated','service_role','meddecode_scoped_worker','meddecode_worker'
    ]) AS required(role_name)
    WHERE to_regrole(required.role_name) IS NULL
  ) THEN RAISE EXCEPTION 'required role is missing'; END IF;

  FOREACH object_name IN ARRAY affected_tables LOOP
    IF to_regclass(format('public.%I',object_name)) IS NULL THEN
      RAISE EXCEPTION 'required table public.% is missing',object_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=object_name AND c.relkind IN ('r','p')
        AND c.relowner='postgres'::regrole AND c.relrowsecurity
    ) THEN RAISE EXCEPTION 'table public.% owner/RLS precondition failed',object_name; END IF;
    FOREACH privilege_name IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF NOT has_table_privilege('anon',format('public.%I',object_name),privilege_name)
         OR NOT has_table_privilege('authenticated',format('public.%I',object_name),privilege_name) THEN
        RAISE EXCEPTION 'table public.% lacks reviewed % privilege',object_name,privilege_name;
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
      WHERE n.nspname='public' AND c.relname=object_name AND a.grantee=0
    ) THEN
      RAISE EXCEPTION 'unexpected PUBLIC table privilege on public.%',object_name;
    END IF;
    IF has_table_privilege('meddecode_scoped_worker',format('public.%I',object_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       OR has_table_privilege('meddecode_worker',format('public.%I',object_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
      RAISE EXCEPTION 'unexpected worker table privilege on public.%',object_name;
    END IF;
    IF object_name='ai_jobs' THEN
      IF NOT has_table_privilege('anon','public.ai_jobs','SELECT')
         OR NOT has_table_privilege('anon','public.ai_jobs','INSERT')
         OR NOT has_table_privilege('anon','public.ai_jobs','DELETE')
         OR has_table_privilege('anon','public.ai_jobs','UPDATE')
         OR NOT has_table_privilege('authenticated','public.ai_jobs','SELECT')
         OR NOT has_table_privilege('authenticated','public.ai_jobs','DELETE')
         OR has_table_privilege('authenticated','public.ai_jobs','INSERT')
         OR has_table_privilege('authenticated','public.ai_jobs','UPDATE') THEN
        RAISE EXCEPTION 'reviewed ai_jobs CRUD matrix changed';
      END IF;
    ELSIF EXISTS (
      SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p(privilege_name)
      WHERE NOT has_table_privilege('anon',format('public.%I',object_name),p.privilege_name)
         OR NOT has_table_privilege('authenticated',format('public.%I',object_name),p.privilege_name)
    ) THEN
      RAISE EXCEPTION 'reviewed CRUD matrix changed on public.%',object_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(privilege_name)
      WHERE NOT has_table_privilege('service_role',format('public.%I',object_name),p.privilege_name)
    ) THEN
      RAISE EXCEPTION 'service_role privilege precondition failed on public.%',object_name;
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY affected_functions LOOP
    IF to_regprocedure(format('public.%I()',function_name)) IS NULL THEN
      RAISE EXCEPTION 'required function public.%() is missing',function_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=function_name AND p.pronargs=0
        AND p.proowner='postgres'::regrole AND p.prorettype='trigger'::regtype
    ) THEN RAISE EXCEPTION 'function public.%() owner/signature precondition failed',function_name; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=to_regprocedure(format('public.%I()',function_name))
        AND a.grantee=0 AND a.privilege_type='EXECUTE'
    ) THEN RAISE EXCEPTION 'function public.%() no longer has reviewed PUBLIC EXECUTE',function_name; END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid='public.handle_new_user()'::regprocedure
      AND p.prosecdef AND 'search_path=public'=ANY(COALESCE(p.proconfig,ARRAY[]::text[]))
  ) THEN RAISE EXCEPTION 'handle_new_user security configuration drift'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'public.set_updated_at()','public.update_updated_at_column()',
      'public.validate_cabinet_family_member()'
    ]) AS f(signature)
    JOIN pg_proc p ON p.oid=to_regprocedure(f.signature)
    WHERE p.prosecdef
  ) THEN RAISE EXCEPTION 'unexpected SECURITY DEFINER helper function'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(affected_functions) f(function_name)
    WHERE NOT has_function_privilege('service_role',format('public.%I()',f.function_name),'EXECUTE')
  ) THEN RAISE EXCEPTION 'service_role function execution precondition failed'; END IF;
END
$preflight$;

SELECT 'CURRENT_OBJECT_PRIVILEGE_HARDENING_PREFLIGHT_OK' AS marker;
ROLLBACK;
