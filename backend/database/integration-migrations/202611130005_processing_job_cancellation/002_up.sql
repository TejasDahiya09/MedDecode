\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.ai_jobs'::regclass
      AND conname='ai_jobs_status_check' AND contype='c') IS DISTINCT FROM
     'CHECK ((status = ANY (ARRAY[''queued''::text, ''processing''::text, ''completed''::text, ''failed''::text])))'
     OR has_column_privilege('authenticated','public.ai_jobs','status','UPDATE')
     OR has_column_privilege('anon','public.ai_jobs','status','UPDATE')
     OR to_regclass('public.prescription_job_cancellations') IS NOT NULL
     OR to_regprocedure('public.cancel_prescription_analysis_job_v1(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected cancellation deployment state';
  END IF;
END
$guard$;
ALTER TABLE public.ai_jobs DROP CONSTRAINT ai_jobs_status_check;
ALTER TABLE public.ai_jobs ADD CONSTRAINT ai_jobs_status_check
  CHECK (status IN ('queued','processing','completed','failed','cancelled'));
CREATE TABLE public.prescription_job_cancellations (
  job_id uuid PRIMARY KEY REFERENCES public.ai_jobs(id),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id),
  cancelled_by uuid NOT NULL,
  cancelled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text NOT NULL CHECK (reason='owner_requested')
);
ALTER TABLE public.prescription_job_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prescription_job_cancellations FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.cancel_prescription_analysis_job_v1(p_prescription_id uuid,p_job_id uuid)
RETURNS TABLE (job_id uuid,prescription_id uuid,job_status text,cancelled_at timestamptz,already_cancelled boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_job public.ai_jobs%ROWTYPE;
  v_prescription public.prescriptions%ROWTYPE;
  v_cancelled_at timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION USING ERRCODE='28000', MESSAGE='authentication required'; END IF;
  IF p_prescription_id IS NULL OR p_job_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid cancellation request'; END IF;
  -- Lock in the same order as the claim RPC.
  SELECT j.* INTO v_job FROM public.ai_jobs j WHERE j.id=p_job_id AND j.prescription_id=p_prescription_id
    AND j.user_id=v_user AND j.job_type='prescription_analysis' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='job not found'; END IF;
  SELECT p.* INTO v_prescription FROM public.prescriptions p
    WHERE p.id=p_prescription_id AND p.user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='job not found'; END IF;
  IF v_job.status='cancelled' THEN
    SELECT c.cancelled_at INTO v_cancelled_at FROM public.prescription_job_cancellations c
      WHERE c.job_id=p_job_id AND c.prescription_id=p_prescription_id AND c.cancelled_by=v_user;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='cancellation evidence unavailable'; END IF;
    RETURN QUERY SELECT p_job_id,p_prescription_id,'cancelled'::text,v_cancelled_at,true;
    RETURN;
  END IF;
  IF v_job.status<>'queued' OR v_job.completed_at IS NOT NULL OR v_prescription.status<>'queued'
     OR EXISTS (SELECT 1 FROM public.prescription_intelligence_results r WHERE r.prescription_id=p_prescription_id) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='job cannot be cancelled';
  END IF;
  v_cancelled_at := clock_timestamp();
  UPDATE public.ai_jobs j SET status='cancelled',completed_at=v_cancelled_at WHERE j.id=p_job_id;
  UPDATE public.prescriptions p SET status='uploaded' WHERE p.id=p_prescription_id;
  INSERT INTO public.prescription_job_cancellations(job_id,prescription_id,cancelled_by,cancelled_at,reason)
    VALUES(p_job_id,p_prescription_id,v_user,v_cancelled_at,'owner_requested');
  RETURN QUERY SELECT p_job_id,p_prescription_id,'cancelled'::text,v_cancelled_at,false;
END
$function$;
ALTER FUNCTION public.cancel_prescription_analysis_job_v1(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_prescription_analysis_job_v1(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_prescription_analysis_job_v1(uuid,uuid) TO authenticated;
COMMIT;
