\set ON_ERROR_STOP on
-- Proposed separately approved hosted privilege change. This file is not
-- part of the cancellation migration until independently reviewed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=to_regclass('public.ai_jobs'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname='public' AND tablename='ai_jobs' AND cmd IN ('UPDATE','ALL'))
     OR NOT has_table_privilege('authenticated','public.ai_jobs','UPDATE')
     OR NOT has_table_privilege('anon','public.ai_jobs','UPDATE') THEN
    RAISE EXCEPTION 'job update ACL or RLS policy state differs from reviewed baseline';
  END IF;
END
$guard$;
REVOKE UPDATE ON TABLE public.ai_jobs FROM anon, authenticated;
DO $verify$
BEGIN
  IF has_column_privilege('authenticated','public.ai_jobs','status','UPDATE')
     OR has_column_privilege('anon','public.ai_jobs','status','UPDATE') THEN
    RAISE EXCEPTION 'effective job status UPDATE remains; rollback for privilege review';
  END IF;
END
$verify$;
COMMIT;
