\set ON_ERROR_STOP on
-- Review only. Never reinstate anonymous grants or defective owner checks.
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT 'No automatic downgrade: restore only independently reviewed prior ACL evidence, never the vulnerable baseline. Preserve all reminder data.' AS rollback_review;
ROLLBACK;
