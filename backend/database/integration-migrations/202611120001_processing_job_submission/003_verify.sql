\set ON_ERROR_STOP on

DO $verify$
DECLARE
  v_index_oid oid;
  v_index_valid boolean;
  v_index_ready boolean;
  v_index_unique boolean;
  v_index_key_count smallint;
  v_index_attribute_count smallint;
  v_index_access_method name;
  v_index_first_key text;
  v_index_second_key text;
  v_index_predicate text;
  v_normalized_predicate text;
  v_submission_oid oid;
  v_status_oid oid;
  v_owner name;
  v_security_definer boolean;
  v_function_config text[];
  v_public_execute boolean;
BEGIN
  SELECT
    i.indexrelid,
    i.indisvalid,
    i.indisready,
    i.indisunique,
    i.indnkeyatts,
    i.indnatts,
    am.amname,
    pg_get_indexdef(i.indexrelid, 1, true),
    pg_get_indexdef(i.indexrelid, 2, true),
    pg_get_expr(i.indpred, i.indrelid)
  INTO
    v_index_oid,
    v_index_valid,
    v_index_ready,
    v_index_unique,
    v_index_key_count,
    v_index_attribute_count,
    v_index_access_method,
    v_index_first_key,
    v_index_second_key,
    v_index_predicate
  FROM pg_catalog.pg_index AS i
  JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = i.indexrelid
  JOIN pg_catalog.pg_am AS am ON am.oid = index_relation.relam
  WHERE i.indexrelid =
    to_regclass('public.ai_jobs_one_active_prescription_analysis_uq')
    AND i.indrelid = 'public.ai_jobs'::regclass;

  v_normalized_predicate := regexp_replace(
    lower(regexp_replace(v_index_predicate, '::[[:alnum:]_".]+', '', 'g')),
    '[[:space:]()"]',
    '',
    'g'
  );

  IF v_index_oid IS NULL
     OR v_index_valid IS DISTINCT FROM true
     OR v_index_ready IS DISTINCT FROM true
     OR v_index_unique IS DISTINCT FROM true
     OR v_index_key_count IS DISTINCT FROM 2
     OR v_index_attribute_count IS DISTINCT FROM 2
     OR v_index_access_method IS DISTINCT FROM 'btree'
     OR v_index_first_key IS DISTINCT FROM 'prescription_id'
     OR v_index_second_key IS DISTINCT FROM 'job_type'
     OR v_normalized_predicate IS DISTINCT FROM
       'prescription_idisnotnullandjob_type=''prescription_analysis''andstatus=anyarray[''queued'',''processing'']' THEN
    RAISE EXCEPTION 'active-job unique index is missing, invalid, or incompatible';
  END IF;

  v_submission_oid :=
    to_regprocedure('public.submit_prescription_analysis_job_v1(uuid,jsonb)');
  v_status_oid :=
    to_regprocedure('public.get_prescription_analysis_status_v1(uuid)');

  IF v_submission_oid IS NULL OR v_status_oid IS NULL THEN
    RAISE EXCEPTION 'required processing-job RPC signature is missing';
  END IF;

  SELECT
    r.rolname,
    p.prosecdef,
    p.proconfig,
    EXISTS (
      SELECT 1
      FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )
  INTO v_owner, v_security_definer, v_function_config, v_public_execute
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
  WHERE p.oid = v_submission_oid;

  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_security_definer IS DISTINCT FROM true
     OR v_function_config IS DISTINCT FROM ARRAY['search_path=""']
     OR v_public_execute
     OR has_function_privilege('anon', v_submission_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_submission_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'submission RPC owner, security, search path, or grants are invalid';
  END IF;

  SELECT
    r.rolname,
    p.prosecdef,
    p.proconfig,
    EXISTS (
      SELECT 1
      FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )
  INTO v_owner, v_security_definer, v_function_config, v_public_execute
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
  WHERE p.oid = v_status_oid;

  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_security_definer IS DISTINCT FROM false
     OR v_function_config IS DISTINCT FROM ARRAY['search_path=""']
     OR v_public_execute
     OR has_function_privilege('anon', v_status_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_status_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'status RPC owner, security, search path, or grants are invalid';
  END IF;

  IF has_table_privilege('authenticated', 'public.ai_jobs', 'INSERT')
     OR has_any_column_privilege('authenticated', 'public.ai_jobs', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated retains effective ai_jobs INSERT access';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.ai_jobs', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.prescriptions', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated SELECT privileges required by the status RPC are missing';
  END IF;
END
$verify$;
