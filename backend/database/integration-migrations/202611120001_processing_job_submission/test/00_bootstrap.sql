\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
CREATE SCHEMA auth;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$roles$;

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.users (
  id uuid PRIMARY KEY
);

CREATE TABLE public.prescriptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id),
  storage_provider text NOT NULL DEFAULT 'aws_s3',
  storage_bucket text,
  object_key text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'queued', 'processing', 'completed',
                      'completed_with_warnings', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  prescription_id uuid REFERENCES public.prescriptions(id),
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  input_reference jsonb,
  result_reference jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE public.prescription_intelligence_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  prescription_id uuid NOT NULL UNIQUE REFERENCES public.prescriptions(id),
  job_id uuid REFERENCES public.ai_jobs(id)
);

CREATE TABLE public.processing_job_concurrency_probe (
  session_id integer PRIMARY KEY,
  backend_pid integer NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  job_id uuid REFERENCES public.ai_jobs(id),
  created boolean
);

ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY prescriptions_select_own ON public.prescriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY ai_jobs_select_own ON public.ai_jobs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY ai_jobs_insert_own ON public.ai_jobs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
GRANT SELECT ON public.prescriptions, public.ai_jobs TO authenticated;
GRANT INSERT ON public.ai_jobs TO authenticated;

INSERT INTO public.users (id) VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002');

INSERT INTO public.prescriptions (
  id, user_id, storage_provider, storage_bucket, object_key, status
) VALUES
  ('30000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000001',
   'aws_s3', 'local-test-bucket', 'private/prescriptions/owner/source.pdf', 'uploaded'),
  ('40000000-0000-4000-8000-000000000004',
   '20000000-0000-4000-8000-000000000002',
   'aws_s3', 'local-test-bucket', 'private/prescriptions/other/source.pdf', 'uploaded'),
  ('50000000-0000-4000-8000-000000000005',
   '10000000-0000-4000-8000-000000000001',
   'aws_s3', 'local-test-bucket', 'private/prescriptions/final/source.pdf', 'completed'),
  ('60000000-0000-4000-8000-000000000006',
   '10000000-0000-4000-8000-000000000001',
   'aws_s3', 'local-test-bucket', 'private/prescriptions/no-job/source.pdf', 'uploaded'),
  ('70000000-0000-4000-8000-000000000007',
   '10000000-0000-4000-8000-000000000001',
   'aws_s3', 'local-test-bucket', 'private/prescriptions/concurrent/source.pdf', 'uploaded');

INSERT INTO public.prescription_intelligence_results (user_id, prescription_id)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000005'
);
