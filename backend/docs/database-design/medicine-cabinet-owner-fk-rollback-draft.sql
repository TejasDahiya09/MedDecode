/*
 * NOT FOR EXECUTION — DESIGN REVIEW ONLY.
 * PRODUCTION DATABASE CHANGE NOT AUTHORIZED.
 *
 * Rolling back to the scalar foreign key reopens the known cross-owner
 * association risk. Use only after explicit incident/change approval. This
 * draft does not delete or rewrite cabinet records.
 */

/* -------------------------------------------------------------------------
 * CATALOG GATE — REQUIRED BEFORE EVERY ROLLBACK DROP
 *
 * Record the current migration phase and obtain named operator authorization.
 * Confirm the expected constraint name, exact definition, validation state,
 * old-FK presence, and dependencies in pg_constraint/pg_depend. Connection loss
 * is not proof that a DDL statement failed. Do not continue until catalog state
 * matches exactly one reviewed rollback case.
 * ------------------------------------------------------------------------- */

SELECT con.conname,
       con.convalidated,
       con.condeferrable,
       pg_get_constraintdef(con.oid, true) AS definition,
       con.oid AS constraint_oid
FROM pg_catalog.pg_constraint AS con
WHERE con.conrelid = 'public.medicine_cabinet'::regclass
  AND con.conname IN (
    'medicine_cabinet_family_member_id_fkey',
    'medicine_cabinet_family_member_owner_fkey'
  )
ORDER BY con.conname;

-- Inspect pg_depend for the returned constraint OIDs and their supporting
-- objects. The operator must compare the output with the approved phase record.
SELECT dep.classid::regclass AS dependent_catalog,
       dep.objid AS dependent_oid,
       dep.refclassid::regclass AS referenced_catalog,
       dep.refobjid AS referenced_oid,
       dep.deptype
FROM pg_catalog.pg_depend AS dep
WHERE dep.objid IN (
  SELECT con.oid
  FROM pg_catalog.pg_constraint AS con
  WHERE con.conrelid = 'public.medicine_cabinet'::regclass
    AND con.conname IN (
      'medicine_cabinet_family_member_id_fkey',
      'medicine_cabinet_family_member_owner_fkey'
    )
)
   OR dep.refobjid IN (
  SELECT con.oid
  FROM pg_catalog.pg_constraint AS con
  WHERE con.conrelid = 'public.medicine_cabinet'::regclass
    AND con.conname IN (
      'medicine_cabinet_family_member_id_fkey',
      'medicine_cabinet_family_member_owner_fkey'
    )
)
ORDER BY dependent_catalog::text, dependent_oid, referenced_oid;

/* -------------------------------------------------------------------------
 * CASE A — ROLLBACK BEFORE OLD FK REMOVAL
 * Preconditions: the original scalar FK exists and is validated; the composite
 * FK has the exact reviewed definition; dependencies are understood; rollback
 * is authorized. Remove only the new composite FK. Keep supporting
 * indexes/unique key until dependency and lock review.
 * ------------------------------------------------------------------------- */

BEGIN;

ALTER TABLE public.medicine_cabinet
  DROP CONSTRAINT medicine_cabinet_family_member_owner_fkey;

COMMIT;

/* -------------------------------------------------------------------------
 * CASE B — ROLLBACK AFTER CUTOVER
 * First restore and validate the original scalar FK. Only then repeat the
 * catalog/dependency gate and remove the composite FK with named operator
 * authorization. This avoids a period with no family-member FK enforcement.
 * ------------------------------------------------------------------------- */

BEGIN;

ALTER TABLE public.medicine_cabinet
  ADD CONSTRAINT medicine_cabinet_family_member_id_fkey
  FOREIGN KEY (family_member_id)
  REFERENCES public.family_members (id)
  ON DELETE SET NULL
  NOT VALID;

COMMIT;

ALTER TABLE public.medicine_cabinet
  VALIDATE CONSTRAINT medicine_cabinet_family_member_id_fkey;

-- Approval checkpoint: confirm the scalar FK is validated before continuing.
SELECT con.conname,
       con.convalidated,
       pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint AS con
WHERE con.conrelid = 'public.medicine_cabinet'::regclass
  AND con.conname IN (
    'medicine_cabinet_family_member_id_fkey',
    'medicine_cabinet_family_member_owner_fkey'
  )
ORDER BY con.conname;

-- STOP unless medicine_cabinet_family_member_id_fkey exists, is validated, and
-- exactly matches FOREIGN KEY (family_member_id) REFERENCES
-- public.family_members(id) ON DELETE SET NULL. Reinspect pg_depend and confirm
-- the current rollback phase before the exact DROP below.

BEGIN;

ALTER TABLE public.medicine_cabinet
  DROP CONSTRAINT medicine_cabinet_family_member_owner_fkey;

COMMIT;

-- After either rollback case, use the approved PostgREST schema-cache reload
-- procedure and verify ordinary CRUD plus relationship embedding. Cache reload
-- does not correct genuine ambiguity if both FKs still coexist.

/* -------------------------------------------------------------------------
 * OPTIONAL LATER CLEANUP — REQUIRES SEPARATE REVIEW
 * Do not drop the unique constraint or indexes until pg_depend confirms that
 * no remaining object needs them. Concurrent index drops cannot run inside a
 * transaction. The following names are included only for design discussion.
 * ------------------------------------------------------------------------- */

-- ALTER TABLE public.family_members
--   DROP CONSTRAINT family_members_id_user_id_key;
-- DROP INDEX CONCURRENTLY IF EXISTS
--   public.medicine_cabinet_family_member_user_idx;

/*
 * After rollback, repeat the unresolved/cross-owner audit. The restored scalar
 * FK verifies existence only; it does not prevent future cross-owner links.
 * Keep live family-member DELETE and cabinet-family assignment blocked until an
 * approved integrity design is restored.
 */
