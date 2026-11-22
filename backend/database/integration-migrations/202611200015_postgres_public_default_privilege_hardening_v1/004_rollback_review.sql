\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

-- Regranting broad future-object defaults is not an automatic rollback.
-- Any compatibility need must be expressed as a new forward migration with
-- object-class and role-specific grants.
SELECT current_database() AS database_name,session_user,current_user,
       'FORWARD_FIX_ONLY' AS rollback_policy;
SELECT 'POSTGRES_PUBLIC_DEFAULT_PRIVILEGE_ROLLBACK_REVIEW_OK' AS marker;
ROLLBACK;
