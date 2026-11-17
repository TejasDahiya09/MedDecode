# Canonical Validation and Projection Helper Contract

> **NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED**

This is a design interface, not an implemented SQL helper. Contract v1 PDF is
authoritative; current TypeScript code is implementation evidence only.

## Canonical validator interface

Proposed signature:

`private.validate_contract_v1_result_v1(result_json, expected_job_id, expected_prescription_id)`

It must reject SQL NULL, JSON `null`, non-object JSON, schema versions other
than `1.0`, non-UUID/mismatched correlation IDs, and statuses outside
`completed`, `completed_with_warnings`, and `failed`.

For `failed`, the stable envelope is the version/correlation/status fields plus
`error.code`, non-empty human-readable `error.message`, and boolean
`error.retryable`. Allowed codes are `UNSUPPORTED_FILE`,
`DOCUMENT_ACCESS_FAILED`, `INVALID_REQUEST`, and `PROCESSING_FAILED`. A failure
must not be interpreted as a success envelope or create success projections.
Known success keys (`prescription`, `patient`, `medicines`, `recommendations`,
`warnings`, `processing_metadata`) are contradictory on `failed` and must be
rejected. This does not prohibit genuinely new optional fields introduced by a
backward-compatible Contract v1 update; those remain raw-only.

For either successful status, require objects `prescription`, `patient`, and
`processing_metadata`, plus arrays `medicines`, `recommendations`, and
`warnings`. Stable nested objects remain objects even when their values are
unavailable. Missing scalar clinical values use JSON null; empty collections
use `[]`. Never convert missing data to `Unknown`, `N/A`, zero, false, or a
medicine identity.

Medicine `sequence_number` is a positive integer ordered contiguously from 1.
Frequency type is `scheduled`, `as_needed`, or `unknown`; match status is
`matched`, `probable_match`, `ambiguous`, `unmatched`, or `not_attempted`;
warning severity is `info`, `low`, `medium`, or `high`. Every confidence is a
finite number in `[0,1]` or JSON null where the contract permits null.
Recommendation/warning related sequence numbers are positive integers or null.
`medicine_external_id` is Member 1-owned and must never be coerced into the
internal `medicine_id` UUID.

Accepted stable success names are:

- `prescription.prescription_date`; `prescription.doctor.name` and
  `registration_number`; `prescription.facility.name`, `address`, and `phone`;
- `patient.name`, `age`, and `gender`;
- per medicine: `sequence_number`, `extraction`, `confidence`,
  `medicine_match`, `derived`, and `alternatives`;
- extraction: `raw_text`, optional/null-capable medicine name, normalized name,
  strength, dosage form, frequency, timing, duration, quantity, instructions;
- medicine match: `status`, `confidence`, `medicine_external_id`, `brand_name`,
  `dosage_form`, and `ingredients` (`name`, `strength_value`, `strength_unit`);
- derived: `units_per_day`, `estimated_total_units`;
- recommendation: `type`, `title`, `message`,
  `related_medicine_sequence_number`, `confidence`;
- warning: `code`, `severity`, `message`,
  `related_medicine_sequence_number`;
- metadata: `overall_confidence` plus optional `dataset_version` and
  `model_version` when available.

Unknown backward-compatible optional fields may remain in immutable raw JSON,
but cannot alter known projections. Non-empty alternatives remain rejected:
the PDF says `ingredient_equivalence`, while current TypeScript validates
`ingredient_equivalent`. Resolution requires an approved erratum/new version.

## Deterministic success projection interface

Proposed signature:

`private.derive_contract_v1_projections_v1(validated_success_json)`

It accepts only a validated successful envelope and returns a bounded object
with `prescription`, `medicines`, `recommendations`, and `warnings`. Projection
order follows canonical array order. No independent caller arrays are allowed.
The current TypeScript mapper provides the required column correspondence:

- `public.prescriptions`: `status`, `prescription_date`, `doctor_name`,
  `doctor_registration_number`, `facility_name`, `facility_address`,
  `facility_phone`, `patient_name`, `patient_age`, `patient_gender`,
  `intelligence_schema_version`, optional `intelligence_dataset_version`,
  optional `intelligence_model_version`, `overall_confidence`, `processed_at`.
- `public.prescription_medicines`: `prescription_id`, `sequence_number`,
  `raw_text`, `medicine_name`, `medicine_name_normalized`, `strength_value`,
  `strength_unit`, `dosage_form`, `frequency_type`, `frequency_morning`,
  `frequency_afternoon`, `frequency_night`, `frequency_times_per_day`,
  `timing`, `duration_value`, `duration_unit`, `quantity_value`,
  `quantity_unit`, `instructions`, `extraction_confidence`,
  `medicine_name_confidence`, `dosage_confidence`, `match_status`,
  `match_confidence`, `units_per_day`, `estimated_total_units`.
- `public.prescription_recommendations`: `prescription_id`, `type`, `title`,
  `message`, `related_medicine_sequence_number`, `confidence`.
- `public.prescription_warnings`: `prescription_id`, `code`, `severity`,
  `message`, `related_medicine_sequence_number`.
- `public.prescription_intelligence_results`: `prescription_id`, `job_id`,
  `schema_version`, `status`, immutable `result_json`, and structured
  `error_json` (null on success).

The historical schema has no normalized columns for `medicine_external_id`,
matched brand/form/ingredients. These remain raw-only. `medicine_id` remains
NULL unless a separately approved authority maps an external ID to a verified
internal UUID. Alternatives writes remain disabled.

## Failure persistence interface

A validated failure writes the canonical result and `error_json`, transitions
the owned prescription to `failed`, and transitions `ai_jobs` to `failed` in
the same transaction. It does not invoke success derivation/insertion helpers.

## Replay integrity interface

Proposed signature:

`private.verify_contract_v1_persistence_v1(prescription_id, result_id, canonical_json)`

For failure, verify the raw/error row, failed job/prescription state, schema
version, and zero success projections. For success, rederive the expected
projection and compare exact row counts, sequence/order keys, nullable values,
known scalar values, status, schema/model/dataset versions, and terminal
job/prescription state. A verified identical replay may return success. Any
raw conflict or incomplete/extra/reordered/value/version mismatch is an
integrity conflict. Verification never changes data.

A repair interface is intentionally undefined. Repair requires separate
authorization, a recorded integrity diagnosis, deterministic replacement
scope, concurrency/fencing rules, and operator-visible audit evidence.

## BLOCKED limits and questions

- Grounded maximum JSON bytes, array counts, text lengths, and numeric bounds
  beyond database/Contract constraints are not specified by Contract v1.
- Hosted Supabase owner/role/private-schema/grant feasibility is unproven.
- Exact SQL helper bodies and compilation are unreviewed.
- The alternatives spelling conflict is unresolved.
- Unknown optional-field retention duration and raw-result size policy require
  approval.
- Projection-version storage beyond schema/dataset/model fields has no approved
  database column; the integrity verifier must not invent one.
