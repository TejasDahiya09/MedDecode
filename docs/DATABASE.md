# Database and migrations

## Database boundaries

Supabase Auth is the identity source. PostgreSQL stores application records and references to external prescription files. The additive application-schema reference currently present in the worktree lists:

- User, health-profile, and family-member records.
- Prescription metadata, medicine results, warnings, recommendations, alternatives, and intelligence-result records.
- Processing jobs, cabinet entries, notifications, audit/analytics records.
- `medicine_contract_identifiers`, an additive mapping that references the pre-existing `public.medicines` table.

The reference SQL intentionally does not create, alter, or redefine the pre-existing medicine-intelligence tables. Their complete DDL is not included in the reference; do not claim exact hosted compatibility based on table names alone.

## RLS and access

The reference SQL enables row-level security and defines user-scoped policies for many application tables. Backend authorization, user-scoped Supabase clients, PostgreSQL grants, and RLS are separate controls. Review the exact deployed catalog and role behavior before changing any of them.

## Migration organization

`backend/database/` contains reference SQL, integration migrations, and local test harnesses. The integration migration folders include job-submission and worker-processing changes with preflight/up/verify steps. Local harness results do not prove hosted behavior. Do not run migrations against a hosted Supabase or AWS-backed environment without separate approval and a reviewed deployment plan.

The worker claim/heartbeat migration (`202611120002_processing_job_claim_heartbeat`) and finalization/recovery migration (`202611120003_processing_worker_finalization_recovery`) are local integration candidates only. They have not been hosted-verified or applied to Supabase. No database or hosted operation was performed during the final publication audit.

For any deployment proposal:

1. Capture the target identity and relevant catalog/schema state before changes.
2. Run read-only preflight against the explicitly approved target.
3. Review compatibility and rollback/recovery, including records created after deployment.
4. Apply only through the approved deployment process.
5. Run independent post-deployment checks and retain evidence.

Never use a disposable-test reset against a non-disposable database. Do not widen inventory allowlists to make unexpected objects disappear from safety checks.

## Medicine catalogue

Layer 4 has repository and writer abstractions that can mutate catalogue tables. Its database-writer entry points are not offline dry runs. No import should run until source licensing, identifiers, table definitions, provenance persistence, conflict policy, and target safety have been reviewed.

See the SQL comments in `backend/docs/database-reference/20260925160000_meddecode_application_schema.sql`; this worktree file is a reference, not a report of current hosted catalog state.
