\set ON_ERROR_STOP on
\if :{?test_database}
\else
\echo 'test_database is required'
\quit 3
\endif
SELECT current_database() = :'test_database' AS guard_matches
\gset
\if :guard_matches
\else
\echo 'synthetic auth fixture is restricted to the requested disposable database'
SELECT 1 / 0;
\endif
DO $target$
BEGIN
  IF to_regrole('authenticated') IS NULL OR to_regrole('anon') IS NULL THEN
    RAISE EXCEPTION 'expected local Supabase test roles are missing';
  END IF;
  IF to_regnamespace('auth') IS NOT NULL THEN
    RAISE EXCEPTION 'auth schema already exists; inspect the isolated target before continuing';
  END IF;
END
$target$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$function$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
-- The hosted migration cannot grant on Supabase-managed auth objects.
-- PUBLIC access here models an already-effective dependency without adding
-- any access to the official catalogue tables.
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
