\set ON_ERROR_STOP on
BEGIN;
UPDATE public.ai_jobs SET lease_expires_at=clock_timestamp()+interval '1 second'
WHERE id='78000000-0000-4000-8000-000000000001';
SELECT pg_advisory_lock(72003002);
SELECT pg_sleep(3);
COMMIT;
SELECT pg_advisory_unlock(72003002);
