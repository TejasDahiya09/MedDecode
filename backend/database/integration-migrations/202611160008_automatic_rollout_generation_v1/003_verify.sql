\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $verify$
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
 OR NOT EXISTS(SELECT FROM public.meddecode_auto_worker_policy WHERE singleton AND current_rollout_generation=2 AND NOT enabled AND activated_at IS NULL)
 OR (SELECT count(*) FROM public.meddecode_auto_rollout_generations)<>2
 OR NOT EXISTS(SELECT FROM public.meddecode_auto_rollout_generations WHERE generation=1)
 OR NOT EXISTS(SELECT FROM public.meddecode_auto_rollout_generations WHERE generation=2 AND activated_at IS NULL AND retired_at IS NULL)
 OR EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation<>1)
 OR NOT EXISTS(SELECT FROM pg_class WHERE oid='public.meddecode_auto_rollout_generations'::regclass AND relrowsecurity)
 OR has_table_privilege('anon','public.meddecode_auto_rollout_generations','SELECT')
 OR has_table_privilege('authenticated','public.meddecode_auto_rollout_generations','SELECT')
 THEN RAISE EXCEPTION 'automatic rollout generation security verification failed'; END IF;
END $verify$;
SELECT 'AUTOMATIC_ROLLOUT_GENERATION_VERIFY_OK';
ROLLBACK;
