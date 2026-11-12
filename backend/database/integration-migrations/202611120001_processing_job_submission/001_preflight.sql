\set ON_ERROR_STOP on

DO $preflight$
DECLARE
  v_duplicate_active bigint;
  v_bad_owner bigint;
  v_result_without_job bigint;
BEGIN
  IF to_regclass('public.prescriptions') IS NULL
     OR to_regclass('public.ai_jobs') IS NULL
     OR to_regclass('public.prescription_intelligence_results') IS NULL THEN
    RAISE EXCEPTION 'required MedDecode tables are missing';
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is unavailable';
  END IF;

  IF to_regrole('authenticated') IS NULL OR to_regrole('anon') IS NULL
     OR to_regrole('postgres') IS NULL THEN
    RAISE EXCEPTION 'required Supabase-compatible roles are missing';
  END IF;

  SELECT count(*) INTO v_duplicate_active
  FROM (
    SELECT prescription_id, job_type
    FROM public.ai_jobs
    WHERE prescription_id IS NOT NULL
      AND job_type = 'prescription_analysis'
      AND status IN ('queued', 'processing')
    GROUP BY prescription_id, job_type
    HAVING count(*) > 1
  ) AS duplicates;

  SELECT count(*) INTO v_bad_owner
  FROM public.ai_jobs AS j
  JOIN public.prescriptions AS p ON p.id = j.prescription_id
  WHERE j.prescription_id IS NOT NULL
    AND j.user_id IS DISTINCT FROM p.user_id;

  SELECT count(*) INTO v_result_without_job
  FROM public.prescription_intelligence_results AS r
  LEFT JOIN public.ai_jobs AS j ON j.id = r.job_id
  WHERE r.job_id IS NOT NULL
    AND (j.id IS NULL OR j.prescription_id IS DISTINCT FROM r.prescription_id);

  IF v_duplicate_active <> 0 OR v_bad_owner <> 0 OR v_result_without_job <> 0 THEN
    RAISE EXCEPTION
      'incompatible historical rows: duplicate_active=%, bad_owner=%, bad_result_lineage=%',
      v_duplicate_active, v_bad_owner, v_result_without_job;
  END IF;
END
$preflight$;
