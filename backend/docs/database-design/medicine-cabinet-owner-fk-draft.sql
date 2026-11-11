/*
 * NOT FOR EXECUTION — DESIGN REVIEW ONLY.
 * PRODUCTION DATABASE CHANGE NOT AUTHORIZED.
 *
 * This is an operator-reviewed draft, not an application migration. It must not
 * be run from npm, application startup, Prisma, CI, or an automatic migration
 * runner. Catalog names and audit results must be refreshed before approval.
 */

/* -------------------------------------------------------------------------
 * PHASE 0 — READ-ONLY PREFLIGHT (illustrative queries; do not execute here)
 * ------------------------------------------------------------------------- */

-- Confirm server support for column-specific ON DELETE SET NULL.
SELECT current_setting('server_version') AS server_version,
       current_setting('server_version_num') AS server_version_num;

-- Capture relevant constraints exactly for approval and rollback.
SELECT con.conname,
       con.convalidated,
       con.condeferrable,
       con.condeferred,
       pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint AS con
WHERE con.conrelid IN (
  'public.family_members'::regclass,
  'public.medicine_cabinet'::regclass
)
ORDER BY con.conrelid::regclass::text, con.conname;

-- Re-run integrity checks immediately before any approved DDL.
SELECT count(*) AS total_cabinet_entries
FROM public.medicine_cabinet;

SELECT count(*) AS unresolved_family_references
FROM public.medicine_cabinet AS mc
LEFT JOIN public.family_members AS fm ON fm.id = mc.family_member_id
WHERE mc.family_member_id IS NOT NULL
  AND fm.id IS NULL;

SELECT count(*) AS cross_owner_references
FROM public.medicine_cabinet AS mc
JOIN public.family_members AS fm ON fm.id = mc.family_member_id
WHERE mc.user_id IS DISTINCT FROM fm.user_id;

-- STOP if either invalid-reference count is nonzero. This draft contains no
-- data repair and does not authorize production DML.

/* -------------------------------------------------------------------------
 * PHASE 1 — INDEX BUILDS
 * Run each CONCURRENTLY statement separately, outside transaction blocks.
 * Inspect pg_index.indisvalid and pg_index.indisready after each statement.
 * Names must be checked against the fresh catalog before use.
 * ------------------------------------------------------------------------- */

CREATE UNIQUE INDEX CONCURRENTLY family_members_id_user_id_uidx
  ON public.family_members (id, user_id);

CREATE INDEX CONCURRENTLY medicine_cabinet_family_member_user_idx
  ON public.medicine_cabinet (family_member_id, user_id);

-- Mandatory checkpoint after each concurrent build. A failed concurrent unique
-- build may remain invalid while still enforcing uniqueness. Do not drop,
-- recreate, or retry until all of the following evidence is reviewed. The
-- selected columns are intentionally metadata only.
SELECT idx.relname AS index_name,
       pi.indisvalid,
       pi.indisready,
       pg_get_indexdef(idx.oid) AS index_definition,
       con.conname AS attached_constraint
FROM pg_catalog.pg_class AS idx
JOIN pg_catalog.pg_index AS pi ON pi.indexrelid = idx.oid
JOIN pg_catalog.pg_namespace AS ns ON ns.oid = idx.relnamespace
LEFT JOIN pg_catalog.pg_constraint AS con ON con.conindid = idx.oid
WHERE ns.nspname = 'public'
  AND idx.relname IN (
    'family_members_id_user_id_uidx',
    'family_members_id_user_id_key',
    'medicine_cabinet_family_member_user_idx'
)
ORDER BY idx.relname;

-- A missing row is evidence of a missing object, not permission to recreate it.
-- Also inspect pg_depend for each returned index OID before any cleanup. After
-- UNIQUE USING INDEX, PostgreSQL may rename the physical index to match
-- family_members_id_user_id_key; use catalog identity, not a stale name.

/* -------------------------------------------------------------------------
 * PHASE 2 — ATTACH UNIQUE CONSTRAINT
 * Use an approved short lock timeout. Do not blindly retry ambiguous DDL.
 * ------------------------------------------------------------------------- */

BEGIN;

ALTER TABLE public.family_members
  ADD CONSTRAINT family_members_id_user_id_key
  UNIQUE USING INDEX family_members_id_user_id_uidx;

COMMIT;

/* -------------------------------------------------------------------------
 * PHASE 3 — ADD OWNER-QUALIFIED FK WITHOUT HISTORICAL VALIDATION
 * MATCH SIMPLE permits family_member_id = NULL while user_id remains NOT NULL.
 * The old scalar FK remains present throughout this phase.
 * ------------------------------------------------------------------------- */

BEGIN;

ALTER TABLE public.medicine_cabinet
  ADD CONSTRAINT medicine_cabinet_family_member_owner_fkey
  FOREIGN KEY (family_member_id, user_id)
  REFERENCES public.family_members (id, user_id)
  MATCH SIMPLE
  ON DELETE SET NULL (family_member_id)
  NOT VALID;

COMMIT;

-- POSTGREST COEXISTENCE CHECKPOINT (NOT SQL IN THIS DRAFT): use only the
-- separately approved Supabase schema-cache reload procedure, then test ordinary
-- CRUD and explicitly constraint-disambiguated embedding. A refresh cannot
-- remove genuine ambiguity while both foreign keys exist.

/* -------------------------------------------------------------------------
 * PHASE 4 — VALIDATE EXISTING ROWS
 * Proceed only after the preflight audit is clean. On failure, retain the old
 * scalar FK and stop for separately approved investigation.
 * ------------------------------------------------------------------------- */

ALTER TABLE public.medicine_cabinet
  VALIDATE CONSTRAINT medicine_cabinet_family_member_owner_fkey;

-- Approval checkpoint: verify convalidated = true and inspect the exact
-- pg_get_constraintdef output before proceeding.
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

/* -------------------------------------------------------------------------
 * PHASE 5 — REMOVE OLD SCALAR FK LAST
 * Execute only after staging tests and the preceding validation checkpoint.
 * Existing medicine_id and user_id foreign keys are intentionally untouched.
 * ------------------------------------------------------------------------- */

BEGIN;

ALTER TABLE public.medicine_cabinet
  DROP CONSTRAINT medicine_cabinet_family_member_id_fkey;

COMMIT;

-- POSTGREST CUTOVER CHECKPOINT (NOT SQL IN THIS DRAFT): reload and verify schema
-- metadata after old-FK removal, then repeat ordinary CRUD and embedding tests.

/* -------------------------------------------------------------------------
 * PHASE 6 — POST-DEPLOYMENT READ-ONLY VERIFICATION
 * Repeat the three integrity counts and inspect constraints, indexes, RLS,
 * policies, and grants. Use the platform-supported PostgREST schema metadata
 * refresh only if separately approved and operationally required.
 * ------------------------------------------------------------------------- */
