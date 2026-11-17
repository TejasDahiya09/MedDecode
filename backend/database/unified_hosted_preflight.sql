\set ON_ERROR_STOP on
\if :{?backup_confirmed}
\else
  \set backup_confirmed false
\endif
\if :backup_confirmed
\else
  \echo [BLOCKED] independent hosted backup/snapshot confirmation is required
  SELECT 1 / 0 AS backup_confirmation_required;
\endif

-- Read-only hosted deployment gate.
-- This script reports PASS/BLOCKED notices only. It never reads prescription
-- content, patient fields, object keys, result JSON, or job identifiers.
BEGIN READ ONLY;

DO $preflight$
DECLARE
  v_blocked boolean := false;
  v_count bigint;
  v_submission_state text;
  v_claim_state text;
  v_finalization_state text;
  v_required_columns text[];
  v_missing_columns bigint;
  v_active_queued bigint := 0;
  v_active_processing bigint := 0;
  v_worker_role_exists boolean;
  v_python_role_exists boolean;
  v_rpc_owner_exists boolean;
  v_schema_exists boolean;
  v_submission_functions bigint;
  v_claim_functions bigint;
  v_finalization_functions bigint;
  v_index_exists boolean;
  v_migration_history_exists boolean;
BEGIN
  RAISE NOTICE '[INFO] target database=% current_user=% server_version=%',
    current_database(), current_user, current_setting('server_version');

  IF current_database() = 'postgres'
     AND current_user = 'postgres'
     AND current_setting('server_version_num')::integer >= 170000 THEN
    RAISE NOTICE '[PASS] target identity is hosted-compatible PostgreSQL 17+';
  ELSE
    RAISE NOTICE '[BLOCKED] target identity must be database=postgres, role=postgres, PostgreSQL 17+';
    v_blocked := true;
  END IF;

  IF has_database_privilege(current_user, current_database(), 'CREATE')
     AND has_schema_privilege(current_user, 'public', 'CREATE')
     AND has_schema_privilege(current_user, 'auth', 'USAGE')
     AND has_function_privilege(current_user, 'auth.uid()', 'EXECUTE') THEN
    RAISE NOTICE '[PASS] migration role has required database/public/auth verification privileges';
  ELSE
    RAISE NOTICE '[BLOCKED] migration role lacks required database/public/auth verification privileges';
    v_blocked := true;
  END IF;

  IF to_regrole('anon') IS NOT NULL
     AND to_regrole('authenticated') IS NOT NULL
     AND to_regprocedure('auth.uid()') IS NOT NULL THEN
    RAISE NOTICE '[PASS] Supabase client roles and auth.uid() exist';
  ELSE
    RAISE NOTICE '[BLOCKED] anon, authenticated, or auth.uid() is missing';
    v_blocked := true;
  END IF;

  IF to_regclass('public.medicines') IS NULL THEN
    RAISE NOTICE '[BLOCKED] public.medicines is missing';
    v_blocked := true;
  ELSE
    SELECT count(*) INTO v_count FROM public.medicines;
    IF v_count = 238 THEN
      RAISE NOTICE '[PASS] legacy public.medicines baseline is 238 rows';
    ELSE
      RAISE NOTICE '[BLOCKED] legacy public.medicines baseline drifted; observed_rows=%', v_count;
      v_blocked := true;
    END IF;
  END IF;

  v_schema_exists := to_regnamespace('official_catalogue') IS NOT NULL;
  v_migration_history_exists :=
    to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
    OR to_regclass('public.schema_migrations') IS NOT NULL;
  v_rpc_owner_exists := to_regrole('meddecode_catalogue_rpc_owner') IS NOT NULL;
  v_python_role_exists := to_regrole('meddecode_catalogue_python_reader') IS NOT NULL;
  v_worker_role_exists := to_regrole('meddecode_worker') IS NOT NULL;

  IF NOT v_schema_exists
     AND NOT v_rpc_owner_exists
     AND to_regprocedure('public.meddecode_official_catalogue_search_v1(text,integer,integer)') IS NULL
     AND to_regprocedure('public.meddecode_official_catalogue_detail_v1(uuid)') IS NULL THEN
    RAISE NOTICE '[PASS] official catalogue deployment namespace is absent and ready for fresh deployment';
  ELSE
    RAISE NOTICE '[BLOCKED] official catalogue schema, RPC owner, or RPC already exists; inspect before replay';
    v_blocked := true;
  END IF;

  IF to_regclass('public.prescriptions') IS NOT NULL
     AND to_regclass('public.ai_jobs') IS NOT NULL
     AND to_regclass('public.prescription_intelligence_results') IS NOT NULL THEN
    RAISE NOTICE '[PASS] core processing tables exist';
  ELSE
    RAISE NOTICE '[BLOCKED] required processing tables are missing';
    v_blocked := true;
  END IF;

  IF to_regclass('public.ai_jobs') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT count(*) FILTER (WHERE status = 'queued'),
             count(*) FILTER (WHERE status = 'processing')
      FROM public.ai_jobs
      WHERE job_type = 'prescription_analysis'
    $sql$ INTO v_active_queued, v_active_processing;
    IF v_active_queued = 0 AND v_active_processing = 0 THEN
      RAISE NOTICE '[PASS] no queued or processing prescription-analysis jobs exist';
    ELSE
      RAISE NOTICE '[BLOCKED] existing jobs require operator investigation; queued=% processing=%',
        v_active_queued, v_active_processing;
      v_blocked := true;
    END IF;
  END IF;

  SELECT count(*) INTO v_submission_functions
  FROM pg_proc
  WHERE oid IN (
    to_regprocedure('public.submit_prescription_analysis_job_v1(uuid,jsonb)'),
    to_regprocedure('public.get_prescription_analysis_status_v1(uuid)')
  );
  v_index_exists := to_regclass('public.ai_jobs_one_active_prescription_analysis_uq') IS NOT NULL;
  IF NOT v_migration_history_exists THEN
    RAISE NOTICE '[INFO] migration-history table is absent; object-level verification is mandatory';
  ELSE
    RAISE NOTICE '[INFO] migration-history table is present; object-level verification remains mandatory';
  END IF;

  IF v_submission_functions = 0 AND NOT v_index_exists THEN
    v_submission_state := 'not_deployed';
    RAISE NOTICE '[PASS] submission migration is absent; apply once after approval';
  ELSE
    v_submission_state := 'requires_exact_verification';
    RAISE NOTICE '[BLOCKED] submission objects exist; run the migration verification and do not replay from names alone';
    v_blocked := true;
  END IF;

  SELECT count(*) INTO v_claim_functions
  FROM pg_proc
  WHERE oid IN (
    to_regprocedure('public.claim_next_prescription_analysis_job_v1(text,integer)'),
    to_regprocedure('public.heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer)')
  );
  SELECT count(*) INTO v_finalization_functions
  FROM pg_proc
  WHERE oid IN (
    to_regprocedure('public.complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb)'),
    to_regprocedure('public.fail_prescription_analysis_job_v1(uuid,uuid,text,bigint,text,boolean,text,timestamptz)'),
    to_regprocedure('public.recover_expired_prescription_analysis_jobs_v1(integer)')
  );

  IF v_claim_functions = 0 THEN
    v_claim_state := 'not_deployed';
    RAISE NOTICE '[PASS] claim/heartbeat migration is absent; apply once after role provisioning';
  ELSE
    v_claim_state := 'requires_exact_verification';
    RAISE NOTICE '[BLOCKED] claim/heartbeat objects exist; run the migration verification and do not replay from names alone';
    v_blocked := true;
  END IF;

  IF v_finalization_functions = 0 THEN
    v_finalization_state := 'not_deployed';
    RAISE NOTICE '[PASS] finalization/recovery migration is absent; apply once after role provisioning';
  ELSE
    v_finalization_state := 'requires_exact_verification';
    RAISE NOTICE '[BLOCKED] finalization/recovery objects exist; run the migration verification and do not replay from names alone';
    v_blocked := true;
  END IF;

  IF to_regclass('public.ai_jobs') IS NOT NULL THEN
    v_required_columns := ARRAY[
      'id','user_id','prescription_id','job_type','status','input_reference',
      'result_reference','error_message','attempt_count','max_attempts',
      'available_at','lease_owner','lease_expires_at','heartbeat_at',
      'claim_generation','completed_at'
    ];
    SELECT count(*) INTO v_missing_columns
    FROM unnest(v_required_columns) AS required(column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = 'public.ai_jobs'::regclass
        AND a.attname = required.column_name
        AND a.attnum > 0 AND NOT a.attisdropped
    );
    IF v_missing_columns = 0 THEN
      RAISE NOTICE '[PASS] ai_jobs has all worker-required columns';
    ELSE
      RAISE NOTICE '[BLOCKED] ai_jobs is missing worker-required columns; missing_count=%', v_missing_columns;
      v_blocked := true;
    END IF;
  END IF;

  IF v_worker_role_exists THEN
    RAISE NOTICE '[PASS] meddecode_worker role exists; verify membership and grants before activation';
  ELSE
    RAISE NOTICE '[PASS] meddecode_worker role is absent; provisioning is a later approved stage';
  END IF;

  IF v_python_role_exists THEN
    RAISE NOTICE '[PASS] Python catalogue reader role exists; verify exact SELECT-only grants';
  ELSE
    RAISE NOTICE '[PASS] Python catalogue reader role is absent; provisioning is a later approved stage';
  END IF;

  RAISE NOTICE '[INFO] migration_state submission=% claim=% finalization=%',
    v_submission_state, v_claim_state, v_finalization_state;
  RAISE NOTICE '[PASS] operator confirmed an independent hosted backup/snapshot';

  IF v_blocked THEN
    RAISE NOTICE '[BLOCKED] unified hosted preflight failed; stop before mutation';
    RAISE EXCEPTION 'unified hosted preflight failed; inspect BLOCKED notices';
  ELSE
    RAISE NOTICE '[PASS] unified hosted preflight passed';
  END IF;
END
$preflight$;

COMMIT;
