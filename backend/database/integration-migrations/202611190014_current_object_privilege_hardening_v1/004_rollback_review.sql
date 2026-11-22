\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

-- Security rollback is intentionally not automated. Regranting TRUNCATE,
-- REFERENCES, TRIGGER, MAINTAIN, or PUBLIC function execution would recreate
-- the reviewed vulnerability. Fix any regression with a new forward-only,
-- object-specific CRUD/RPC grant after local verification.
SELECT current_database() AS database_name,
       session_user,
       current_user,
       'FORWARD_FIX_ONLY' AS rollback_policy;
SELECT 'CURRENT_OBJECT_PRIVILEGE_HARDENING_ROLLBACK_REVIEW_OK' AS marker;
ROLLBACK;
