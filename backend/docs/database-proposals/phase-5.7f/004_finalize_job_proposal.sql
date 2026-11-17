/*
NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED

Atomic finalization DESIGN. The privileged interface accepts exactly one
authoritative Contract v1 result. It does not accept caller-supplied projection
arrays, error JSON, or prescription patches. Trusted versioned helpers must
validate the canonical result and derive every relational projection from it.
Those helpers are design requirements, not implemented guarantees.

BLOCKED BEFORE SQL IMPLEMENTATION
- Implement and independently review private.validate_contract_v1_result_v1.
- Implement and review private.derive_contract_v1_projections_v1.
- Implement and review private.verify_contract_v1_persistence_v1, including
  exact projection cardinality, order, values, versions, and status semantics.
- Prove hosted function ownership/authorization and payload limits.
- Resolve exact optional-field handling: Contract v1 permits unknown optional
  fields, but they remain raw-only and must never affect known projections.

BEGIN;

CREATE OR REPLACE FUNCTION public.finalize_prescription_analysis_job_v1(
    p_job_id uuid,
    p_prescription_id uuid,
    p_worker_instance_id text,
    p_claim_generation bigint,
    p_result_json jsonb
)
RETURNS TABLE (job_id uuid, prescription_id uuid, result_status text, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
    v_job public.ai_jobs%ROWTYPE;
    v_prescription public.prescriptions%ROWTYPE;
    v_existing public.prescription_intelligence_results%ROWTYPE;
    v_result_id uuid;
    v_status text;
    v_terminal_job_status text;
    v_error jsonb;
    v_projection jsonb;
    v_prescription_count integer;
    v_finalized_at timestamptz := clock_timestamp();
BEGIN
    PERFORM private.assert_meddecode_worker_authorized();

    -- SQL NULL and JSON null are rejected explicitly. The validator must check
    -- required top-level keys, exact known field types, nullable semantics,
    -- UUID correlation, status/error correlation, confidence ranges, sequence
    -- ordering, medicine-match semantics, warnings, and grounded size/count
    -- limits. Unknown optional fields may remain only in immutable raw JSON.
    IF p_result_json IS NULL OR p_result_json = 'null'::jsonb
       OR jsonb_typeof(p_result_json) IS DISTINCT FROM 'object'
       OR octet_length(p_result_json::text) > 2097152 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid result payload';
    END IF;
    PERFORM private.validate_contract_v1_result_v1(
      p_result_json, p_job_id, p_prescription_id
    );

    v_status := p_result_json->>'status';
    v_terminal_job_status := CASE WHEN v_status = 'failed'
                                  THEN 'failed' ELSE 'completed' END;
    v_error := CASE WHEN v_status = 'failed' THEN p_result_json->'error' ELSE NULL END;

    -- Alternatives remain disabled for successful results. The authoritative PDF uses
    -- ingredient_equivalence while current TypeScript uses
    -- ingredient_equivalent. No alternative is persisted until an approved
    -- contract erratum resolves the discrepancy.
    IF v_status <> 'failed'
       AND jsonb_path_exists(p_result_json, '$.medicines[*].alternatives[*]') THEN
      RAISE EXCEPTION USING ERRCODE = '0A000', MESSAGE = 'alternatives persistence disabled';
    END IF;

    SELECT j.* INTO v_job FROM public.ai_jobs AS j
     WHERE j.id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'job not found';
    END IF;
    IF v_job.job_type <> 'prescription_analysis'
       OR v_job.prescription_id IS DISTINCT FROM p_prescription_id THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'job correlation mismatch';
    END IF;

    SELECT p.* INTO v_prescription FROM public.prescriptions AS p
     WHERE p.id = p_prescription_id FOR UPDATE;
    IF NOT FOUND OR v_prescription.user_id IS DISTINCT FROM v_job.user_id THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ownership mismatch';
    END IF;

    SELECT r.* INTO v_existing
      FROM public.prescription_intelligence_results AS r
     WHERE r.prescription_id = p_prescription_id FOR UPDATE;

    -- Raw JSON equality is necessary but not sufficient for replay. A trusted
    -- verifier must prove that the raw row, terminal job/prescription status,
    -- projection counts/order/values, and stored schema/model/dataset versions
    -- are the deterministic representation of this exact canonical result.
    -- This function never repairs missing/corrupt projections. Repair requires
    -- a separately authorized interface and operator-visible audit trail.
    IF FOUND THEN
      IF v_existing.job_id = p_job_id
         AND v_existing.schema_version = '1.0'
         AND v_existing.status = v_status
         AND v_existing.result_json = p_result_json
         AND v_job.status = v_terminal_job_status
         AND private.verify_contract_v1_persistence_v1(
               p_prescription_id, v_existing.id, p_result_json
             ) THEN
        RETURN QUERY SELECT p_job_id, p_prescription_id, v_status, true;
        RETURN;
      END IF;
      RAISE EXCEPTION USING ERRCODE = '23505',
        MESSAGE = 'conflicting or incomplete persisted result';
    END IF;

    IF v_job.status <> 'processing'
       OR v_job.lease_owner IS DISTINCT FROM p_worker_instance_id
       OR v_job.claim_generation IS DISTINCT FROM p_claim_generation
       OR v_job.lease_expires_at IS NULL
       OR v_job.lease_expires_at <= v_finalized_at THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'stale or expired claim';
    END IF;

    IF EXISTS (SELECT 1 FROM public.prescription_medicines
                WHERE prescription_id = p_prescription_id)
       OR EXISTS (SELECT 1 FROM public.prescription_recommendations
                   WHERE prescription_id = p_prescription_id)
       OR EXISTS (SELECT 1 FROM public.prescription_warnings
                   WHERE prescription_id = p_prescription_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'existing projections conflict';
    END IF;

    INSERT INTO public.prescription_intelligence_results (
      prescription_id, job_id, schema_version, status, result_json, error_json
    ) VALUES (
      p_prescription_id, p_job_id, '1.0', v_status, p_result_json, v_error
    ) RETURNING id INTO v_result_id;

    IF v_status = 'failed' THEN
      -- Contract v1 failures contain only correlation fields and error. Store
      -- the canonical failure/error, write no success projections, and mark
      -- only the owned prescription lifecycle state as failed.
      UPDATE public.prescriptions AS p
         SET status = 'failed', intelligence_schema_version = '1.0',
             processed_at = v_finalized_at
       WHERE p.id = p_prescription_id AND p.user_id = v_job.user_id;
      GET DIAGNOSTICS v_prescription_count = ROW_COUNT;
      IF v_prescription_count <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'job lineage invalid';
      END IF;
    ELSE
      -- Successful statuses require the full Contract v1 success envelope.
      -- The helper derives only known fields, preserves contract nulls/empty
      -- arrays/order, and never fabricates internal medicine identities.
      v_projection := private.derive_contract_v1_projections_v1(p_result_json);
      IF v_projection IS NULL
         OR jsonb_typeof(v_projection) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'projection derivation failed';
      END IF;

      -- DESIGN PLACEHOLDERS: exact mappings consume only v_projection.
      -- medicine_id remains NULL; medicine_external_id stays in canonical JSON
      -- until a separately approved mapping authority exists.
      PERFORM private.insert_contract_v1_medicine_projections_v1(
        p_prescription_id, v_projection->'medicines'
      );
      PERFORM private.insert_contract_v1_recommendation_projections_v1(
        p_prescription_id, v_projection->'recommendations'
      );
      PERFORM private.insert_contract_v1_warning_projections_v1(
        p_prescription_id, v_projection->'warnings'
      );
      PERFORM private.apply_contract_v1_prescription_projection_v1(
        p_prescription_id, v_job.user_id, v_projection, v_finalized_at
      );
    END IF;

    UPDATE public.ai_jobs AS j
       SET status = v_terminal_job_status,
           result_reference = jsonb_build_object(
             'result_id', v_result_id, 'schema_version', '1.0'
           ),
           error_message = CASE WHEN v_status = 'failed'
             THEN left(coalesce(v_error->>'code', 'PROCESSING_FAILED'), 128)
             ELSE NULL END,
           lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
           completed_at = v_finalized_at, updated_at = v_finalized_at
     WHERE j.id = p_job_id AND j.status = 'processing'
       AND j.claim_generation = p_claim_generation;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'stale finalization';
    END IF;

    RETURN QUERY SELECT p_job_id, p_prescription_id, v_status, false;
END;
$function$;

-- All helper definitions, integrity/repair interfaces, owner changes, revokes,
-- and grants remain BLOCKED.
-- This draft demonstrates the single-input boundary; it is not compilable or
-- executable until every helper is independently designed and reviewed.

COMMIT;
END OF INERT PROPOSAL
*/
