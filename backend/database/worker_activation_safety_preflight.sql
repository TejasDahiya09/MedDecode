\set ON_ERROR_STOP on

-- Read-only worker safety gate. It intentionally reports only aggregate counts.
BEGIN READ ONLY;

DO $worker_safety$
DECLARE
  v_queued bigint;
  v_processing bigint;
BEGIN
  IF to_regclass('public.ai_jobs') IS NULL THEN
    RAISE EXCEPTION 'public.ai_jobs is missing';
  END IF;

  SELECT
    count(*) FILTER (WHERE status = 'queued'),
    count(*) FILTER (WHERE status = 'processing')
  INTO v_queued, v_processing
  FROM public.ai_jobs
  WHERE job_type = 'prescription_analysis';

  IF v_queued <> 0 OR v_processing <> 0 THEN
    RAISE EXCEPTION
      'worker safety gate blocked: queued=% processing=%; do not activate or start worker',
      v_queued, v_processing;
  END IF;

  RAISE NOTICE '[PASS] worker safety gate found no queued or processing jobs';
END
$worker_safety$;

COMMIT;
