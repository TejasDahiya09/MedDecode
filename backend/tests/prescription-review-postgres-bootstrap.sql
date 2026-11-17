\set ON_ERROR_STOP on

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.prescriptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'uploaded'
);
CREATE TABLE public.ai_jobs (
  id uuid PRIMARY KEY,
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'queued'
);
CREATE TABLE public.prescription_intelligence_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id),
  job_id uuid NOT NULL REFERENCES public.ai_jobs(id),
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.meddecode_scoped_worker_scope (
  job_id uuid PRIMARY KEY REFERENCES public.ai_jobs(id),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  worker_login name NOT NULL,
  worker_instance_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL
);

GRANT USAGE ON SCHEMA public,auth TO authenticated,meddecode_scoped_worker;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT authenticated TO postgres WITH SET TRUE, INHERIT FALSE;
