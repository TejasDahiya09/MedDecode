# Security and Least-Privilege Review

> **NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED**

## Recommended worker trust model

Use a backend-mediated model: Python authenticates to a private Node interface;
Node verifies a rotated internal credential and invokes narrowly granted RPCs.
Python receives neither the Supabase secret/service-role key nor direct table
DML. This fits the existing Node ownership boundary and keeps database access
in Member 2.

The database identity used by Node remains **BLOCKED**. Hosted Supabase support
for a custom execution role, role claim, direct restricted login, ownership
changes, and pooler behavior must be proven in an isolated project.

Rejected as defaults:

- custom worker JWT: blocked until signing, claims, rotation, revocation, and
  PostgREST role adoption are demonstrated;
- direct Python PostgreSQL login: larger credential and network trust boundary;
- service-role key in Python: overly broad and explicitly prohibited.

## Provisioning gates

Before any function installation, prove permission to:

1. create or use a non-public `private` schema;
2. create/use `meddecode_function_owner NOLOGIN` or an approved equivalent;
3. alter exact function ownership;
4. grant only required schema usage and function execution;
5. grant the function owner minimum table/sequence privileges;
6. revoke PUBLIC default function execution and set safe default privileges;
7. rotate and audit the backend-to-worker credential;
8. reload/verify PostgREST schema cache without widening exposure.

These are feasibility gates, not asserted capabilities.

## SECURITY DEFINER rules

- Prefer `SET search_path = ''` and schema-qualify every object/function.
- No dynamic SQL.
- Ownership comes from `auth.uid()` or locked stored rows, never request JSON.
- Worker authority comes from a proven execution identity, never worker label.
- Validate state, correlation, lease, and canonical result inside the function.
- Bound payload bytes and grounded collection/text limits.
- Never include JSON, S3 locations, IDs, credentials, or provider errors in
  exceptions.
- Revoke default execution before any caller grant.

## Privilege target

| Object | authenticated | backend worker identity | function owner |
|---|---|---|---|
| prescriptions | owner read/upload and approved edits | no direct DML | exact function DML |
| ai_jobs | owner read plus submit RPC | no direct DML | exact function DML |
| result/projections | owner-derived read | no direct DML | insert/select required by finalizer |
| alternatives | owner-derived read only; disabled | none | no write |

Direct authenticated `ai_jobs` INSERT/UPDATE/DELETE and the historical insert
policy must be removed only after endpoint dependency review. Grants and RLS
must both be tested. Prescription DELETE must move behind a controlled lifecycle
boundary before deadlock safety can be claimed.

## Document handoff

Node verifies the job, prescription, owner, storage provider, and current claim,
then issues an HTTPS S3 reference scoped to one object and one processing
attempt. Requirements:

- short expiry covering bounded processing time;
- no bucket/key returned to users or logs;
- audience/purpose bound to the claimed job and generation;
- no AWS credentials in the URL or Python environment;
- TLS and private bucket only;
- expired reference maps internally to document-reference failure and requires
  a fenced retry, never a public URL;
- no patient identity in object keys or logs.

Exact presigning implementation and audience enforcement are **BLOCKED** until
AWS configuration and internal transport are separately reviewed.

## Canonical result boundary

The finalizer accepts one canonical Contract v1 JSON result. Known required
fields and semantics are validated; backward-compatible unknown optional fields
remain only in raw JSON. Projections are deterministically derived from known
fields in a trusted versioned helper. Independent caller projections are not
accepted.

Alternatives remain disabled because the PDF uses `ingredient_equivalence` and
current TypeScript uses `ingredient_equivalent`. No silent contract change is
authorized.

