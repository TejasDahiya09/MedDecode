# Medicine Cabinet Owner FK Staging Test Plan

> **NOT FOR EXECUTION — DESIGN REVIEW ONLY.**
> **PRODUCTION DATABASE CHANGE NOT AUTHORIZED.**

## Entry conditions

Do not perform these tests in the production-labeled Supabase project or with
real users. Testing requires all of the following:

- A confirmed isolated staging project with PostgreSQL 17-compatible behavior.
- Two synthetic Supabase Auth users and corresponding synthetic `public.users`
  rows created under separately approved staging procedures.
- Approved synthetic family-member and cabinet fixtures.
- A known non-sensitive Member 1 medicine fixture approved for staging use;
  this plan does not create, alter, or fabricate Member 1 medicine data.
- The draft unique constraint and composite FK applied in staging only.
- Captured pre-test catalog, constraint, policy, and aggregate evidence.
- A cleanup plan and named operator.

Use placeholders `USER_A`, `USER_B`, `FAMILY_A`, `FAMILY_B`, and `CABINET_A` in
evidence. Do not put emails, JWTs, names, medicine content, or raw response
bodies in reports.

## Catalog verification

Before behavioral tests, verify:

1. `family_members_id_user_id_key` is valid and unique over `(id, user_id)`.
2. `medicine_cabinet_family_member_owner_fkey` is validated.
3. Its definition uses `(family_member_id, user_id)`, `MATCH SIMPLE`, and
   `ON DELETE SET NULL (family_member_id)`.
4. The old scalar FK remains during initial testing.
5. Existing `medicine_id` and `user_id` FKs are unchanged.
6. RLS and all existing policies/grants match the pre-migration snapshot.
7. Supporting indexes are valid and ready.
8. Inventory every user-defined trigger on both tables and the relevant internal
   constraint triggers. Record definitions and enabled states. Do not assume FK
   trigger order, and distinguish trigger-derived `updated_at` changes from
   unintended row changes.

## PostgREST compatibility matrix

PostgREST can expose multiple FK relationships between the same resources as an
ambiguous embed (`PGRST201`). A schema-cache refresh updates metadata but does
not remove genuine ambiguity while both FKs exist. Ordinary non-embedded CRUD
does not require relationship selection and must be tested separately.

At each checkpoint below, use safe synthetic staging requests only and record
request shape, status, error code, and PASS/FAIL without response data:

| Phase | Ordinary CRUD | Embedded relationship |
|---|---|---|
| Before composite FK | Capture existing list/detail and embedding baseline. | Confirm the scalar relationship resolves as expected. |
| Both FKs coexist | Confirm non-embedded cabinet/family operations remain unchanged. | Confirm an unqualified embed is either explicitly rejected with `PGRST201` or otherwise behaves exactly as catalog evidence predicts; verify constraint-name disambiguation selects the intended relationship. |
| After old FK removal | Reload/verify schema metadata and repeat ordinary operations. | Confirm the composite relationship is the sole relationship and expected embedding works without selecting the removed FK. |
| After rollback rehearsal | Reload/verify metadata again. | Confirm the restored scalar relationship is visible and no stale composite relationship is selected. |

Before testing, inventory all backend and frontend Data API calls that embed
these resources. The reviewed local backend currently performs independent,
explicit-field selects and contains no direct family/cabinet embed; this does
not prove other clients are unaffected.

## Two-user integrity matrix

| Test | Operation | Expected result |
|---|---|---|
| Same-owner assignment | Assign `CABINET_A` owned by `USER_A` to `FAMILY_A` owned by `USER_A`. | Accepted. Stored owner remains `USER_A`. |
| Cross-owner assignment | Assign `CABINET_A` to `FAMILY_B` owned by `USER_B`. | Rejected by composite FK; no row change. |
| Null association | Set `CABINET_A.family_member_id` to null. | Accepted; `user_id` and `medicine_id` unchanged. |
| Restore same-owner link | Reassign `FAMILY_A`. | Accepted. |
| Delete owned family member | First snapshot the complete `CABINET_A` row, then delete `FAMILY_A`. | `family_member_id` becomes null; cabinet row remains. |
| Ownership preservation | Inspect `CABINET_A` after deletion. | `user_id` is still `USER_A`. |
| Medicine preservation | Inspect `CABINET_A` after deletion. | `medicine_id` is unchanged. |
| Unrelated deletion | Delete `FAMILY_B`. | Does not alter `CABINET_A`. |
| Client owner override | Attempt a cabinet mutation with client-supplied `USER_B`. | Rejected by API/RLS; verified identity remains authoritative. |

### Complete cabinet-row preservation check

Before deleting `FAMILY_A`, capture every column of the synthetic `CABINET_A`
row through the approved staging database test channel. After deletion:

1. `id` is byte-for-byte unchanged.
2. `user_id` is unchanged.
3. `medicine_id` is unchanged.
4. `family_member_id` alone becomes null.
5. Every other column is unchanged, except `updated_at` only if the preflight
   trigger inventory proves a documented database-managed trigger updates it for
   this internal FK action.
6. Compare all cabinet rows owned by `USER_B` and assert none changed.
7. Attribute any trigger-derived change to its exact captured trigger
   definition; unexplained changes are a release blocker.

## RLS matrix

Run each request with the appropriate synthetic user's JWT, never a service-role
key:

1. User A can read only User A's family and cabinet fixtures.
2. User B cannot select User A's fixtures.
3. User A cannot directly insert/update a cabinet row with `user_id = USER_B`.
4. User A cannot update or delete User B's family-member row.
5. A missing/non-owned record produces the same privacy-preserving API result.

These tests validate staging behavior only. They do not prove production state
or all privileged-role behavior.

