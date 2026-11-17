-- Review-only rollback. Requires separate hosted approval and owner role access.
-- Disable frontend browse first. Do not remove existing search/detail functions.
BEGIN;
GRANT meddecode_catalogue_rpc_owner TO CURRENT_USER WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER;
SET LOCAL ROLE meddecode_catalogue_rpc_owner;
DROP FUNCTION public.meddecode_official_catalogue_browse_v2(integer,integer,text);
RESET ROLE;
REVOKE meddecode_catalogue_rpc_owner FROM CURRENT_USER GRANTED BY CURRENT_USER;
COMMIT;
