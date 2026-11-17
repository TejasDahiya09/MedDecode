-- STATUS: BLOCKED. This is not an executable Cabinet seed.
--
-- The repository's local schema reference defines
-- medicine_cabinet.medicine_id -> public.medicines(id). Official catalogue
-- formulation IDs are a separate namespace, and no verified mapping or eight
-- eligible public.medicines IDs are available in the local source records.
-- The deployed schema, target profile, existing Cabinet rows, and catalogue
-- records have not been queried. No INSERT, UPDATE, or DELETE is included.
--
-- Required before a reviewed seed can be prepared:
--   1. Read-only confirmation of the deployed schema and target profile.
--   2. Eight verified public.medicines IDs with required source/identity data.
--   3. A confirmed duplicate policy and a pre-seed aggregate baseline.
--
-- Target supplied by the user: 9a1b7896-34cd-439b-9cfd-b26411086786
-- Intended marker (not inserted): [MEDDECODE_DEMO_SEED:wyripeqruhvbksjfsvlr:20261116]

DO $blocked$
BEGIN
  RAISE EXCEPTION
    'BLOCKED: no Cabinet seed was generated; do not treat this file as an insert script.';
END;
$blocked$;
