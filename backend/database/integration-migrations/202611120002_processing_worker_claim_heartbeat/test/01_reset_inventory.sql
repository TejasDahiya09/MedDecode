\set ON_ERROR_STOP on

DO $inventory$
DECLARE
  v_other_connections bigint;
  v_unexpected_schemas bigint;
  v_unsafe_extensions bigint;
  v_unexpected_relations bigint;
  v_unexpected_functions bigint;
  v_unexpected_constraints bigint;
  v_unexpected_policies bigint;
  v_unexpected_triggers bigint;
  v_unexpected_types bigint;
  v_unexpected_rows bigint := 0;
  v_users bigint := 0;
  v_prescriptions bigint := 0;
  v_jobs bigint := 0;
  v_results bigint := 0;
  v_probes bigint := 0;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'meddecode_worker')) <> 3 THEN
    RAISE EXCEPTION 'reset blocked: required pre-created cluster roles are missing';
  END IF;
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname IN ('anon', 'authenticated', 'meddecode_worker')
         AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole
              OR rolreplication OR rolbypassrls)
     ) OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname = 'meddecode_worker' AND rolinherit
     ) THEN
    RAISE EXCEPTION 'reset blocked: required cluster roles have unsafe attributes';
  END IF;

  SELECT count(*) INTO v_other_connections
  FROM pg_catalog.pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid();
  IF v_other_connections <> 0 THEN
    RAISE EXCEPTION 'reset blocked: other sessions are connected to the disposable database';
  END IF;

  SELECT count(*) INTO v_unexpected_schemas
  FROM pg_catalog.pg_namespace
  WHERE nspname NOT IN ('public', 'auth', 'information_schema')
    AND nspname !~ '^pg_';
  IF v_unexpected_schemas <> 0 THEN
    RAISE EXCEPTION 'reset blocked: unexpected user schemas exist';
  END IF;

  SELECT count(*) INTO v_unsafe_extensions
  FROM pg_catalog.pg_extension AS e
  JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
  WHERE n.nspname IN ('public', 'auth');
  IF v_unsafe_extensions <> 0 THEN
    RAISE EXCEPTION 'reset blocked: an extension depends on public or auth';
  END IF;

  SELECT count(*) INTO v_unexpected_relations
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'auth')
    AND c.relkind IN ('r','p','v','m','S','f','i')
    AND c.relname NOT IN (
      'users', 'users_pkey', 'prescriptions', 'prescriptions_pkey',
      'ai_jobs', 'ai_jobs_pkey', 'prescription_intelligence_results',
      'prescription_intelligence_results_pkey',
      'prescription_intelligence_results_prescription_id_key',
      'processing_job_concurrency_probe', 'processing_job_concurrency_probe_pkey',
      'ai_jobs_one_active_prescription_analysis_uq',
      'ai_jobs_worker_available_idx', 'ai_jobs_worker_lease_expiry_idx'
    );
  IF v_unexpected_relations <> 0 THEN
    RAISE EXCEPTION 'reset blocked: unexpected relations exist in public or auth';
  END IF;

  SELECT count(*) INTO v_unexpected_functions
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'auth')
    AND (n.nspname, p.proname) NOT IN (
      ('auth', 'uid'),
      ('public', 'submit_prescription_analysis_job_v1'),
      ('public', 'get_prescription_analysis_status_v1'),
      ('public', 'claim_next_prescription_analysis_job_v1'),
      ('public', 'heartbeat_prescription_analysis_job_v1')
    );
  IF v_unexpected_functions <> 0 THEN
    RAISE EXCEPTION 'reset blocked: unexpected functions exist in public or auth';
  END IF;

  SELECT count(*) INTO v_unexpected_constraints
  FROM pg_catalog.pg_constraint AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.connamespace
  WHERE n.nspname IN ('public', 'auth')
    AND c.conname NOT IN (
      'users_pkey', 'prescriptions_pkey', 'prescriptions_user_id_fkey',
      'prescriptions_status_check', 'prescriptions_file_type_check',
      'ai_jobs_pkey', 'ai_jobs_user_id_fkey', 'ai_jobs_prescription_id_fkey',
      'ai_jobs_status_check', 'ai_jobs_attempt_bounds_check',
      'ai_jobs_claim_generation_check', 'ai_jobs_lease_state_check',
      'prescription_intelligence_results_pkey',
      'prescription_intelligence_results_user_id_fkey',
      'prescription_intelligence_results_prescription_id_fkey',
      'prescription_intelligence_results_job_id_fkey',
      'prescription_intelligence_results_prescription_id_key',
      'processing_job_concurrency_probe_pkey',
      'processing_job_concurrency_probe_job_id_fkey'
    );
  IF v_unexpected_constraints <> 0 THEN
    RAISE EXCEPTION 'reset blocked: unexpected constraints exist in public or auth';
  END IF;

  SELECT count(*) INTO v_unexpected_policies
  FROM pg_catalog.pg_policy AS p
  JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'auth')
    AND p.polname NOT IN ('prescriptions_select_own', 'ai_jobs_select_own', 'ai_jobs_insert_own');
  IF v_unexpected_policies <> 0 THEN
    RAISE EXCEPTION 'reset blocked: unexpected RLS policies exist in public or auth';
  END IF;

  SELECT count(*) INTO v_unexpected_triggers
  FROM pg_catalog.pg_trigger AS t
  JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'auth') AND NOT t.tgisinternal;
  IF v_unexpected_triggers <> 0 THEN
    RAISE EXCEPTION 'reset blocked: unexpected triggers exist in public or auth';
  END IF;

  SELECT count(*) INTO v_unexpected_types
  FROM pg_catalog.pg_type AS t
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
  LEFT JOIN pg_catalog.pg_class AS c ON c.oid = t.typrelid
  WHERE n.nspname IN ('public', 'auth')
    AND (t.typtype IN ('d', 'e') OR (t.typtype = 'c' AND c.relname NOT IN (
      'users', 'prescriptions', 'ai_jobs', 'prescription_intelligence_results',
      'processing_job_concurrency_probe'
    )));
  IF v_unexpected_types <> 0 THEN
    RAISE EXCEPTION 'reset blocked: unexpected user-defined types exist in public or auth';
  END IF;

  IF to_regclass('public.users') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.users' INTO v_users;
    EXECUTE $sql$SELECT count(*) FROM public.users
      WHERE id NOT IN ('10000000-0000-4000-8000-000000000001'::uuid,
                       '20000000-0000-4000-8000-000000000002'::uuid)$sql$
      INTO v_unexpected_rows;
  END IF;
  IF v_unexpected_rows <> 0 THEN RAISE EXCEPTION 'reset blocked: unexpected user rows exist'; END IF;

  IF to_regclass('public.prescriptions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.prescriptions' INTO v_prescriptions;
    EXECUTE $sql$SELECT count(*) FROM public.prescriptions WHERE id NOT IN (
      '20000000-0000-4000-8000-000000000001'::uuid,
      '30000000-0000-4000-8000-000000000003'::uuid,
      '40000000-0000-4000-8000-000000000004'::uuid,
      '50000000-0000-4000-8000-000000000005'::uuid,
      '60000000-0000-4000-8000-000000000006'::uuid,
      '70000000-0000-4000-8000-000000000007'::uuid)$sql$
      INTO v_unexpected_rows;
  END IF;
  IF v_unexpected_rows <> 0 THEN RAISE EXCEPTION 'reset blocked: unexpected prescription rows exist'; END IF;

  IF to_regclass('public.ai_jobs') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.ai_jobs' INTO v_jobs;
    EXECUTE $sql$SELECT count(*) FROM public.ai_jobs
      WHERE user_id NOT IN ('10000000-0000-4000-8000-000000000001'::uuid,
                            '20000000-0000-4000-8000-000000000002'::uuid)
         OR prescription_id NOT IN (
           '20000000-0000-4000-8000-000000000001'::uuid,
           '30000000-0000-4000-8000-000000000003'::uuid,
           '40000000-0000-4000-8000-000000000004'::uuid,
           '50000000-0000-4000-8000-000000000005'::uuid,
           '60000000-0000-4000-8000-000000000006'::uuid,
           '70000000-0000-4000-8000-000000000007'::uuid)
         OR job_type <> 'prescription_analysis'$sql$ INTO v_unexpected_rows;
  END IF;
  IF v_unexpected_rows <> 0 THEN RAISE EXCEPTION 'reset blocked: unexpected job rows exist'; END IF;

  IF to_regclass('public.prescription_intelligence_results') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.prescription_intelligence_results' INTO v_results;
    EXECUTE $sql$SELECT count(*) FROM public.prescription_intelligence_results
      WHERE prescription_id <> '50000000-0000-4000-8000-000000000005'::uuid$sql$
      INTO v_unexpected_rows;
  END IF;
  IF v_unexpected_rows <> 0 THEN RAISE EXCEPTION 'reset blocked: unexpected result rows exist'; END IF;

  IF to_regclass('public.processing_job_concurrency_probe') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.processing_job_concurrency_probe' INTO v_probes;
    EXECUTE 'SELECT count(*) FROM public.processing_job_concurrency_probe WHERE session_id NOT IN (1,2)'
      INTO v_unexpected_rows;
  END IF;
  IF v_unexpected_rows <> 0 THEN RAISE EXCEPTION 'reset blocked: unexpected probe rows exist'; END IF;

  RAISE NOTICE 'approved disposable inventory: users=%, prescriptions=%, jobs=%, results=%, probes=%',
    v_users, v_prescriptions, v_jobs, v_results, v_probes;
END
$inventory$;

SELECT 'RESET_INVENTORY_OK';
