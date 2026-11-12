\set ON_ERROR_STOP on

-- DISPOSABLE LOCAL TEST FIXTURE ONLY. The inherited bootstrap has already
-- recreated public/auth. This file must never be used against hosted Supabase.
-- The older submission bootstrap contains a local-only required user_id on this
-- table; the verified historical application schema does not. Normalize only
-- the disposable fixture before testing the candidate's real target contract.
ALTER TABLE public.prescription_intelligence_results
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.prescription_intelligence_results
  ADD COLUMN schema_version text NOT NULL DEFAULT '1.0',
  ADD COLUMN status text NOT NULL DEFAULT 'failed'
    CHECK (status IN ('completed', 'completed_with_warnings', 'failed')),
  ADD COLUMN result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN error_json jsonb;

ALTER TABLE public.prescriptions
  ADD COLUMN prescription_date date,
  ADD COLUMN doctor_name text,
  ADD COLUMN doctor_registration_number text,
  ADD COLUMN facility_name text,
  ADD COLUMN facility_address text,
  ADD COLUMN facility_phone text,
  ADD COLUMN patient_name text,
  ADD COLUMN patient_age integer,
  ADD COLUMN patient_gender text,
  ADD COLUMN intelligence_schema_version text,
  ADD COLUMN intelligence_dataset_version text,
  ADD COLUMN intelligence_model_version text,
  ADD COLUMN overall_confidence numeric,
  ADD COLUMN processed_at timestamptz;

CREATE TABLE public.prescription_medicines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  raw_text text NOT NULL, medicine_name text, medicine_name_normalized text,
  strength_value numeric, strength_unit text, dosage_form text,
  frequency_type text NOT NULL DEFAULT 'unknown'
    CHECK (frequency_type IN ('scheduled', 'as_needed', 'unknown')),
  frequency_morning numeric, frequency_afternoon numeric, frequency_night numeric,
  frequency_times_per_day numeric, timing text, duration_value numeric,
  duration_unit text, quantity_value numeric, quantity_unit text, instructions text,
  extraction_confidence numeric CHECK (extraction_confidence IS NULL OR extraction_confidence BETWEEN 0 AND 1),
  medicine_name_confidence numeric CHECK (medicine_name_confidence IS NULL OR medicine_name_confidence BETWEEN 0 AND 1),
  dosage_confidence numeric CHECK (dosage_confidence IS NULL OR dosage_confidence BETWEEN 0 AND 1),
  match_status text NOT NULL DEFAULT 'not_attempted'
    CHECK (match_status IN ('matched', 'probable_match', 'ambiguous', 'unmatched', 'not_attempted')),
  match_confidence numeric CHECK (match_confidence IS NULL OR match_confidence BETWEEN 0 AND 1),
  medicine_id uuid, units_per_day numeric, estimated_total_units numeric,
  UNIQUE (prescription_id, sequence_number)
);
CREATE TABLE public.prescription_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  type text NOT NULL, title text NOT NULL, message text NOT NULL,
  related_medicine_sequence_number integer,
  confidence numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  FOREIGN KEY (prescription_id, related_medicine_sequence_number)
    REFERENCES public.prescription_medicines(prescription_id, sequence_number) ON DELETE CASCADE
);
CREATE TABLE public.prescription_warnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  code text NOT NULL, severity text NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high')),
  message text NOT NULL, related_medicine_sequence_number integer,
  FOREIGN KEY (prescription_id, related_medicine_sequence_number)
    REFERENCES public.prescription_medicines(prescription_id, sequence_number) ON DELETE CASCADE
);
