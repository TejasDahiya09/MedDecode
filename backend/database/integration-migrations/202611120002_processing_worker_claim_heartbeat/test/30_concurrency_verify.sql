\set ON_ERROR_STOP on
DO $verify$
DECLARE
  v_sessions bigint; v_backends bigint; v_jobs bigint; v_overlap boolean;
BEGIN
  SELECT count(*), count(DISTINCT backend_pid), count(DISTINCT job_id)
  INTO v_sessions, v_backends, v_jobs
  FROM public.processing_job_concurrency_probe;
  SELECT EXISTS (
    SELECT 1 FROM public.processing_job_concurrency_probe a
    JOIN public.processing_job_concurrency_probe b ON a.session_id < b.session_id
    WHERE a.started_at < b.finished_at AND b.started_at < a.finished_at
  ) INTO v_overlap;
  IF v_sessions <> 2 OR v_backends <> 2 OR v_overlap IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'concurrency test did not demonstrate two overlapping sessions';
  END IF;
  IF v_jobs <> 1 THEN
    RAISE EXCEPTION 'concurrent workers did not claim exactly one durable job';
  END IF;
  IF (SELECT count(*) FROM public.processing_job_concurrency_probe WHERE created) <> 1 THEN
    RAISE EXCEPTION 'concurrent workers did not produce exactly one successful claim';
  END IF;
  IF (SELECT count(*) FROM public.ai_jobs WHERE status = 'processing') <> 1 THEN
    RAISE EXCEPTION 'unexpected processing job count';
  END IF;
END
$verify$;
