\set ON_ERROR_STOP on
DO $verify$ BEGIN
 IF (SELECT count(*) FROM public.prescription_intelligence_results WHERE prescription_id='82000000-0000-4000-8000-000000000001')<>2 THEN RAISE EXCEPTION 'history missing'; END IF;
 IF (SELECT count(*) FROM public.prescription_intelligence_results WHERE prescription_id='82000000-0000-4000-8000-000000000001' AND is_current)<>1 THEN RAISE EXCEPTION 'current count invalid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.prescription_intelligence_results WHERE job_id='83000000-0000-4000-8000-000000000002' AND is_current) THEN RAISE EXCEPTION 'revision 2 not current'; END IF;
 IF EXISTS(SELECT 1 FROM public.prescription_intelligence_results WHERE job_id='83000000-0000-4000-8000-000000000001' AND is_current) THEN RAISE EXCEPTION 'revision 1 still current'; END IF;
END $verify$;
SELECT 'PRESCRIPTION_RESULT_HISTORY_FUNCTIONAL_OK' AS marker;
