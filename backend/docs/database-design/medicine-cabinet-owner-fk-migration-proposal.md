# Medicine Cabinet / Family Member Owner FK Migration Proposal

> **NOT FOR EXECUTION — DESIGN REVIEW ONLY.**
> **PRODUCTION DATABASE CHANGE NOT AUTHORIZED.**

## Purpose

This proposal closes one relational-integrity gap: the existing scalar foreign
key proves that `medicine_cabinet.family_member_id` exists, but it does not prove
that the cabinet row and family-member row have the same `user_id`.

The proposed invariant is:

```text
medicine_cabinet(family_member_id, user_id)
  -> family_members(id, user_id)
```

The relationship remains optional because the foreign key uses the default
`MATCH SIMPLE` behavior. A null `family_member_id` is allowed, while every
non-null value must identify a family member owned by the cabinet owner.

## Evidence and scope

The project owner supplied the following production catalog evidence for design
purposes only:

- PostgreSQL 17.11 (`server_version_num = 170011`).
- Existing validated, non-deferrable constraint
  `medicine_cabinet_family_member_id_fkey`, defined as
  `FOREIGN KEY (family_member_id) REFERENCES family_members(id) ON DELETE SET NULL`.
- Existing `medicine_id -> medicines(id) ON DELETE RESTRICT` and
  `user_id -> users(id) ON DELETE CASCADE` foreign keys.
- No reported unique key on `family_members(id, user_id)`.
- Last authorized aggregate audit: zero cabinet rows, zero cross-owner
  references, and zero unresolved references.

That audit is a historical checkpoint, not a deployment-time assertion. It must
be repeated immediately before any approved migration. This proposal does not
modify Member 1's `medicines` table, either existing cabinet foreign key, RLS,
grants, application code, or production data.

## Proposed invariant and delete behavior

PostgreSQL 17 supports a column list on an `ON DELETE SET NULL` action. The new
composite foreign key therefore sets only `family_member_id` to null:

```sql
-- NOT FOR EXECUTION — illustrative definition only.
FOREIGN KEY (family_member_id, user_id)
  REFERENCES public.family_members (id, user_id)
  MATCH SIMPLE
  ON DELETE SET NULL (family_member_id)
```

It must not use unqualified `ON DELETE SET NULL` on the composite key. That
would attempt to clear `user_id`, violating its `NOT NULL` requirement and the
cabinet ownership model.

The referenced pair requires a unique constraint on
`family_members(id, user_id)`. Although `id` is already a primary key, the
qualified key is deliberately explicit and is the target of the composite FK.

## Staged sequence

1. **Approval gate and maintenance planning**
   - Obtain named staging and production approvals.
   - Confirm a staging environment and recovery point.
   - Set conservative `lock_timeout` and `statement_timeout` values in the
     operator's approved runbook, not in application startup.
2. **Catalog preflight**
   - Reconfirm PostgreSQL version, columns, nullability, constraint definitions,
     validation state, indexes, triggers, RLS policies, grants, owners, and table
     partitioning.
   - Capture the exact old FK definition for rollback.
3. **Current-data audit**
   - Count cabinet rows, non-null family references, unresolved references, and
     cross-owner references.
   - Stop if either invalid-reference count is nonzero. Remediation requires a
     separate, data-specific approval; this proposal contains no repair DML.
4. **Build supporting indexes**
   - Prefer `CREATE UNIQUE INDEX CONCURRENTLY` as
     `family_members_id_user_id_uidx` for the referenced qualified key and
     `CREATE INDEX CONCURRENTLY` as
     `medicine_cabinet_family_member_user_idx` for the cabinet lookup index when
     production size or traffic makes blocking index builds unacceptable.
   - Concurrent index statements run outside an explicit transaction and need
     an operator checkpoint after each one.
5. **Attach the unique constraint**
   - Attach the valid qualified unique index as
     `family_members_id_user_id_key` in a short transaction.
6. **Add the composite FK as `NOT VALID`**
   - Name it `medicine_cabinet_family_member_owner_fkey`.
   - The old scalar FK remains in place.
   - The new constraint immediately checks later inserts and relevant updates,
     while avoiding an initial full validation scan.
7. **Validate the composite FK**
   - Validation proves all pre-existing rows satisfy the new invariant.
   - Stop on failure; do not drop the old FK.
