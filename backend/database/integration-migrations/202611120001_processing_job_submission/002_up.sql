\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $index_guard$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_indexdef(i.indexrelid) INTO v_definition
  FROM pg_catalog.pg_index AS i
  WHERE i.indexrelid = to_regclass('public.ai_jobs_one_active_prescription_analysis_uq');

  IF v_definition IS NULL THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX ai_jobs_one_active_prescription_analysis_uq
      ON public.ai_jobs (prescription_id, job_type)
      WHERE prescription_id IS NOT NULL
        AND job_type = 'prescription_analysis'
        AND status IN ('queued', 'processing')
    $sql$;
  ELSIF v_definition NOT LIKE 'CREATE UNIQUE INDEX ai_jobs_one_active_prescription_analysis_uq%'
     OR v_definition NOT LIKE '%(prescription_id, job_type)%'
     OR v_definition NOT LIKE '%status = ANY%queued%processing%' THEN
    RAISE EXCEPTION 'existing active-job index has an incompatible definition';
  END IF;
END
$index_guard$;

CREATE OR REPLACE FUNCTION public.submit_prescription_analysis_job_v1(
  p_prescription_id uuid,
  p_requested_analysis jsonb
)
RETURNS TABLE (
  job_id uuid,
  prescription_id uuid,
  job_status text,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_user_id uuid := auth.uid();
  v_prescription public.prescriptions%ROWTYPE;
  v_job public.ai_jobs%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'authentication required';
  END IF;

  IF p_prescription_id IS NULL
     OR p_requested_analysis IS NULL
     OR jsonb_typeof(p_requested_analysis) IS DISTINCT FROM 'object'
     OR p_requested_analysis IS DISTINCT FROM jsonb_build_object(
       'extract_prescription', true,
       'match_medicines', true,
       'find_alternatives', false,
       'generate_recommendations', true
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid processing request';
  END IF;

  SELECT p.* INTO v_prescription
  FROM public.prescriptions AS p
  WHERE p.id = p_prescription_id AND p.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'prescription not found';
  END IF;

  IF v_prescription.storage_provider IS DISTINCT FROM 'aws_s3'
     OR nullif(btrim(v_prescription.storage_bucket), '') IS NULL
     OR nullif(btrim(v_prescription.object_key), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'prescription not processable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.prescription_intelligence_results AS r
    WHERE r.prescription_id = p_prescription_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'result already exists';
  END IF;

  SELECT j.* INTO v_job
  FROM public.ai_jobs AS j
  WHERE j.prescription_id = p_prescription_id
    AND j.user_id = v_user_id
    AND j.job_type = 'prescription_analysis'
    AND j.status IN ('queued', 'processing')
  ORDER BY j.created_at, j.id
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_job.id, v_job.prescription_id, v_job.status, false;
    RETURN;
  END IF;

  IF v_prescription.status NOT IN ('uploaded', 'failed') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'prescription lifecycle is incompatible';
  END IF;

  INSERT INTO public.ai_jobs (
    user_id, prescription_id, job_type, status, input_reference
  ) VALUES (
    v_user_id,
    p_prescription_id,
    'prescription_analysis',
    'queued',
    jsonb_build_object(
      'requested_analysis', p_requested_analysis,
      'contract_version', '1.0'
    )
  )
  ON CONFLICT (prescription_id, job_type)
    WHERE prescription_id IS NOT NULL
      AND job_type = 'prescription_analysis'
      AND status IN ('queued', 'processing')
  DO NOTHING
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    SELECT j.* INTO STRICT v_job
    FROM public.ai_jobs AS j
    WHERE j.prescription_id = p_prescription_id
      AND j.user_id = v_user_id
      AND j.job_type = 'prescription_analysis'
      AND j.status IN ('queued', 'processing')
    ORDER BY j.created_at, j.id
    LIMIT 1;

    RETURN QUERY SELECT v_job.id, v_job.prescription_id, v_job.status, false;
    RETURN;
  END IF;

  UPDATE public.prescriptions AS p
  SET status = 'queued'
  WHERE p.id = p_prescription_id AND p.user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'prescription disappeared during submission';
  END IF;

  RETURN QUERY SELECT v_job.id, v_job.prescription_id, v_job.status, true;
END
$function$;

ALTER FUNCTION public.submit_prescription_analysis_job_v1(uuid, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.submit_prescription_analysis_job_v1(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_prescription_analysis_job_v1(uuid, jsonb)
  TO authenticated;

REVOKE INSERT ON TABLE public.ai_jobs FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_prescription_analysis_status_v1(
  p_prescription_id uuid
)
RETURNS TABLE (
  prescription_id uuid,
  job_id uuid,
  job_status text,
  created_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT
    p.id,
    j.id,
    j.status,
    j.created_at,
    j.started_at,
    j.completed_at
  FROM public.prescriptions AS p
  LEFT JOIN LATERAL (
    SELECT candidate.*
    FROM public.ai_jobs AS candidate
    WHERE candidate.prescription_id = p.id
      AND candidate.user_id = auth.uid()
      AND candidate.job_type = 'prescription_analysis'
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT 1
  ) AS j ON true
  WHERE p.id = p_prescription_id
    AND p.user_id = auth.uid();
$function$;

ALTER FUNCTION public.get_prescription_analysis_status_v1(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_prescription_analysis_status_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prescription_analysis_status_v1(uuid)
  TO authenticated;

DO $deployment_assertions$
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
$deployment_assertions$;

COMMIT;
