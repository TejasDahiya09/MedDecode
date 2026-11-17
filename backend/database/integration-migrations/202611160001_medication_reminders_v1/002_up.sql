\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- 1. Medication Reminders Table
CREATE TABLE public.medication_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  medicine_id uuid REFERENCES public.medicine_cabinet(id) ON DELETE SET NULL,
  medicine_name text NOT NULL CHECK (length(btrim(medicine_name)) BETWEEN 1 AND 120),
  dosage text CHECK (dosage IS NULL OR length(btrim(dosage)) <= 100),
  scheduled_time text NOT NULL CHECK (scheduled_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  scheduled_times jsonb DEFAULT '[]'::jsonb CHECK (jsonb_typeof(scheduled_times) = 'array'),
  scheduled_date date,
  start_date date,
  end_date date,
  recurrence text NOT NULL DEFAULT 'daily' CHECK (recurrence IN ('daily', 'twice_daily', 'thrice_daily', 'weekly', 'as_needed', 'once', 'custom')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  notes text CHECK (notes IS NULL OR length(btrim(notes)) <= 250),
  last_taken_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_reminders_id_user_uniq UNIQUE (id, user_id)
);

CREATE INDEX medication_reminders_user_time_idx
  ON public.medication_reminders (user_id, scheduled_time);

CREATE INDEX medication_reminders_user_status_idx
  ON public.medication_reminders (user_id, status);

-- 2. Dose Logs Table (Idempotent dose tracking & owner-consistent relationship)
CREATE TABLE public.medication_dose_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dose_time timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('taken', 'skipped')),
  notes text CHECK (notes IS NULL OR length(btrim(notes)) <= 250),
  logged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reminder_id, dose_time),
  CONSTRAINT medication_dose_logs_reminder_user_fkey
    FOREIGN KEY (reminder_id, user_id)
    REFERENCES public.medication_reminders(id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX medication_dose_logs_user_idx
  ON public.medication_dose_logs (user_id, logged_at DESC);

-- 3. Row Level Security
ALTER TABLE public.medication_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_dose_logs ENABLE ROW LEVEL SECURITY;

-- medication_reminders RLS policies
CREATE POLICY medication_reminders_owner_select
  ON public.medication_reminders
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY medication_reminders_owner_insert
  ON public.medication_reminders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      medicine_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.medicine_cabinet mc
        WHERE mc.id = medicine_id AND mc.user_id = auth.uid()
      )
    )
  );

CREATE POLICY medication_reminders_owner_update
  ON public.medication_reminders
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      medicine_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.medicine_cabinet mc
        WHERE mc.id = medicine_id AND mc.user_id = auth.uid()
      )
    )
  );

CREATE POLICY medication_reminders_owner_delete
  ON public.medication_reminders
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- medication_dose_logs RLS policies
CREATE POLICY medication_dose_logs_owner_select
  ON public.medication_dose_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY medication_dose_logs_owner_insert
  ON public.medication_dose_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.medication_reminders r
      WHERE r.id = reminder_id AND r.user_id = auth.uid()
    )
  );

CREATE POLICY medication_dose_logs_owner_update
  ON public.medication_dose_logs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.medication_reminders r
      WHERE r.id = reminder_id AND r.user_id = auth.uid()
    )
  );

CREATE POLICY medication_dose_logs_owner_delete
  ON public.medication_dose_logs
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 4. Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medication_reminders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medication_dose_logs TO authenticated;

COMMIT;
