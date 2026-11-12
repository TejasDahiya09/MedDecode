\set ON_ERROR_STOP on
DO $verify$
DECLARE
  v_count integer;
  v_probe_count integer;
  v_distinct_backends integer;
  v_overlap boolean;
  v_distinct_job_ids integer;
  v_created_count integer;
  v_reused_count integer;
  v_persisted_job_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.ai_jobs
  WHERE prescription_id = '70000000-0000-4000-8000-000000000007'
    AND job_type = 'prescription_analysis'
    AND status IN ('queued', 'processing');

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected one active job after concurrent submission, found %', v_count;
  END IF;

  SELECT
    count(*),
    count(DISTINCT backend_pid)
  INTO v_probe_count, v_distinct_backends
  FROM public.processing_job_concurrency_probe
  WHERE finished_at IS NOT NULL;

  SELECT EXISTS (
    SELECT 1
    FROM public.processing_job_concurrency_probe AS first_session
    JOIN public.processing_job_concurrency_probe AS second_session
      ON first_session.session_id < second_session.session_id
     AND first_session.started_at < second_session.finished_at
     AND second_session.started_at < first_session.finished_at
  ) INTO v_overlap;

  IF v_probe_count <> 2 OR v_distinct_backends <> 2 OR NOT v_overlap THEN
    RAISE EXCEPTION
      'concurrency probe did not demonstrate two overlapping PostgreSQL sessions';
  END IF;

  SELECT
    count(DISTINCT job_id),
    count(*) FILTER (WHERE created),
    count(*) FILTER (WHERE NOT created)
  INTO v_distinct_job_ids, v_created_count, v_reused_count
  FROM public.processing_job_concurrency_probe
  WHERE finished_at IS NOT NULL;

  IF v_distinct_job_ids <> 1 OR v_created_count <> 1 OR v_reused_count <> 1 THEN
    RAISE EXCEPTION
      'concurrent submissions must return one shared job ID with one created and one reused result';
  END IF;

  SELECT count(*) INTO v_persisted_job_count
  FROM public.ai_jobs AS job
  JOIN public.processing_job_concurrency_probe AS probe ON probe.job_id = job.id
  WHERE probe.finished_at IS NOT NULL
    AND job.prescription_id = '70000000-0000-4000-8000-000000000007'
    AND job.job_type = 'prescription_analysis'
    AND job.status IN ('queued', 'processing');

  IF v_persisted_job_count <> 2 THEN
    RAISE EXCEPTION 'concurrent result job ID does not match the single persisted active job';
  END IF;
END
$verify$;
