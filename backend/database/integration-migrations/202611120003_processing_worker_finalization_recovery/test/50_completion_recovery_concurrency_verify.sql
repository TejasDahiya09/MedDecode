\set ON_ERROR_STOP on

DO $verify$
DECLARE v_sessions bigint; v_backends bigint; v_overlap boolean;
BEGIN
  SELECT count(*), count(DISTINCT backend_pid) INTO v_sessions, v_backends
  FROM public.processing_finalization_concurrency_probe;
  SELECT EXISTS (
    SELECT 1 FROM public.processing_finalization_concurrency_probe a
    JOIN public.processing_finalization_concurrency_probe b ON a.session_id < b.session_id
    WHERE a.started_at < b.finished_at AND b.started_at < a.finished_at
  ) INTO v_overlap;
  IF v_sessions <> 2 OR v_backends <> 2 OR v_overlap IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'completion/recovery test did not demonstrate two overlapping sessions';
  END IF;
  IF (SELECT count(*) FROM public.processing_finalization_concurrency_probe
      WHERE outcome IN ('recovered', 'stale_completion_rejected')) <> 2 THEN
    RAISE EXCEPTION 'completion/recovery session outcome is incomplete';
  END IF;
  IF (SELECT status FROM public.ai_jobs WHERE id = '73000000-0000-4000-8000-000000000001') <> 'queued'
     OR (SELECT claim_generation FROM public.ai_jobs WHERE id = '73000000-0000-4000-8000-000000000001') <> 8
     OR (SELECT lease_owner FROM public.ai_jobs WHERE id = '73000000-0000-4000-8000-000000000001') IS NOT NULL
     OR (SELECT status FROM public.prescriptions WHERE id = '83000000-0000-4000-8000-000000000001') <> 'queued'
     OR EXISTS (SELECT 1 FROM public.prescription_intelligence_results
                WHERE prescription_id = '83000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'completion/recovery fencing did not leave one consistent recovered outcome';
  END IF;
END
$verify$;
\echo PHASE7_COMPLETION_RECOVERY_CONCURRENCY_PASS
