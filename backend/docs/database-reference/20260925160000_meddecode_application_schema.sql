-- MedDecode — Application/Prescription additive migration
-- Migration: 20260925160000_meddecode_application_schema.sql
--
-- IMPORTANT:
-- This migration is intentionally ADDITIVE.
-- It does NOT create, alter, drop, truncate, rename, or reindex any
-- existing Member 1 medicine-intelligence tables.
--
-- Existing Member 1 tables preserved as-is:
--   medicines
--   manufacturers
--   active_ingredients
--   medicine_aliases
--   medicine_ingredients
--   medicine_prices
--   medicine_interactions
--   medicine_precautions
--   medicine_contraindications
--   medicine_side_effects
--   medicine_similarities
--   medicine_sources
--
-- This migration adds only application/user/prescription/persistence
-- tables and one additive identifier-mapping table for the
-- Member 1 <-> Member 2 medicine_external_id contract.
--
-- Large prescription/report files remain in AWS S3; PostgreSQL stores
-- metadata/object references.

begin;

-- ============================================================
-- 1. Utility
-- ============================================================

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 2. Application users
-- ============================================================
-- Supabase Auth remains the authentication source of truth.
-- public.users stores application-level profile information.

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_email_idx on public.users (lower(email));

create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

-- ============================================================
-- 3. Health profiles
-- ============================================================

create table public.health_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  age integer check (age is null or age between 0 and 150),
  gender text,
  allergies text[] not null default '{}',
  diabetes boolean not null default false,
  hypertension boolean not null default false,
  kidney_disease boolean not null default false,
  liver_disease boolean not null default false,
  asthma boolean not null default false,
  thyroid boolean not null default false,
  pregnancy boolean,
  other_conditions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger health_profiles_set_updated_at
before update on public.health_profiles
for each row execute function public.set_updated_at();

-- ============================================================
-- 4. Family members
-- ============================================================

create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  relationship text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index family_members_user_id_idx on public.family_members (user_id);

create trigger family_members_set_updated_at
before update on public.family_members
for each row execute function public.set_updated_at();

-- ============================================================
-- 5. Member 1 medicine_external_id mapping
-- ============================================================
-- IMPORTANT: existing public.medicines is NOT altered.
-- Member 1 can populate this table when its stable contract identifier
-- is available. The existing medicine UUID remains untouched.

create table public.medicine_contract_identifiers (
  medicine_id uuid primary key
    references public.medicines(id) on delete cascade,
  medicine_external_id text not null unique,
  created_at timestamptz not null default now()
);

create index medicine_contract_identifiers_external_idx
  on public.medicine_contract_identifiers (medicine_external_id);

