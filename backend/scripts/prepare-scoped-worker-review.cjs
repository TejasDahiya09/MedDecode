// Generates a review-only SQL candidate from the existing worker contracts.
// This script never connects to a database or changes the original migrations.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const originalClaim = fs.readFileSync(path.join(root, 'database/integration-migrations/202611120002_processing_worker_claim_heartbeat/002_up.sql'), 'utf8');
const originalFinal = fs.readFileSync(path.join(root, 'database/integration-migrations/202611120003_processing_worker_finalization_recovery/002_up.sql'), 'utf8');
const names = ['claim_next_prescription_analysis_job_v1', 'heartbeat_prescription_analysis_job_v1', 'complete_prescription_analysis_job_v1', 'fail_prescription_analysis_job_v1', 'recover_expired_prescription_analysis_jobs_v1'];
function once(text, before, after) {
  if (text.split(before).length !== 2) throw new Error('Source migration shape changed; manual review is required.');
  return text.replace(before, after);
}
function extract(source, name) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = source.indexOf('$function$;', start);
  if (start < 0 || end < 0) throw new Error('Required source function missing.');
  let sql = source.slice(start, end + '$function$;'.length);
  sql = once(sql, `CREATE OR REPLACE FUNCTION public.${name}(`, `CREATE FUNCTION public.meddecode_scoped_${name}(`);
  return once(sql, "current_setting('role', true) IS DISTINCT FROM 'meddecode_worker'", "current_setting('role', true) IS DISTINCT FROM 'meddecode_scoped_worker'");
}
const funcs = names.map((name, i) => extract(i < 2 ? originalClaim : originalFinal, name));
funcs[0] = once(funcs[0], "  WHERE j.job_type = 'prescription_analysis' AND j.status = 'queued'", `  JOIN public.meddecode_scoped_worker_scope AS scope ON scope.job_id = j.id
    AND scope.prescription_id = j.prescription_id AND scope.user_id = j.user_id
    AND scope.worker_instance_id = p_worker_instance_id AND scope.enabled
    AND scope.expires_at > clock_timestamp()
  WHERE j.job_type = 'prescription_analysis' AND j.status = 'queued'`);
funcs[0] = once(funcs[0], 'FOR UPDATE OF j SKIP LOCKED LIMIT 1;', 'FOR UPDATE OF j, scope SKIP LOCKED LIMIT 1;');
const authorization = (extra = '') => `  PERFORM 1 FROM public.meddecode_scoped_worker_scope AS scope
   WHERE scope.job_id = p_job_id ${extra}
     AND scope.worker_instance_id = p_worker_instance_id AND scope.enabled
     AND scope.expires_at > clock_timestamp()
     AND EXISTS (SELECT 1 FROM public.ai_jobs AS scoped_job WHERE scoped_job.id = scope.job_id
       AND scoped_job.user_id = scope.user_id AND scoped_job.prescription_id = scope.prescription_id)
     FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'scoped worker authorization required'; END IF;
`;
funcs[1] = once(funcs[1], '  RETURN QUERY UPDATE public.ai_jobs AS j', `${authorization()}  RETURN QUERY UPDATE public.ai_jobs AS j`);
for (const i of [2, 3]) funcs[i] = once(funcs[i], '  SELECT j.* INTO v_job FROM public.ai_jobs AS j WHERE j.id = p_job_id FOR UPDATE;', `${authorization('AND scope.prescription_id = p_prescription_id')}  SELECT j.* INTO v_job FROM public.ai_jobs AS j WHERE j.id = p_job_id FOR UPDATE;`);
funcs[4] = once(funcs[4], "  FOR v_job IN SELECT j.* FROM public.ai_jobs AS j\n    WHERE j.job_type = 'prescription_analysis'", `  FOR v_job IN SELECT j.* FROM public.ai_jobs AS j
    JOIN public.meddecode_scoped_worker_scope AS scope ON scope.job_id = j.id
      AND scope.prescription_id = j.prescription_id AND scope.user_id = j.user_id
      AND scope.worker_instance_id = j.lease_owner AND scope.enabled AND scope.expires_at > clock_timestamp()
    WHERE j.job_type = 'prescription_analysis'`);
funcs[4] = once(funcs[4], 'FOR UPDATE SKIP LOCKED LIMIT p_limit', 'FOR UPDATE OF j, scope SKIP LOCKED LIMIT p_limit');

