\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

DO $verify$
DECLARE object_name text;
DECLARE function_name text;
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres'
     OR session_user IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres'
     OR current_setting('transaction_read_only') IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'current object privilege verification identity failure';
  END IF;
  FOREACH object_name IN ARRAY ARRAY[
    'active_ingredients','ai_jobs','analytics_events','audit_logs','family_members',
    'health_profiles','manufacturers','medicine_aliases','medicine_cabinet',
    'medicine_contract_identifiers','medicine_contraindications','medicine_ingredients',
    'medicine_interactions','medicine_precautions','medicine_prices',
    'medicine_side_effects','medicine_similarities','medicine_sources','medicines',
    'notifications','prescription_intelligence_results',
    'prescription_medicine_alternatives','prescription_medicines',
    'prescription_recommendations','prescription_warnings','prescriptions','users'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY[
        'anon','authenticated','meddecode_scoped_worker','meddecode_worker'
      ]) AS r(role_name)
      WHERE has_table_privilege(r.role_name,format('public.%I',object_name),'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    ) OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
      WHERE n.nspname='public' AND c.relname=object_name AND a.grantee=0
        AND a.privilege_type=ANY(ARRAY['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'])
    ) THEN RAISE EXCEPTION 'excessive table privilege remains on public.%',object_name; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=object_name
        AND c.relowner='postgres'::regrole AND c.relrowsecurity
    ) THEN RAISE EXCEPTION 'table public.% owner/RLS changed',object_name; END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(privilege_name)
      WHERE NOT has_table_privilege('service_role',format('public.%I',object_name),p.privilege_name)
    ) THEN RAISE EXCEPTION 'service_role privilege changed on public.%',object_name; END IF;
  END LOOP;

  FOREACH object_name IN ARRAY ARRAY[
    'active_ingredients','analytics_events','audit_logs','family_members',
    'health_profiles','manufacturers','medicine_aliases','medicine_cabinet',
    'medicine_contract_identifiers','medicine_contraindications','medicine_ingredients',
    'medicine_interactions','medicine_precautions','medicine_prices',
    'medicine_side_effects','medicine_similarities','medicine_sources','medicines',
    'notifications','prescription_intelligence_results',
    'prescription_medicine_alternatives','prescription_medicines',
    'prescription_recommendations','prescription_warnings','prescriptions','users'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p(privilege_name)
      WHERE NOT has_table_privilege('anon',format('public.%I',object_name),p.privilege_name)
         OR NOT has_table_privilege('authenticated',format('public.%I',object_name),p.privilege_name)
    ) THEN
      RAISE EXCEPTION 'reviewed CRUD grant changed on public.%',object_name;
    END IF;
  END LOOP;
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

  FOREACH function_name IN ARRAY ARRAY[
    'handle_new_user','set_updated_at','update_updated_at_column',
    'validate_cabinet_family_member'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY['anon','authenticated','meddecode_scoped_worker','meddecode_worker']) AS r(role_name)
      WHERE has_function_privilege(r.role_name,format('public.%I()',function_name),'EXECUTE')
    ) OR EXISTS (
      SELECT 1 FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=to_regprocedure(format('public.%I()',function_name))
        AND a.grantee=0 AND a.privilege_type='EXECUTE'
    ) THEN RAISE EXCEPTION 'unintended EXECUTE remains on public.%()',function_name; END IF;
    IF NOT has_function_privilege('service_role',format('public.%I()',function_name),'EXECUTE') THEN
      RAISE EXCEPTION 'service_role function execution changed on public.%()',function_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid='public.handle_new_user()'::regprocedure
      AND p.proowner='postgres'::regrole AND p.prorettype='trigger'::regtype
      AND p.prosecdef AND 'search_path=public'=ANY(COALESCE(p.proconfig,ARRAY[]::text[]))
  ) THEN RAISE EXCEPTION 'handle_new_user security configuration changed'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'public.set_updated_at()','public.update_updated_at_column()',
      'public.validate_cabinet_family_member()'
    ]) f(signature)
    JOIN pg_proc p ON p.oid=to_regprocedure(f.signature)
    WHERE p.proowner IS DISTINCT FROM 'postgres'::regrole
       OR p.prorettype IS DISTINCT FROM 'trigger'::regtype
       OR p.prosecdef
  ) THEN RAISE EXCEPTION 'helper function security configuration changed'; END IF;
END
$verify$;

SELECT 'CURRENT_OBJECT_PRIVILEGE_HARDENING_VERIFY_OK' AS marker;
ROLLBACK;
