-- Synthetic-only V3 baseline and functional verification. The runner creates
-- an empty loopback database and replaces the migration's postgres guard.
\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.users(id uuid PRIMARY KEY);
CREATE TABLE public.prescriptions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id),status text NOT NULL DEFAULT 'queued');
CREATE TABLE public.ai_jobs(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id),prescription_id uuid NOT NULL REFERENCES public.prescriptions(id),job_type text NOT NULL,status text NOT NULL,attempt_count integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL DEFAULT 1,lease_owner text,lease_expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.meddecode_scoped_worker_scope(job_id uuid PRIMARY KEY REFERENCES public.ai_jobs(id),prescription_id uuid NOT NULL,user_id uuid NOT NULL,worker_login name NOT NULL,worker_instance_id text NOT NULL,enabled boolean NOT NULL DEFAULT true,expires_at timestamptz NOT NULL);
CREATE TABLE public.meddecode_auto_worker_policy(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,worker_login name NOT NULL,worker_instance_id text NOT NULL,scope_seconds integer NOT NULL DEFAULT 1200,activated_at timestamptz);
CREATE TABLE public.meddecode_auto_authorized_jobs(job_id uuid PRIMARY KEY REFERENCES public.ai_jobs(id),prescription_id uuid NOT NULL,user_id uuid NOT NULL,admitted_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.meddecode_auto_test_account(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),user_id uuid NOT NULL REFERENCES public.users(id));
CREATE TABLE public.prescription_review_revisions(id uuid PRIMARY KEY,prescription_id uuid NOT NULL,user_id uuid NOT NULL,processing_job_id uuid,status text,is_current boolean NOT NULL,input_fingerprint text,intelligence_state text);
ALTER TABLE public.meddecode_auto_worker_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meddecode_auto_authorized_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meddecode_auto_test_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meddecode_scoped_worker_scope ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated,meddecode_scoped_worker;
CREATE FUNCTION public.submit_prescription_analysis_job_v1(p_prescription_id uuid,p_requested_analysis jsonb) RETURNS TABLE(job_id uuid,prescription_id uuid,job_status text,created boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE u uuid:=auth.uid();
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION USING ERRCODE='28000'; END IF;
 SELECT id, user_id INTO job_id,prescription_id FROM public.ai_jobs WHERE id=p_prescription_id;
 IF FOUND THEN job_status:='queued'; created:=false; RETURN NEXT; RETURN; END IF;
 IF NOT EXISTS(SELECT FROM public.prescriptions WHERE id=p_prescription_id AND user_id=u) THEN RAISE EXCEPTION USING ERRCODE='42501'; END IF;
 INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status) VALUES(p_prescription_id,u,p_prescription_id,'prescription_analysis','queued');
 job_id:=p_prescription_id; prescription_id:=p_prescription_id; job_status:='queued'; created:=true; RETURN NEXT;
END $f$;
CREATE FUNCTION public.submit_automatic_prescription_analysis_job_v1(p_prescription_id uuid,p_requested_analysis jsonb) RETURNS TABLE(job_id uuid,prescription_id uuid,job_status text,created boolean) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT * FROM public.submit_prescription_analysis_job_v1(p_prescription_id,p_requested_analysis) $$;
CREATE FUNCTION public.meddecode_scoped_authorize_next_automatic_job_v1(text) RETURNS TABLE(authorized boolean) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT false $$;
CREATE FUNCTION public.meddecode_scoped_authorize_next_confirmed_review_job_v1(text) RETURNS TABLE(authorized boolean) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT false $$;
CREATE FUNCTION public.meddecode_scoped_authorize_next_v3_job_v1(text) RETURNS TABLE(authorized boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$ BEGIN RETURN QUERY SELECT false; END $f$;
CREATE FUNCTION public.meddecode_scoped_claim_next_prescription_analysis_job_v1(p_worker text,p_lease integer) RETURNS TABLE(job_id uuid,prescription_id uuid,claim_generation bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION USING ERRCODE='42501'; END IF;
 UPDATE public.ai_jobs j SET status='processing',lease_owner=p_worker,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease)
 WHERE j.id=(SELECT s.job_id FROM public.meddecode_scoped_worker_scope s WHERE s.enabled AND s.worker_login=session_user AND s.worker_instance_id=p_worker AND s.expires_at>clock_timestamp() AND EXISTS(SELECT FROM public.ai_jobs x WHERE x.id=s.job_id AND x.status='queued') ORDER BY s.job_id LIMIT 1) RETURNING j.id,j.prescription_id,1 INTO job_id,prescription_id,claim_generation;
 RETURN NEXT;
END $f$;
INSERT INTO public.users VALUES ('10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
INSERT INTO public.prescriptions(id,user_id) VALUES ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001'),('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001'),('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002');
INSERT INTO public.meddecode_auto_worker_policy(singleton,enabled,worker_login,worker_instance_id,activated_at) VALUES(true,true,'meddecode_auto_worker_login','meddecode-auto-worker-001',clock_timestamp()-interval '1 hour');
INSERT INTO public.meddecode_auto_test_account VALUES(true,'10000000-0000-4000-8000-000000000001');
INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status) VALUES ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','prescription_analysis','completed'),('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','prescription_analysis','queued');
INSERT INTO public.meddecode_auto_authorized_jobs(job_id,prescription_id,user_id) VALUES ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