const recheck = (job, instance, onFailure = "RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'scoped worker authorization required'") => `  IF NOT EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope AS scope
    WHERE scope.job_id = ${job} AND scope.worker_instance_id = ${instance}
      AND scope.enabled AND scope.expires_at > clock_timestamp()) THEN
    ${onFailure};
  END IF;
`;
funcs[0] = once(funcs[0], "  UPDATE public.ai_jobs AS j\n  SET status = 'processing'", recheck('v_job.id', 'p_worker_instance_id') + "  UPDATE public.ai_jobs AS j\n  SET status = 'processing'");
funcs[1] = once(funcs[1], '  RETURN QUERY UPDATE public.ai_jobs AS j', '  PERFORM 1 FROM public.ai_jobs AS j WHERE j.id = p_job_id FOR UPDATE;\n' + recheck('p_job_id', 'p_worker_instance_id') + '  RETURN QUERY UPDATE public.ai_jobs AS j');
funcs[2] = once(funcs[2], '  v_existing public.prescription_intelligence_results%ROWTYPE;', '  v_existing public.prescription_intelligence_results%ROWTYPE;\n  v_existing_found boolean;');
funcs[2] = once(funcs[2], '  -- An identical completion replay is safe', '  v_existing_found := FOUND;\n' + recheck('p_job_id', 'p_worker_instance_id') + '  -- An identical completion replay is safe');
funcs[2] = once(funcs[2], '  IF FOUND THEN\n    IF v_existing.job_id', '  IF v_existing_found THEN\n    IF v_existing.job_id');
funcs[3] = once(funcs[3], '  IF EXISTS (SELECT 1 FROM public.prescription_intelligence_results AS r WHERE r.prescription_id = p_prescription_id) THEN', recheck('p_job_id', 'p_worker_instance_id') + '  IF EXISTS (SELECT 1 FROM public.prescription_intelligence_results AS r WHERE r.prescription_id = p_prescription_id) THEN');
funcs[4] = once(funcs[4], '    IF v_job.attempt_count < v_job.max_attempts THEN', recheck('v_job.id', 'v_job.lease_owner', 'CONTINUE') + '    IF v_job.attempt_count < v_job.max_attempts THEN');
// Bind every scope to the actual database login; worker_instance_id alone is caller supplied.
for (let i = 0; i < funcs.length; i++) funcs[i] = funcs[i].replaceAll('scope.worker_instance_id =', 'scope.worker_login = session_user AND scope.worker_instance_id =');
const signatures = ['text, integer', 'uuid, text, bigint, integer', 'uuid, uuid, text, bigint, jsonb', 'uuid, uuid, text, bigint, text, boolean, text, timestamptz', 'integer'];
const grants = names.map((n, i) => `REVOKE ALL ON FUNCTION public.meddecode_scoped_${n}(${signatures[i]}) FROM PUBLIC, anon, authenticated, meddecode_worker;\nGRANT EXECUTE ON FUNCTION public.meddecode_scoped_${n}(${signatures[i]}) TO meddecode_scoped_worker;`).join('\n');
const output = `-- REVIEW ONLY. NOT TESTED OR APPROVED FOR DEPLOYMENT.\n\\set ON_ERROR_STOP on\nBEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='60s';\n` +
`CREATE TABLE public.meddecode_scoped_worker_scope (job_id uuid PRIMARY KEY REFERENCES public.ai_jobs(id), prescription_id uuid NOT NULL REFERENCES public.prescriptions(id), user_id uuid NOT NULL REFERENCES public.users(id), worker_login name NOT NULL, worker_instance_id text NOT NULL CHECK (length(btrim(worker_instance_id)) BETWEEN 8 AND 128 AND worker_instance_id ~ '^[A-Za-z0-9._:-]+$'), enabled boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL);\nALTER TABLE public.meddecode_scoped_worker_scope ENABLE ROW LEVEL SECURITY;\nREVOKE ALL ON public.meddecode_scoped_worker_scope FROM PUBLIC, anon, authenticated, meddecode_worker, meddecode_scoped_worker;\n` + funcs.join('\n\n') + '\n' + grants + '\nCOMMIT;\n';
const destination = path.join(root, 'database', 'scoped-worker-isolation-review.sql');
if (process.argv.includes('--verify')) { if (fs.readFileSync(destination, 'utf8') !== output) throw new Error('Candidate differs from generated SQL'); console.log('Candidate verified'); process.exit(0); }
if (!process.argv.includes('--replace-review') && fs.existsSync(destination)) throw new Error('Review SQL already exists; refusing to overwrite.');
fs.writeFileSync(destination, output, { flag: process.argv.includes('--replace-review') ? 'w' : 'wx' });
console.log('Wrote review-only candidate; no database connection was made.');
