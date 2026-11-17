\set ON_ERROR_STOP on
SELECT 1 / CASE WHEN
  (SELECT status='processing' FROM public.ai_jobs WHERE id='78000000-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.prescription_intelligence_results WHERE prescription_id='88000000-0000-4000-8000-000000000001')
  THEN 1 ELSE 0 END AS lock_wait_expiry_assertion;