-- ============================================================
-- 6. Prescriptions
-- ============================================================

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  -- AWS S3 reference; binary content is not stored in PostgreSQL.
  storage_provider text not null default 'aws_s3'
    check (storage_provider in ('aws_s3')),
  storage_bucket text,
  object_key text not null,
  file_type text not null
    check (file_type in ('image/jpeg', 'image/png', 'application/pdf')),
  original_filename text,
  file_size_bytes bigint
    check (file_size_bytes is null or file_size_bytes >= 0),

  status text not null default 'uploaded'
    check (status in (
      'uploaded',
      'queued',
      'processing',
      'completed',
      'completed_with_warnings',
      'failed'
    )),

  prescription_date date,

  -- Layer 2 prescription-level extraction
  doctor_name text,
  doctor_registration_number text,
  facility_name text,
  facility_address text,
  facility_phone text,
  patient_name text,
  patient_age integer
    check (patient_age is null or patient_age between 0 and 150),
  patient_gender text,

  -- Traceability/version metadata
  ocr_text text,
  intelligence_schema_version text,
  intelligence_dataset_version text,
  intelligence_model_version text,
  overall_confidence numeric(5,4)
    check (
      overall_confidence is null
      or overall_confidence between 0 and 1
    ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create index prescriptions_user_created_idx
  on public.prescriptions (user_id, created_at desc);

create index prescriptions_status_idx
  on public.prescriptions (status);

create trigger prescriptions_set_updated_at
before update on public.prescriptions
for each row execute function public.set_updated_at();

-- ============================================================
-- 7. Prescription medicines
-- ============================================================

create table public.prescription_medicines (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null
    references public.prescriptions(id) on delete cascade,
  sequence_number integer not null
    check (sequence_number > 0),

  -- Layer 2/3 extraction
  raw_text text not null,
  medicine_name text,
  medicine_name_normalized text,
  strength_value numeric,
  strength_unit text,
  dosage_form text,

  frequency_type text not null default 'unknown'
    check (frequency_type in ('scheduled', 'as_needed', 'unknown')),
  frequency_morning numeric,
  frequency_afternoon numeric,
  frequency_night numeric,
  frequency_times_per_day numeric,
  timing text,

  duration_value numeric,
  duration_unit text,

  quantity_value numeric,
  quantity_unit text,
  instructions text,

  extraction_confidence numeric(5,4)
    check (
      extraction_confidence is null
      or extraction_confidence between 0 and 1
    ),
  medicine_name_confidence numeric(5,4)
    check (
      medicine_name_confidence is null
      or medicine_name_confidence between 0 and 1
    ),
  dosage_confidence numeric(5,4)
    check (
      dosage_confidence is null
      or dosage_confidence between 0 and 1
    ),

  -- Member 1 matching result
  match_status text not null default 'not_attempted'
    check (match_status in (
      'matched',
      'probable_match',
      'ambiguous',
      'unmatched',
      'not_attempted'
    )),
  match_confidence numeric(5,4)
    check (
      match_confidence is null
      or match_confidence between 0 and 1
    ),

  -- Existing Member 1 medicines.id. This is only a reference;
  -- the existing medicines table is not modified.
  medicine_id uuid
    references public.medicines(id) on delete set null,

  units_per_day numeric,
  estimated_total_units numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (prescription_id, sequence_number)
);

create index prescription_medicines_prescription_idx
  on public.prescription_medicines (prescription_id, sequence_number);

create index prescription_medicines_medicine_idx
  on public.prescription_medicines (medicine_id);

create trigger prescription_medicines_set_updated_at
before update on public.prescription_medicines
for each row execute function public.set_updated_at();

-- ============================================================
-- 8. Alternatives
-- ============================================================

create table public.prescription_medicine_alternatives (
  id uuid primary key default gen_random_uuid(),
  prescription_medicine_id uuid not null
    references public.prescription_medicines(id) on delete cascade,

  medicine_id uuid
    references public.medicines(id) on delete set null,

  medicine_external_id text not null,

  ingredient_equivalence boolean not null,
  strength_compatibility boolean not null,
  dosage_form_compatibility boolean not null,

  price_value numeric(12,2),
  price_currency text,
  price_unit_description text,

  confidence numeric(5,4)
    check (confidence is null or confidence between 0 and 1),

  note text,
  created_at timestamptz not null default now()
);

create index alternatives_prescription_medicine_idx
  on public.prescription_medicine_alternatives (prescription_medicine_id);

create index alternatives_external_id_idx
  on public.prescription_medicine_alternatives (medicine_external_id);

-- ============================================================
-- 9. Recommendations
-- ============================================================

create table public.prescription_recommendations (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null
    references public.prescriptions(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  related_medicine_sequence_number integer,
  confidence numeric(5,4)
    check (confidence is null or confidence between 0 and 1),
  created_at timestamptz not null default now(),

  foreign key (prescription_id, related_medicine_sequence_number)
    references public.prescription_medicines(prescription_id, sequence_number)
    on delete cascade
);

create index recommendations_prescription_idx
  on public.prescription_recommendations (prescription_id);

-- ============================================================
-- 10. Warnings
-- ============================================================

create table public.prescription_warnings (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null
    references public.prescriptions(id) on delete cascade,
  code text not null,
  severity text not null
    check (severity in ('info', 'low', 'medium', 'high')),
  message text not null,
  related_medicine_sequence_number integer,
  created_at timestamptz not null default now(),

  foreign key (prescription_id, related_medicine_sequence_number)
    references public.prescription_medicines(prescription_id, sequence_number)
    on delete cascade
);

create index warnings_prescription_idx
  on public.prescription_warnings (prescription_id, severity);

-- ============================================================
-- 11. Full Member 1 intelligence result
-- ============================================================
-- Retains the complete versioned JSON response for traceability and
-- forward-compatible optional contract fields.

create table public.prescription_intelligence_results (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null unique
    references public.prescriptions(id) on delete cascade,
  job_id uuid,
  schema_version text not null,
  status text not null
    check (status in (
      'completed',
      'completed_with_warnings',
      'failed'
    )),
  result_json jsonb not null,
  error_json jsonb,
  created_at timestamptz not null default now()
);

create index prescription_intelligence_results_job_idx
  on public.prescription_intelligence_results (job_id);

-- ============================================================
-- 12. AI jobs
-- ============================================================

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  prescription_id uuid
    references public.prescriptions(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued'
    check (status in (
      'queued',
      'processing',
      'completed',
      'failed'
    )),
  input_reference jsonb,
  result_reference jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index ai_jobs_user_created_idx
  on public.ai_jobs (user_id, created_at desc);

create index ai_jobs_status_idx
  on public.ai_jobs (status);

create index ai_jobs_prescription_idx
  on public.ai_jobs (prescription_id);

-- ============================================================
-- 13. Medicine cabinet
-- ============================================================

create table public.medicine_cabinet (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  medicine_id uuid not null
    references public.medicines(id) on delete restrict,
  family_member_id uuid
    references public.family_members(id) on delete set null,
  quantity numeric check (quantity is null or quantity >= 0),
  purchase_date date,
  expiry_date date,
  refill_date date,
  usage_information text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index medicine_cabinet_user_idx
  on public.medicine_cabinet (user_id, created_at desc);

create index medicine_cabinet_expiry_idx
  on public.medicine_cabinet (user_id, expiry_date);

create index medicine_cabinet_refill_idx
  on public.medicine_cabinet (user_id, refill_date);

create trigger medicine_cabinet_set_updated_at
before update on public.medicine_cabinet
for each row execute function public.set_updated_at();

create or replace function public.validate_cabinet_family_member()
returns trigger
language plpgsql
as $$
begin
  if new.family_member_id is not null
     and not exists (
       select 1
       from public.family_members fm
       where fm.id = new.family_member_id
         and fm.user_id = new.user_id
     )
  then
    raise exception 'family_member_id does not belong to cabinet user';
  end if;

  return new;
end;
$$;

create trigger medicine_cabinet_validate_family_member
before insert or update on public.medicine_cabinet
for each row execute function public.validate_cabinet_family_member();

-- ============================================================
-- 14. Notifications
-- ============================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  related_cabinet_id uuid
    references public.medicine_cabinet(id) on delete set null,
  scheduled_for timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_scheduled_idx
  on public.notifications (user_id, scheduled_for);

create index notifications_user_unread_idx
  on public.notifications (user_id, read_at);

-- ============================================================
-- 15. Audit logs
-- ============================================================

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_user_created_idx
  on public.audit_logs (user_id, created_at desc);

-- ============================================================
-- 16. Analytics events
-- ============================================================

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  event_name text not null,
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index analytics_events_user_created_idx
  on public.analytics_events (user_id, created_at desc);

create index analytics_events_name_created_idx
  on public.analytics_events (event_name, created_at desc);

-- ============================================================
-- 17. Row Level Security
-- ============================================================
-- Only the NEW application tables are touched here.
-- No RLS statement is applied to Member 1's existing tables.

alter table public.users enable row level security;
alter table public.health_profiles enable row level security;
alter table public.family_members enable row level security;
alter table public.medicine_contract_identifiers enable row level security;
alter table public.prescriptions enable row level security;
alter table public.prescription_medicines enable row level security;
alter table public.prescription_medicine_alternatives enable row level security;
alter table public.prescription_recommendations enable row level security;
alter table public.prescription_warnings enable row level security;
alter table public.prescription_intelligence_results enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.medicine_cabinet enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.analytics_events enable row level security;

-- Users
create policy users_select_own
on public.users for select
to authenticated
using (id = auth.uid());

create policy users_insert_own
on public.users for insert
to authenticated
with check (id = auth.uid());

create policy users_update_own
on public.users for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Health profiles
create policy health_profiles_select_own
on public.health_profiles for select
to authenticated
using (user_id = auth.uid());

create policy health_profiles_insert_own
on public.health_profiles for insert
to authenticated
with check (user_id = auth.uid());

create policy health_profiles_update_own
on public.health_profiles for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy health_profiles_delete_own
on public.health_profiles for delete
to authenticated
using (user_id = auth.uid());

-- Family members
create policy family_members_select_own
on public.family_members for select
to authenticated
using (user_id = auth.uid());

create policy family_members_insert_own
on public.family_members for insert
to authenticated
with check (user_id = auth.uid());

create policy family_members_update_own
on public.family_members for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy family_members_delete_own
on public.family_members for delete
to authenticated
using (user_id = auth.uid());

-- Contract identifier mapping
-- Backend/service role is expected to populate this table.
create policy medicine_contract_identifiers_select_authenticated
on public.medicine_contract_identifiers for select
to authenticated
using (true);

-- Prescriptions
create policy prescriptions_select_own
on public.prescriptions for select
to authenticated
using (user_id = auth.uid());

create policy prescriptions_insert_own
on public.prescriptions for insert
to authenticated
with check (user_id = auth.uid());

create policy prescriptions_update_own
on public.prescriptions for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy prescriptions_delete_own
on public.prescriptions for delete
to authenticated
using (user_id = auth.uid());

-- Prescription medicines
create policy prescription_medicines_select_own
on public.prescription_medicines for select
to authenticated
using (
  exists (
    select 1
    from public.prescriptions p
    where p.id = prescription_medicines.prescription_id
      and p.user_id = auth.uid()
  )
);

create policy prescription_medicines_insert_own
on public.prescription_medicines for insert
to authenticated
with check (
  exists (
    select 1
    from public.prescriptions p
    where p.id = prescription_medicines.prescription_id
      and p.user_id = auth.uid()
  )
);

create policy prescription_medicines_update_own
on public.prescription_medicines for update
to authenticated
using (
  exists (
    select 1
    from public.prescriptions p
    where p.id = prescription_medicines.prescription_id
      and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.prescriptions p
    where p.id = prescription_medicines.prescription_id
      and p.user_id = auth.uid()
  )
);

create policy prescription_medicines_delete_own
on public.prescription_medicines for delete
to authenticated
using (
  exists (
    select 1
    from public.prescriptions p
    where p.id = prescription_medicines.prescription_id
      and p.user_id = auth.uid()
  )
);

-- Alternatives
create policy alternatives_select_own
on public.prescription_medicine_alternatives for select
to authenticated
using (
  exists (
    select 1
    from public.prescription_medicines pm
    join public.prescriptions p on p.id = pm.prescription_id
    where pm.id = prescription_medicine_alternatives.prescription_medicine_id
      and p.user_id = auth.uid()
  )
);

-- Recommendations
create policy recommendations_select_own
on public.prescription_recommendations for select
to authenticated
using (
  exists (
    select 1
    from public.prescriptions p
    where p.id = prescription_recommendations.prescription_id
      and p.user_id = auth.uid()
  )
);

-- Warnings
create policy warnings_select_own
on public.prescription_warnings for select
to authenticated
using (
  exists (
    select 1
    from public.prescriptions p
    where p.id = prescription_warnings.prescription_id
      and p.user_id = auth.uid()
  )
);

-- Intelligence results
create policy intelligence_results_select_own
on public.prescription_intelligence_results for select
to authenticated
using (
  exists (
    select 1
    from public.prescriptions p
    where p.id = prescription_intelligence_results.prescription_id
      and p.user_id = auth.uid()
  )
);

-- AI jobs
create policy ai_jobs_select_own
on public.ai_jobs for select
to authenticated
using (user_id = auth.uid());

create policy ai_jobs_insert_own
on public.ai_jobs for insert
to authenticated
with check (user_id = auth.uid());

-- Medicine cabinet
create policy medicine_cabinet_select_own
on public.medicine_cabinet for select
to authenticated
using (user_id = auth.uid());

create policy medicine_cabinet_insert_own
on public.medicine_cabinet for insert
to authenticated
with check (user_id = auth.uid());

create policy medicine_cabinet_update_own
on public.medicine_cabinet for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy medicine_cabinet_delete_own
on public.medicine_cabinet for delete
to authenticated
using (user_id = auth.uid());

-- Notifications
create policy notifications_select_own
on public.notifications for select
to authenticated
using (user_id = auth.uid());

create policy notifications_update_own
on public.notifications for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Audit logs
create policy audit_logs_select_own
on public.audit_logs for select
to authenticated
using (user_id = auth.uid());

-- Analytics
create policy analytics_events_select_own
on public.analytics_events for select
to authenticated
using (user_id = auth.uid());

create policy analytics_events_insert_own
on public.analytics_events for insert
to authenticated
with check (user_id = auth.uid());

-- ============================================================
-- 18. Supabase Auth -> public.users
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name'
    )
  )
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(excluded.name, public.users.name),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

commit;
