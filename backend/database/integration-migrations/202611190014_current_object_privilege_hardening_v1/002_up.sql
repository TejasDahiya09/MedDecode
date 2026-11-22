\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

DO $guard$
DECLARE object_name text;
DECLARE privilege_name text;
DECLARE function_name text;
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres'
     OR session_user IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'current object privilege deployment identity failure';
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
    IF to_regclass(format('public.%I',object_name)) IS NULL THEN
      RAISE EXCEPTION 'reviewed object public.% is missing',object_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=object_name AND c.relkind IN ('r','p')
        AND c.relowner='postgres'::regrole AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'table public.% owner/RLS precondition failed',object_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
      WHERE n.nspname='public' AND c.relname=object_name AND a.grantee=0
    ) THEN
      RAISE EXCEPTION 'unexpected PUBLIC table privilege on public.%',object_name;
    END IF;
    FOREACH privilege_name IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF NOT has_table_privilege('anon',format('public.%I',object_name),privilege_name)
         OR NOT has_table_privilege('authenticated',format('public.%I',object_name),privilege_name) THEN
        RAISE EXCEPTION 'reviewed privilege state changed for public.% privilege %',object_name,privilege_name;
      END IF;
    END LOOP;
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
    IF has_table_privilege('meddecode_scoped_worker',format('public.%I',object_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       OR has_table_privilege('meddecode_worker',format('public.%I',object_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
      RAISE EXCEPTION 'unexpected worker table privilege on public.%',object_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(privilege_name)
      WHERE NOT has_table_privilege('service_role',format('public.%I',object_name),p.privilege_name)
    ) THEN
      RAISE EXCEPTION 'service_role privilege precondition failed on public.%',object_name;
    END IF;
  END LOOP;
  FOREACH function_name IN ARRAY ARRAY[
    'handle_new_user','set_updated_at','update_updated_at_column',
    'validate_cabinet_family_member'
  ] LOOP
    IF to_regprocedure(format('public.%I()',function_name)) IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
         WHERE p.oid=to_regprocedure(format('public.%I()',function_name))
           AND p.proowner='postgres'::regrole AND p.prorettype='trigger'::regtype
           AND a.grantee=0 AND a.privilege_type='EXECUTE'
       ) THEN
      RAISE EXCEPTION 'reviewed function state changed for public.%()',function_name;
    END IF;
    IF NOT has_function_privilege('service_role',format('public.%I()',function_name),'EXECUTE') THEN
      RAISE EXCEPTION 'service_role function execution precondition failed for public.%()',function_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid='public.handle_new_user()'::regprocedure
      AND p.prosecdef AND 'search_path=public'=ANY(COALESCE(p.proconfig,ARRAY[]::text[]))
  ) THEN RAISE EXCEPTION 'handle_new_user security configuration drift'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'public.set_updated_at()','public.update_updated_at_column()',
      'public.validate_cabinet_family_member()'
    ]) f(signature)
    JOIN pg_proc p ON p.oid=to_regprocedure(f.signature)
    WHERE p.prosecdef
  ) THEN RAISE EXCEPTION 'unexpected SECURITY DEFINER helper function'; END IF;
END
$guard$;

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.active_ingredients, public.ai_jobs, public.analytics_events, public.audit_logs,
  public.family_members, public.health_profiles, public.manufacturers,
  public.medicine_aliases, public.medicine_cabinet,
  public.medicine_contract_identifiers, public.medicine_contraindications,
  public.medicine_ingredients, public.medicine_interactions,
  public.medicine_precautions, public.medicine_prices, public.medicine_side_effects,
  public.medicine_similarities, public.medicine_sources, public.medicines,
  public.notifications, public.prescription_intelligence_results,
  public.prescription_medicine_alternatives, public.prescription_medicines,
  public.prescription_recommendations, public.prescription_warnings,
  public.prescriptions, public.users
FROM PUBLIC, anon, authenticated, meddecode_scoped_worker, meddecode_worker;

REVOKE EXECUTE ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated, meddecode_scoped_worker, meddecode_worker;
REVOKE EXECUTE ON FUNCTION public.set_updated_at()
  FROM PUBLIC, anon, authenticated, meddecode_scoped_worker, meddecode_worker;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column()
  FROM PUBLIC, anon, authenticated, meddecode_scoped_worker, meddecode_worker;
REVOKE EXECUTE ON FUNCTION public.validate_cabinet_family_member()
  FROM PUBLIC, anon, authenticated, meddecode_scoped_worker, meddecode_worker;

COMMIT;
