-- STATUS: BLOCKED. No demo seed was run, so there are no Copilot-inserted IDs
-- or records eligible for cleanup. This file contains a read-only Cabinet
-- marker preview followed by an explicit stop; it contains no DELETE.
--
-- Target supplied by the user:
--   9a1b7896-34cd-439b-9cfd-b26411086786
-- Intended marker:
--   [MEDDECODE_DEMO_SEED:wyripeqruhvbksjfsvlr:20261116]
--
-- Do not remove any records based solely on a matching marker until the
-- corresponding seed operation and its exact inserted rows are independently
-- confirmed.

BEGIN TRANSACTION READ ONLY;

SELECT count(*) AS matching_demo_cabinet_rows
FROM public.medicine_cabinet
WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
  AND strpos(
    coalesce(usage_information, ''),
    '[MEDDECODE_DEMO_SEED:wyripeqruhvbksjfsvlr:20261116]'
  ) > 0;

ROLLBACK;

DO $blocked$
BEGIN
  RAISE EXCEPTION
    'BLOCKED: no demo seed was run; cleanup is not authorized by this draft.';
END;
$blocked$;
