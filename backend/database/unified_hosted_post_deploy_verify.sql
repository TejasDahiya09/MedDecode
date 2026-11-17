\set ON_ERROR_STOP on

-- Read-only post-deployment verification. No prescription content or
-- identifiers are selected.
BEGIN READ ONLY;

DO $verify$
DECLARE
  v_count bigint;
  v_orphans bigint;
  v_table text;
  v_expected text[] := ARRAY[
    'sources','releases','import_batches','source_records','ingredients',
    'formulations','formulation_ingredients','products','product_packages',
    'price_observations','regulatory_events','link_candidates',
    'catalogue_entities'
  ];
  v_counts bigint[] := ARRAY[12,22,42,7072,8388,4802,5079,1710,4781,4781,1951,9982,26419];
  v_proc regprocedure;
  v_worker_proc regprocedure;
BEGIN
  IF current_database() <> 'postgres' OR current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'unexpected hosted target identity';
  END IF;
  IF to_regnamespace('official_catalogue') IS NULL THEN
    RAISE EXCEPTION 'official_catalogue schema is missing';
  END IF;

  FOR i IN 1..array_length(v_expected, 1) LOOP
    IF to_regclass(format('official_catalogue.%I', v_expected[i])) IS NULL THEN
      RAISE EXCEPTION 'official catalogue table is missing: %', v_expected[i];
    END IF;
    EXECUTE format('SELECT count(*) FROM official_catalogue.%I', v_expected[i]) INTO v_count;
    IF v_count <> v_counts[i] THEN
      RAISE EXCEPTION 'official catalogue row count mismatch for %: observed %, expected %',
        v_expected[i], v_count, v_counts[i];
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count
  FROM pg_constraint
  WHERE connamespace = 'official_catalogue'::regnamespace
    AND contype = 'f' AND convalidated;
  IF v_count <> 17 THEN
    RAISE EXCEPTION 'expected 17 validated official catalogue foreign keys, observed %', v_count;
  END IF;

  SELECT count(*) INTO v_orphans
  FROM official_catalogue.formulation_ingredients fi
  LEFT JOIN official_catalogue.formulations f ON f.formulation_id = fi.formulation_id
  LEFT JOIN official_catalogue.ingredients i ON i.ingredient_id = fi.ingredient_id
  WHERE f.formulation_id IS NULL OR i.ingredient_id IS NULL;
  IF v_orphans <> 0 THEN RAISE EXCEPTION 'formulation ingredient orphans: %', v_orphans; END IF;

  SELECT count(*) INTO v_orphans
  FROM official_catalogue.price_observations p
  WHERE p.package_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM official_catalogue.product_packages pp
      WHERE pp.package_id = p.package_id
    );
  IF v_orphans <> 0 THEN RAISE EXCEPTION 'price package orphans: %', v_orphans; END IF;

  IF to_regrole('meddecode_catalogue_rpc_owner') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_roles
       WHERE rolname = 'meddecode_catalogue_rpc_owner'
         AND rolcanlogin = false AND rolsuper = false
         AND rolcreatedb = false AND rolcreaterole = false
         AND rolinherit = false AND rolbypassrls = false
     ) THEN
    RAISE EXCEPTION 'catalogue RPC owner role is unsafe or missing';
  END IF;

  FOREACH v_proc IN ARRAY ARRAY[
    'public.meddecode_official_catalogue_search_v1(text,integer,integer)'::regprocedure,
    'public.meddecode_official_catalogue_detail_v1(uuid)'::regprocedure
  ] LOOP
    IF NOT has_function_privilege('authenticated', v_proc, 'EXECUTE')
       OR has_function_privilege('anon', v_proc, 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_proc p,
              LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         WHERE p.oid = v_proc
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'catalogue RPC grants are invalid: %', v_proc;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid IN (
      'public.meddecode_official_catalogue_search_v1(text,integer,integer)'::regprocedure,
      'public.meddecode_official_catalogue_detail_v1(uuid)'::regprocedure
    )
    AND (
      p.proowner <> 'meddecode_catalogue_rpc_owner'::regrole
      OR NOT p.prosecdef
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
    )
  ) THEN
    RAISE EXCEPTION 'official catalogue RPC ownership or security is invalid';
  END IF;

  FOREACH v_worker_proc IN ARRAY ARRAY[
    'public.claim_next_prescription_analysis_job_v1(text,integer)'::regprocedure,
    'public.heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer)'::regprocedure,
    'public.complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb)'::regprocedure,
    'public.fail_prescription_analysis_job_v1(uuid,uuid,text,bigint,text,boolean,text,timestamptz)'::regprocedure,
    'public.recover_expired_prescription_analysis_jobs_v1(integer)'::regprocedure
  ] LOOP
    IF NOT has_function_privilege('meddecode_worker', v_worker_proc, 'EXECUTE')
       OR has_function_privilege('anon', v_worker_proc, 'EXECUTE')
       OR has_function_privilege('authenticated', v_worker_proc, 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_proc p,
              LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         WHERE p.oid = v_worker_proc
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'worker RPC grants are invalid: %', v_worker_proc;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid IN (
      'public.claim_next_prescription_analysis_job_v1(text,integer)'::regprocedure,
      'public.heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer)'::regprocedure,
      'public.complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb)'::regprocedure,
      'public.fail_prescription_analysis_job_v1(uuid,uuid,text,bigint,text,boolean,text,timestamptz)'::regprocedure,
      'public.recover_expired_prescription_analysis_jobs_v1(integer)'::regprocedure
    )
    AND (
      p.proowner <> 'postgres'::regrole
      OR NOT p.prosecdef
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
    )
  ) THEN
    RAISE EXCEPTION 'worker RPC ownership or security is invalid';
  END IF;

  IF to_regrole('meddecode_worker_login') IS NULL
     OR NOT pg_has_role('meddecode_worker_login', 'meddecode_worker', 'MEMBER') THEN
    RAISE EXCEPTION 'worker login is not a member of meddecode_worker';
  END IF;

  IF to_regrole('meddecode_catalogue_python_reader') IS NULL
     OR NOT has_schema_privilege('meddecode_catalogue_python_reader', 'official_catalogue', 'USAGE')
     OR NOT has_column_privilege('meddecode_catalogue_python_reader',
       'official_catalogue.catalogue_entities', 'entity_id', 'SELECT')
     OR NOT has_column_privilege('meddecode_catalogue_python_reader',
       'official_catalogue.catalogue_entities', 'evidence', 'SELECT')
     OR NOT has_column_privilege('meddecode_catalogue_python_reader',
       'official_catalogue.catalogue_entities', 'identity', 'SELECT')
     OR has_any_column_privilege(
       'meddecode_catalogue_python_reader',
       'official_catalogue.formulations',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'Python catalogue reader privileges are invalid';
  END IF;

  IF to_regrole('meddecode_worker') IS NULL
     OR NOT has_schema_privilege('meddecode_worker', 'public', 'USAGE')
     OR has_schema_privilege('meddecode_worker', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'worker role schema privileges are invalid';
  END IF;
  IF has_table_privilege('meddecode_worker', 'public.ai_jobs', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_any_column_privilege('meddecode_worker', 'public.ai_jobs', 'SELECT,INSERT,UPDATE') THEN
    RAISE EXCEPTION 'worker role has direct ai_jobs privileges';
  END IF;

  IF to_regprocedure('public.submit_prescription_analysis_job_v1(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'submission RPC is missing';
  END IF;
  IF to_regprocedure('public.claim_next_prescription_analysis_job_v1(text,integer)') IS NULL
     OR to_regprocedure('public.complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb)') IS NULL
     OR to_regprocedure('public.recover_expired_prescription_analysis_jobs_v1(integer)') IS NULL THEN
    RAISE EXCEPTION 'worker RPC set is incomplete';
  END IF;
END
$verify$;

SELECT 'PASS' AS status, 'official catalogue counts, FKs, RPCs, reader, and worker grants verified' AS check;
COMMIT;