## Concurrency tests

Use controlled, observable transactions in staging:

### Assignment versus delete

1. Transaction A attempts to assign `CABINET_A` to `FAMILY_A`.
2. Transaction B concurrently deletes `FAMILY_A`.
3. Exercise both commit orders.
4. Acceptable final states are:
   - the assignment commits while the family row exists; a later deletion nulls
     `family_member_id`; or
   - deletion wins and assignment fails because the composite target is absent.
5. A committed dangling or cross-owner reference is a release blocker.

### Owner mismatch under concurrency

1. Attempt a same-owner assignment while another transaction attempts any
   permitted owner-related change.
2. Confirm no commit order can produce unequal owners.
3. Confirm lock waits respect the approved timeout and failures are safe to
   retry only after state inspection.

### Delete with both FKs present

1. Keep the old scalar and new composite FK simultaneously.
2. Delete an owned synthetic family member.
3. Confirm duplicate referential triggers do not error, deadlock, clear
   `user_id`, or modify `medicine_id`.
4. Repeat with concurrent cabinet access.

## Cutover gate

Do not remove `medicine_cabinet_family_member_id_fkey` until:

- Every integrity, deletion, RLS, and concurrency test passes.
- The composite FK is validated in the catalog.
- Post-test aggregate audits report no unresolved or cross-owner references.
- The owner, database reviewer, and rollback operator approve the evidence.

After old-FK removal in staging, rerun the full matrix to prove the composite FK
alone preserves the intended behavior.

## Rollback rehearsal

The rollback must be rehearsed in isolated staging before production approval:

1. Record the initial scalar FK definition/validity, new composite FK
   definition/validity, supporting index definitions, trigger inventory, RLS,
   grants, PostgREST relationship behavior, and complete synthetic cabinet row.
2. Complete and verify the forward migration through old-FK removal.
3. Confirm only the composite FK remains and rerun the integrity matrix.
4. Execute the separately approved staging rollback procedure: restore the
   original scalar FK as `NOT VALID`, validate it, and inspect its exact catalog
   definition.
5. Repeat the rollback catalog/dependency gate. Remove the composite FK only
   after the scalar FK is valid and named operator approval is recorded.
6. Reload and verify PostgREST schema metadata and rerun ordinary CRUD plus
   embedding checks.
7. Compare the complete cabinet fixture with its pre-rehearsal snapshot. No
   cabinet data may change merely because constraints were replaced.
8. Demonstrate and record that the restored scalar FK again enforces existence
   only and therefore reopens the documented cross-owner invariant gap. Do not
   create a cross-owner row merely to prove this; the catalog definition is the
   evidence.
9. If staging must end in the target state, reapply the forward design through
   the same reviewed phases and rerun the complete matrix.
10. Any ambiguous DDL outcome or data difference stops the rehearsal; inspect
    state before retry or cleanup.

## Regression checks

- Family-member read and CRUD API contracts remain unchanged.
- Cabinet read APIs retain their exact public allowlist.
- No cabinet write API is introduced by this database test.
- `medicine_id` continues to reference the internal Member 1-owned table without
  joins or mutation.
- No intelligence request/response changes occur.
- No prescription-extracted patient data enters family-member or profile rows.
- Application tests and catalog evidence are recorded separately; mocks are not
  represented as live RLS proof.

## Cleanup and evidence

### Fixture tracking

- Use exactly two separately authorized synthetic users and record opaque test
  run identifiers in the secured operator record.
- Track every created family-member and cabinet fixture ID in process memory or
  an approved secure staging record; never infer fixtures from names alone.
- Use only an already approved, non-sensitive Member 1 medicine fixture. If none
  exists, block cabinet tests requiring it. Never create, alter, or delete a
  Member 1 medicine merely to satisfy this plan.
- Record owner-qualified pre-cleanup counts for each synthetic user's fixtures.

### Dependency-safe cleanup order

1. Confirm the target project is staging and the authenticated/operator context
   matches the approved synthetic users.
2. Null or remove only tracked synthetic cabinet associations as required by the
   approved cleanup procedure.
3. Delete only tracked synthetic cabinet fixtures using both fixture ID and
   synthetic owner ID.
4. Delete only tracked synthetic family-member fixtures using both fixture ID
   and synthetic owner ID.
5. Remove synthetic application/Auth users only under their separate approved
   lifecycle procedure and only after dependent fixtures are gone.
6. Do not touch the approved medicine fixture.
7. Verify post-cleanup tracked-fixture counts are zero and unrelated staging row
   counts are unchanged.

On timeout, connection loss, or partial cleanup failure, stop and inspect
owner-qualified fixture state before any retry. Never broaden filters, retry a
blind delete, or treat a client error as proof that deletion failed.

Record only safe counts, constraint names, status, and PASS/FAIL results; do not
record personal data, JWTs, credentials, or raw health/medicine payloads.

## Ambiguous-operation recovery exercises

Rehearse the proposal's operator decision table for lock timeout, statement
timeout, deadlock, connection loss after a possible DDL commit, failed FK
validation, and failed concurrent index creation. For each exercise:

- capture the exact read-only catalog evidence required by the table;
- inspect `pg_index.indisvalid`, `pg_index.indisready`, `pg_class`,
  `pg_constraint`, `pg_depend`, and exact definitions where an index is involved;
- establish the actual migration phase before choosing a next action;
- do not recreate, drop, retry, clean up, or transition phases blindly; and
- verify that an invalid concurrent unique index can still affect writes even
  when it is unusable for normal query planning.

Any failed assertion is a **NO-GO** for production. Do not repair production
data, weaken RLS, disable constraints, or proceed to migration approval from
this test plan.