8. **Confirm behavior**
   - Run the approved staging tests and re-inspect catalog definitions.
   - Confirm the new constraint is validated and its delete action targets only
     `family_member_id`.
   - Reload and verify PostgREST schema metadata through the approved Supabase
     procedure, then test both ordinary CRUD and explicitly disambiguated
     resource embedding while both foreign keys coexist.
9. **Remove the old scalar FK**
   - Drop `medicine_cabinet_family_member_id_fkey` only after the composite FK is
     valid and operational.
   - Preserve the `medicine_id` and `user_id` foreign keys unchanged.
10. **Post-deployment checks**
    - Repeat integrity counts, inspect constraint validation, and exercise only
      pre-approved synthetic staging checks.
    - Reload and verify PostgREST schema metadata through the
      platform-supported operational process after the old FK is removed. This
      is an explicit cutover checkpoint, not an application migration step.

## Temporary coexistence of old and new foreign keys

The two family-member foreign keys can coexist during transition:

- The scalar FK continues to protect existence and performs its existing
  `SET NULL` action.
- The composite FK protects both existence and owner equality for new or
  changed rows, even while marked `NOT VALID`.
- Both delete actions target the same nullable `family_member_id`; neither is
  allowed to modify `user_id`.

The duplicate referential triggers add overhead and must be exercised under
staging concurrency. PostgreSQL's internal constraint-trigger order must not be
assumed and the design must be correct regardless of which action runs first.
Both actions are restricted to `family_member_id`; no referential action may
null or change `medicine_cabinet.user_id`. Coexistence is intentionally
temporary. A family-member delete concurrent with assignment must serialize
through PostgreSQL's FK locking and must end in either a valid matching
reference or null, never a committed cross-owner reference. This behavior still
requires staging proof in the hosted PostgreSQL environment.

There is no planned period without family-member FK enforcement: the old FK is
removed last.

## `NOT VALID` and validation guarantees

- `ADD ... FOREIGN KEY ... NOT VALID` skips the historical table scan but
  enforces the constraint for later inserts and relevant updates.
- It does **not** prove old rows are valid.
- `VALIDATE CONSTRAINT` checks the historical rows and marks the constraint
  validated only after a successful scan.
- A validation failure leaves the old scalar FK intact and the new FK present
  but unvalidated; operators must stop and investigate rather than drop or
  disable constraints.

## Locking and operational risks

- Plain unique/index creation can block writes for its duration. Concurrent
  builds reduce write blocking but take longer, consume resources, and cannot
  run inside a transaction block.
- A failed concurrent build can leave an invalid index. It must be inspected and
  can continue imposing write overhead. In the unique-index case, uniqueness
  may already be enforced even when the build ultimately fails. Inspect
  `pg_index.indisvalid`, `pg_index.indisready`, `pg_class`, `pg_constraint`,
  `pg_depend`, and the exact index definition before any cleanup or retry.
- Attaching an index with `UNIQUE USING INDEX` can rename the physical index to
  the constraint name. All later phases and rollback decisions must use fresh
  catalog evidence rather than assume the pre-attachment index name remains.
- Attaching the unique constraint, adding/dropping FKs, and catalog changes still
  require table locks. Schedule them, use timeouts, and abort rather than wait
  indefinitely.
- FK validation scans data and can affect production I/O even though it uses a
  less restrictive lock than adding and validating in one operation.
- Network ambiguity after DDL requires catalog inspection before any retry.
  Never blindly rerun a partially completed migration.
- PostgreSQL constraints provide integrity, not API privacy. Existing RLS and
  verified-user filters remain required.

## Failure checkpoints

| Failure point | Safe response |
|---|---|
| Preflight or data audit mismatch | Stop; make no DDL changes. |
| Concurrent index build fails | Inspect catalog; do not attach an invalid index or retry blindly. |
| Unique constraint attachment fails | Keep old FK; inspect the standalone index and lock failure. |
| Composite FK creation fails | Keep old FK and unique key; diagnose without weakening enforcement. |
| FK validation fails | Keep old FK; do not drop either constraint or mutate data without separate approval. |
| Staging behavior fails | Do not proceed to production or old-FK removal. |
| Old-FK drop fails | Leave both valid FKs; this is redundant but integrity-safe. |
| Post-deployment verification fails | Freeze cabinet/family write rollout and follow the reviewed rollback plan. |

## PostgREST relationship compatibility

During coexistence, PostgREST can observe two relationships from
`medicine_cabinet` to `family_members`. Ordinary non-embedded table operations
that select only cabinet columns do not require PostgREST to choose a
relationship. Resource embedding such as a cabinet request that embeds
`family_members`, however, can become ambiguous and return `PGRST201` unless the
relationship is explicitly disambiguated by constraint name.

