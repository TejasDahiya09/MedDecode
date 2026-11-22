\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE IF NOT EXISTS public.medicines (
  id uuid PRIMARY KEY,
  canonical_name text NOT NULL
);

INSERT INTO public.medicines(id, canonical_name) VALUES
  ('d2000000-0000-4000-8000-000000000001', 'Synthetic Fixture Alpha 250 mg Tablet'),
  ('d2000000-0000-4000-8000-000000000002', 'Synthetic Fixture Alpha 500 mg Tablet'),
  ('d2000000-0000-4000-8000-000000000003', 'Synthetic Fixture Alpha + Beta Tablet'),
  ('d2000000-0000-4000-8000-000000000004', 'Synthetic Fixture Incomplete Tablet')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.medicine_cabinet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  medicine_id uuid NOT NULL REFERENCES public.medicines(id) ON DELETE RESTRICT,
  family_member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  quantity numeric CHECK (quantity IS NULL OR quantity >= 0),
  purchase_date date,
  expiry_date date,
  refill_date date,
  usage_information text CHECK (usage_information IS NULL OR length(usage_information) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS medicine_cabinet_user_idx
  ON public.medicine_cabinet(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS phase1f_medicine_cabinet_id_user_uniq
  ON public.medicine_cabinet(id, user_id);

CREATE TABLE IF NOT EXISTS public.medication_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  medicine_id uuid,
  medicine_name text NOT NULL CHECK (length(btrim(medicine_name)) BETWEEN 1 AND 120),
  dosage text CHECK (dosage IS NULL OR length(btrim(dosage)) <= 100),
  scheduled_time text NOT NULL CHECK (scheduled_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  scheduled_times jsonb DEFAULT '[]'::jsonb CHECK (jsonb_typeof(scheduled_times) = 'array'),
  scheduled_date date,
  start_date date,
  end_date date,
  recurrence text NOT NULL DEFAULT 'daily' CHECK (recurrence IN ('daily','twice_daily','thrice_daily','weekly','as_needed','once','custom')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  notes text CHECK (notes IS NULL OR length(btrim(notes)) <= 250),
  last_taken_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phase1f_reminder_cabinet_owner_fk
    FOREIGN KEY (medicine_id, user_id) REFERENCES public.medicine_cabinet(id, user_id)
    ON DELETE SET NULL (medicine_id),
  CONSTRAINT medication_reminders_id_user_uniq UNIQUE(id, user_id)
);

CREATE INDEX IF NOT EXISTS medication_reminders_user_time_idx
  ON public.medication_reminders(user_id, scheduled_time);
CREATE INDEX IF NOT EXISTS medication_reminders_user_status_idx
  ON public.medication_reminders(user_id, status);

CREATE TABLE IF NOT EXISTS public.medication_dose_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dose_time timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('taken','skipped')),
  notes text CHECK (notes IS NULL OR length(btrim(notes)) <= 250),
  logged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_dose_logs_reminder_time_key UNIQUE(reminder_id, dose_time),
  CONSTRAINT medication_dose_logs_reminder_user_fkey
    FOREIGN KEY (reminder_id, user_id)
    REFERENCES public.medication_reminders(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS medication_dose_logs_user_idx
  ON public.medication_dose_logs(user_id, logged_at DESC);

ALTER TABLE public.medicine_cabinet ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_dose_logs ENABLE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policy WHERE polrelid='public.medicine_cabinet'::regclass AND polname='phase1f_cabinet_owner') THEN
    CREATE POLICY phase1f_cabinet_owner ON public.medicine_cabinet
      FOR ALL TO authenticated USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
  END IF;
  IF NOT EXISTS (SELECT FROM pg_policy WHERE polrelid='public.medication_reminders'::regclass AND polname='phase1f_reminders_owner') THEN
    CREATE POLICY phase1f_reminders_owner ON public.medication_reminders
      FOR ALL TO authenticated USING (auth.uid()=user_id)
      WITH CHECK (auth.uid()=user_id AND (medicine_id IS NULL OR EXISTS (
        SELECT 1 FROM public.medicine_cabinet mc
        WHERE mc.id=public.medication_reminders.medicine_id AND mc.user_id=auth.uid()
      )));
  END IF;
  IF NOT EXISTS (SELECT FROM pg_policy WHERE polrelid='public.medication_dose_logs'::regclass AND polname='phase1f_dose_logs_owner') THEN
    CREATE POLICY phase1f_dose_logs_owner ON public.medication_dose_logs
      FOR ALL TO authenticated USING (auth.uid()=user_id)
      WITH CHECK (auth.uid()=user_id AND EXISTS (
        SELECT 1 FROM public.medication_reminders r
        WHERE r.id=public.medication_dose_logs.reminder_id AND r.user_id=auth.uid()
      ));
  END IF;
END
$policies$;

REVOKE ALL ON public.medicine_cabinet, public.medication_reminders, public.medication_dose_logs
  FROM PUBLIC, anon, meddecode_worker, meddecode_scoped_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.medicine_cabinet, public.medication_reminders, public.medication_dose_logs
  TO authenticated;

COMMIT;
