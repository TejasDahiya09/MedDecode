// Local artifact generator. Reads reviewed SQL; never opens a database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../database/integration-migrations');
const target = path.join(root, '202611160013_exact_job_recovery_v1');
const original = fs.readFileSync(path.join(root, '202611160010_prescription_review_initial_completion_v1/002_up.sql'), 'utf8').replaceAll('\r', '');
const initializer = original.match(/CREATE OR REPLACE FUNCTION public\.meddecode_initialize_prescription_review_v1\([\s\S]*?END \$fn\$;/)[0];
const body = initializer.match(/AS \$fn\$([\s\S]*)\$fn\$;/)[1];
const hash = crypto.createHash('sha256').update(body).digest('hex');
const core = initializer.replace('meddecode_initialize_prescription_review_v1(', 'meddecode_initialize_retry_review_core_v1(');
// Recheck AFTER locking the job: a call that began before authorization must
// see a permit committed while it was waiting for that same job lock.
const guarded = initializer.replace("IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found'; END IF;",
  "IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found'; END IF;\n  IF EXISTS (SELECT 1 FROM public.meddecode_exact_job_retry_permits WHERE job_id=p_job_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='exact retry initializer required'; END IF;");
const scoped = fs.readFileSync(path.join(root, '../scoped-worker-isolation-review.sql'), 'utf8').replaceAll('\r', '');
const extract = (source, name, delimiter) => source.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?END\\s+\\$${delimiter}\\$;`))[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
const claim = extract(scoped, 'meddecode_scoped_claim_next_prescription_analysis_job_v1', 'function');
const recovery = extract(scoped, 'meddecode_scoped_recover_expired_prescription_analysis_jobs_v1', 'function');
const automatic = fs.readFileSync(path.join(root, '202611160008_automatic_rollout_generation_v1/002_up.sql'), 'utf8').replaceAll('\r', '');
const issuer = extract(automatic, 'meddecode_scoped_authorize_next_automatic_job_v1', 'fn');
const digest = source => crypto.createHash('sha256').update(source.match(/AS \$(?:fn|function)\$([\s\S]*)\$(?:fn|function)\$;/)[1]).digest('hex');
const excludes = source => source.replace("WHERE j.job_type = 'prescription_analysis'", "WHERE NOT EXISTS (SELECT 1 FROM public.meddecode_exact_job_retry_permits r WHERE r.job_id=j.id) AND j.job_type = 'prescription_analysis'");
const guardedIssuer = issuer.replace('WHERE a.rollout_generation=v_policy.current_rollout_generation AND j.job_type=', 'WHERE NOT EXISTS(SELECT 1 FROM public.meddecode_exact_job_retry_permits r WHERE r.job_id=j.id) AND a.rollout_generation=v_policy.current_rollout_generation AND j.job_type=');
let preflight = fs.readFileSync(path.join(target, 'preflight.template.sql'), 'utf8')
  .replaceAll('INITIALIZER_SOURCE_SHA256', hash).replaceAll('CLAIM_SOURCE_SHA256', digest(claim))
  .replaceAll('RECOVERY_SOURCE_SHA256', digest(recovery)).replaceAll('ISSUER_SOURCE_SHA256', digest(issuer));
fs.writeFileSync(path.join(target, '001_preflight.sql'), preflight);
const guard = preflight.match(/DO \$guard\$[\s\S]*?END \$guard\$;/)[0];
const template = fs.readFileSync(path.join(target, 'migration.template.sql'), 'utf8');
const up = template.replace('-- DEPLOYMENT_PREFLIGHT_GUARD', () => guard)
  .replace('-- INSERT_REVIEWED_INITIALIZER_COPIES', () => `${core}\n${guarded}\n${excludes(claim)}\n${excludes(recovery)}\n${guardedIssuer}`);
fs.writeFileSync(path.join(target, '002_up.sql'), up);
const functions = [...up.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\(([\s\S]*?)\)\s*RETURNS[\s\S]*?AS \$(fn|function)\$([\s\S]*?)\$\3\$;/g)]
  .map(m => ({ name: m[1], hash: crypto.createHash('sha256').update(m[4]).digest('hex') }));
const verify = fs.readFileSync(path.join(target, 'verify.template.sql'), 'utf8');
fs.writeFileSync(path.join(target, '003_verify.sql'), verify.replace('-- EXPECTED_FUNCTION_BODIES',
  functions.map(f => `('${f.name}','${f.hash}')`).join(',\n')));
fs.writeFileSync(path.join(target, '004_rollback_review.sql'), `\\set ON_ERROR_STOP on
-- REVIEW ONLY. Separate approval required; never deletes permit audit records.
BEGIN;
SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN IF current_setting('meddecode.exact_retry_rollback_review',true) IS DISTINCT FROM 'approved'
 OR session_user<>'postgres' OR current_user<>'postgres' OR EXISTS(SELECT 1 FROM public.meddecode_exact_job_retry_permits)
 THEN RAISE EXCEPTION 'rollback blocked: authorization or retained audit history'; END IF; END $guard$;
${initializer}\n${claim}\n${recovery}\n${issuer}
DROP FUNCTION public.meddecode_initialize_exact_retry_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,integer,bigint,uuid);
DROP FUNCTION public.meddecode_initialize_retry_review_core_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb);
DROP FUNCTION public.meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer);
DROP FUNCTION public.meddecode_authorize_exact_job_retry_v1(uuid,uuid,integer,bigint);
DROP TABLE public.meddecode_exact_job_retry_permits;
COMMIT;
`);
console.log('EXACT_RETRY_SQL_GENERATED');