The local backend repositories currently select explicit fields independently
from `medicine_cabinet` and `family_members`; the reviewed source contains no
direct embedded query between these tables. This is local-source evidence only,
not proof that no other client uses embedding.

Before staging DDL, inventory all Data API clients and capture an ordinary CRUD
and embedding baseline. During coexistence:

- reload and verify the schema cache through the approved Supabase procedure;
- verify ordinary cabinet and family-member CRUD remains unchanged;
- verify an unqualified embed either remains unambiguous or fails with the
  expected `PGRST201`;
- where embedding is required, select the intended relationship explicitly by
  its constraint name; and
- block cutover if any client cannot tolerate or disambiguate coexistence.

After the scalar FK is removed, reload and verify the schema cache again and
repeat the API matrix. A cache refresh fixes stale metadata; it does **not**
resolve genuine ambiguity while two valid relationships still exist.

## Ambiguous-operation decision table

No timeout value is authorized by this design. Values belong in an approved
operator runbook appropriate to the staging/production environment.

| Operation | Possible failure | Required read-only evidence | Safe next decision |
|---|---|---|---|
| Concurrent index build | Uniqueness failure, deadlock, timeout, invalid index, connection loss | `pg_index.indisvalid`, `indisready`, `pg_class`, `pg_constraint`, `pg_depend`, exact index definition and server logs | Stop. Keep or remove only after state and dependencies are reviewed; never recreate/drop blindly. |
| Unique-constraint attachment | Lock/statement timeout, deadlock, connection loss after possible commit | Exact constraint/index definitions and dependencies | If attached exactly as approved, continue only from the next checkpoint; otherwise stop for reviewed recovery. |
| Composite FK addition | Lock timeout, deadlock, or unknown commit outcome | Constraint existence, definition, `convalidated`, referenced key, old-FK presence | Never repeat blindly. Continue only when catalog state matches one documented phase. |
| FK validation | Constraint violation, timeout, deadlock, or connection loss | `convalidated`, integrity counts, validation error details, old-FK presence | Keep old FK. Investigate; no repair DML is authorized by this proposal. |
| Old-FK removal | Lock timeout, deadlock, or unknown commit outcome | Exact list/definitions of both FKs and PostgREST relationship state | Both present is integrity-safe; one validated composite FK is the target. Do not infer state from the client error. |
| Schema-cache reload | Stale relationship or ambiguous embed | Constraint catalog plus safe Data API CRUD/embed results and PostgREST error codes | Retry cache reload only through approved operations; disambiguate genuine dual-FK relationships rather than repeatedly reload. |
| Rollback phase | Partial/unknown DDL outcome | Migration phase record, exact FK definitions/validity, dependencies, cabinet integrity counts | Use the catalog-gated rollback path matching the proven phase; obtain operator authorization before every drop. |

## RLS, grants, and application impact

This design changes no policies or grants. RLS continues to enforce which rows
ordinary authenticated users can access, while the composite FK enforces the
cross-table invariant independently.

Future cabinet create/update APIs should still perform an owner-scoped lookup
of `(family_member_id, verified_user_id)` before writing. That provides a
privacy-preserving `404`/validation response and better UX. The database FK
remains authoritative and closes time-of-check/time-of-use races.

Family-member deletion must remain blocked from live use until the migration is
approved, applied, and the column-specific delete behavior is verified.

## Contract v1.0 compliance

- Member 1-owned `medicines` rows and the cabinet `medicine_id` relationship are
  unchanged.
- Internal `medicine_id` is not reinterpreted as `medicine_external_id`.
- No intelligence request or response schema changes.
- No OCR, NER, matching, AWS, or Member 1 call is introduced.
- No medicine, prescription, patient, or family-member data is fabricated.
- Prescription-extracted patient information is never used to populate family
  members or authenticated profiles.

## Approval requirements

This design remains **NO-GO for execution** until all of the following exist:

- Confirmed isolated staging environment.
- Named database owner and project-owner approval.
- Fresh catalog and data-audit evidence.
- Reviewed backup/recovery point and rollback operator.
- Successful two-user staging, concurrency, RLS, and deletion tests.
- Approved maintenance window, lock timeouts, monitoring, and schema-cache plan.
- Final review of the exact SQL after constraint/index names are reconciled with
  the fresh catalog.
