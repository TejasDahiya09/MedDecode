-- REVIEW ONLY. This rollback requires separate approval and must not be run as
-- part of normal migration verification.
BEGIN;
DROP FUNCTION public.meddecode_official_catalogue_page_v1(text, text, integer, integer);
COMMIT;
