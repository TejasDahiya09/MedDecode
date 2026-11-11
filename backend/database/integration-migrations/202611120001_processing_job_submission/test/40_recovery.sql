\set ON_ERROR_STOP on
\set meddecode_recovery_approved true

SELECT count(*) AS baseline_ai_jobs_count
FROM public.ai_jobs
\gset

SELECT
  count(*) AS baseline_result_count,
  md5(coalesce(string_agg(
    concat_ws('|', r.id::text, r.prescription_id::text,
      coalesce(r.job_id::text, '<null>')),
    E'\n' ORDER BY r.id
  ), '')) AS baseline_result_identity_fingerprint
FROM public.prescription_intelligence_results AS r
\gset

SELECT
  count(*) AS baseline_prescription_count,
  md5(coalesce(string_agg(
    concat_ws('|', p.id::text, p.status),
    E'\n' ORDER BY p.id
  ), '')) AS baseline_prescription_status_fingerprint
FROM public.prescriptions AS p
\gset

\ir ../004_recovery.sql
\ir ../005_recovery_verify.sql
