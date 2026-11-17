# Migration 010 hosted deployment record

## Scope

On 2026-11-15, the reviewed Migration 010 initial-review completion RPC was
deployed to Supabase project `wyripeqruhvbksjfsvlr`, database `postgres`. This
record covers only that migration. It does not authorize or record a Generation
2 activation, worker start, feature-flag change, job claim, or prescription
processing operation.

## Immutable candidate checks

| File | SHA-256 |
| --- | --- |
| `001_preflight.sql` | `A36CA68F392257411A8BC533E7FD3DFC4F654C625CF0D83E4C71117CDC6A22D6` |
| `002_up.sql` | `B7891E4FF9D75EEF9C3A656ECFCA8FB751777085146D60F56B127E7A813D98E6` |
| `003_verify.sql` | `A7981947F806B8E4BF65E2D15A3948ADD69CD2FE317E9589F3ADC2CE17B9DC56` |
| `004_rollback_review.sql` | `5EAD68D40A92CB1B339FEFECF5DF254CFB348F10179B4271441B536EF2FC5D25D` |

The five-argument RPC signature is
`public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)`.
The local PostgreSQL 17 security report remains
`prescription-review-phase-1l-migration-010-final-security-report.md`.

## Recovery point

A new protected `pg_dump` custom archive was created before deployment:

- UTC timestamp: `20261115T230606Z`
- Archive: `C:\Users\dahiy\MedDecode-Backups\migration-010-preflight-20261115T230606Z\meddecode-public-auth-current.dump`
- Size: 958,040 bytes
- SHA-256: `8FE4DF6F6C846E7EC29B66F6DAF2BABF75EF83E2338E57DBC94E8D233ABCD657`

The archive was restored into a disposable PostgreSQL 17 UTF-8 database using
local no-login placeholder roles solely to replay Supabase ACL references.
Source and restored aggregates matched: 6 prescriptions, 7 jobs, 2
intelligence results, 0 review revisions, 1 admission, and 2 scopes.
Representative Migrations 001--003 RPCs and the deployed official catalogue
page RPC were present; Migration 010 was absent in the restore as expected.
RLS and ACL metadata restored. The disposable database was dropped and the
private cluster stopped.

The archive does not recover Supabase global roles/memberships, executable
ownership or ACL replay on a different server, Supabase platform configuration,
Auth service state, S3 objects, or external infrastructure.

## Hosted gates and execution

The configured administrative service reached the expected project pooler with
TLS 1.3 (`TLS_AES_256_GCM_SHA384`), database `postgres`, and database role
`postgres`. The exact read-only preflight returned
`PRESCRIPTION_REVIEW_INITIAL_COMPLETION_PREFLIGHT_OK`.

Immediately before execution, all four hashes and the fresh archive hash were
rechecked. `002_up.sql` was executed once and committed at
`2026-11-15T23:11:07.5173847Z`. Its independent verifier returned
`PRESCRIPTION_REVIEW_INITIAL_COMPLETION_VERIFY_OK`.

## Before/after aggregate evidence

Both snapshots were: 6 prescriptions, 7 jobs, 2 intelligence results, 1
automatic admission, and 2 scopes. Generation 1 retained one admission;
Generation 2 retained zero admissions and was disabled. There were zero
claimable automatic scopes, worker sessions, active leases, and relevant locks.

## Security verification

- Function owner: `postgres`; `SECURITY DEFINER`: true; fixed search path: true.
- `meddecode_scoped_worker` has EXECUTE; `anon` and `authenticated` do not.
- The restricted worker has no direct DML on `public.ai_jobs`.
- Existing V3 review RPCs remained present.
- No job was claimed, no prescription was processed, and no intelligence result
  was created by this deployment.

## Remaining boundary

Generation 2 activation, automatic submission, worker credentials/loading,
worker startup, any feature flags, and a fictional workflow test each require
separate explicit approval. Do not run `004_rollback_review.sql` automatically.
