-- Synthetic-only fixture for Migration 010. Run only in a disposable local DB.
\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE public.users(id uuid PRIMARY KEY);
CREATE TABLE public.prescriptions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id),status text NOT NULL);
CREATE TABLE public.ai_jobs(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id),prescription_id uuid NOT NULL REFERENCES public.prescriptions(id),job_type text NOT NULL,status text NOT NULL,attempt_count integer NOT NULL DEFAULT 0,lease_owner text,claim_generation bigint NOT NULL DEFAULT 0,lease_expires_at timestamptz,completed_at timestamptz,available_at timestamptz,heartbeat_at timestamptz,input_reference jsonb,result_reference jsonb);
CREATE TABLE public.meddecode_auto_worker_policy(singleton boolean PRIMARY KEY CHECK(singleton),enabled boolean NOT NULL,current_rollout_generation integer NOT NULL,worker_login name NOT NULL,worker_instance_id text NOT NULL);
CREATE TABLE public.meddecode_auto_authorized_jobs(job_id uuid PRIMARY KEY REFERENCES public.ai_jobs(id),prescription_id uuid NOT NULL,user_id uuid NOT NULL,rollout_generation integer NOT NULL);
CREATE TABLE public.meddecode_scoped_worker_scope(job_id uuid PRIMARY KEY REFERENCES public.ai_jobs(id),prescription_id uuid NOT NULL,user_id uuid NOT NULL,worker_login name NOT NULL,worker_instance_id text NOT NULL,enabled boolean NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE public.prescription_ocr_evidence_sets(id uuid PRIMARY KEY,prescription_id uuid NOT NULL,user_id uuid NOT NULL,schema_version text NOT NULL,document_sha256 text,page_count integer,provider_count integer NOT NULL,evidence_payload jsonb NOT NULL);
CREATE TABLE public.prescription_review_revisions(id uuid PRIMARY KEY,prescription_id uuid NOT NULL,user_id uuid NOT NULL,evidence_set_id uuid NOT NULL,revision_number integer NOT NULL,status text NOT NULL,lock_version bigint NOT NULL,review_schema_version text NOT NULL,review_json jsonb NOT NULL,is_current boolean NOT NULL);
CREATE TABLE public.prescription_intelligence_results(id uuid PRIMARY KEY,prescription_id uuid NOT NULL);
CREATE FUNCTION public.meddecode_review_write_medicines_v1(uuid,uuid,jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$SELECT$$;
CREATE FUNCTION public.meddecode_review_append_event_v1(uuid,uuid,uuid,jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$SELECT$$;
CREATE FUNCTION public.meddecode_scoped_authorize_next_v3_job_v1(text) RETURNS TABLE(authorized boolean) LANGUAGE sql SECURITY DEFINER AS $$SELECT false$$;
CREATE FUNCTION public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$SELECT '{}'::jsonb$$;
INSERT INTO public.users VALUES ('10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
INSERT INTO public.prescriptions VALUES ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','processing'),('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','queued');
INSERT INTO public.meddecode_auto_worker_policy VALUES(true,false,2,'meddecode_auto_worker_login','meddecode-auto-worker-001');
INSERT INTO public.ai_jobs VALUES ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','prescription_analysis','processing',1,'meddecode-auto-worker-001',7,clock_timestamp()+interval '5 minutes',NULL,NULL,clock_timestamp(),'{}'::jsonb,NULL),('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','prescription_analysis','queued',0,NULL,0,NULL,NULL,NULL,NULL,'{}'::jsonb,NULL);
INSERT INTO public.meddecode_auto_authorized_jobs VALUES ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',2);
INSERT INTO public.meddecode_scoped_worker_scope VALUES ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','meddecode_auto_worker_login','meddecode-auto-worker-001',false,clock_timestamp()+interval '5 minutes');
