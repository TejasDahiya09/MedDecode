\set ON_ERROR_STOP on
DO $role_guard$
DECLARE
  v_role pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO v_role FROM pg_catalog.pg_roles WHERE rolname = 'meddecode_worker';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meddecode_worker role is absent; role creation requires separate approval';
  END IF;
  IF v_role.rolcanlogin OR v_role.rolinherit OR v_role.rolsuper
     OR v_role.rolcreatedb OR v_role.rolcreaterole OR v_role.rolreplication
     OR v_role.rolbypassrls THEN
    RAISE EXCEPTION 'existing meddecode_worker role has unsafe attributes';
  END IF;
END
$role_guard$;

-- The committed Milestone 2C bootstrap intentionally models only columns used
-- by submission. Worker claim returns the verified hosted file_type column, so
-- extend only the disposable local fixture here.
ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS file_type text NOT NULL DEFAULT 'application/pdf'
  CHECK (file_type IN ('image/jpeg', 'image/png', 'application/pdf'));
