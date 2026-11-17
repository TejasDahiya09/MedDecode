-- STATUS: BLOCKED. This is not an executable Reminders seed.
--
-- Migration 009 exists locally, but its deployment and independent
-- verification against the target database are unknown. Do not insert
-- reminders until PUBLIC/anon privileges, authenticated grants, the corrected
-- Cabinet-owner predicate, the composite dose-log ownership FK, and all eight
-- expected RLS policies have been verified on the deployed database.
--
-- No reminder INSERT or dose-log INSERT is included.
-- Target supplied by the user: 9a1b7896-34cd-439b-9cfd-b26411086786
-- Intended marker (not inserted): [MEDDECODE_DEMO_SEED:wyripeqruhvbksjfsvlr:20261116]

DO $blocked$
BEGIN
  RAISE EXCEPTION
    'BLOCKED: reminder security deployment is unverified; no reminder seed is included.';
END;
$blocked$;
