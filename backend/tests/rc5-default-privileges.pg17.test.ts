import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { startPrivatePostgres17 } from "./support/private-postgres17.js";

const hardeningSql = `
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated, meddecode_scoped_worker, meddecode_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated, meddecode_scoped_worker, meddecode_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, meddecode_scoped_worker, meddecode_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE ON TYPES FROM anon, authenticated, meddecode_scoped_worker, meddecode_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE USAGE ON TYPES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE ON TYPES TO service_role;
`;

test("RC-5 hardening preserves existing ACLs and makes future public objects fail closed", { timeout: 120_000 }, async () => {
  const database = await startPrivatePostgres17();
  const admin = new Pool({ ...database.config, max: 1 });
  try {
    await admin.query(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE ROLE meddecode_scoped_worker NOLOGIN NOINHERIT;
      CREATE ROLE meddecode_worker NOLOGIN NOINHERIT;

      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT ALL PRIVILEGES ON SEQUENCES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

      CREATE TABLE public.existing_object (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY);
      ALTER TABLE public.existing_object ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION public.existing_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
    `);

    const before = await admin.query(`
      SELECT c.relacl::text AS table_acl, c.relrowsecurity,
             p.proacl::text AS function_acl
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN pg_proc p
      JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE n.nspname='public' AND c.relname='existing_object'
        AND pn.nspname='public' AND p.proname='existing_function'
    `);
    assert.equal(before.rowCount, 1);

    await admin.query("BEGIN");
    await admin.query(hardeningSql);
    await admin.query("COMMIT");

    const hardenedFunctionDefaults = await admin.query(`
      SELECT d.defaclacl::text AS acl
      FROM pg_default_acl d
      WHERE d.defaclrole='postgres'::regrole
        AND d.defaclnamespace='public'::regnamespace
        AND d.defaclobjtype='f'
    `);

    const after = await admin.query(`
      SELECT c.relacl::text AS table_acl, c.relrowsecurity,
             p.proacl::text AS function_acl
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN pg_proc p
      JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE n.nspname='public' AND c.relname='existing_object'
        AND pn.nspname='public' AND p.proname='existing_function'
    `);
    assert.deepEqual(after.rows, before.rows);
    assert.equal(after.rows[0]?.relrowsecurity, true);

    await admin.query(`
      CREATE TYPE public.future_state AS ENUM ('ready');
      CREATE TABLE public.future_object (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        state public.future_state NOT NULL
      );
      ALTER TABLE public.future_object ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION public.future_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
    `);

    const matrix = await admin.query(`
      SELECT role_name,
        has_table_privilege(role_name,'public.future_object','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS any_table,
        has_sequence_privilege(role_name,'public.future_object_id_seq','USAGE,SELECT,UPDATE') AS any_sequence,
        has_function_privilege(role_name,'public.future_function()','EXECUTE') AS function_execute,
        has_type_privilege(role_name,'public.future_state','USAGE') AS type_usage
      FROM unnest(ARRAY['anon','authenticated','meddecode_scoped_worker','meddecode_worker','service_role']) role_name
      ORDER BY role_name
    `);
    const futureFunctionAcl = await admin.query("SELECT proacl::text AS acl FROM pg_proc WHERE oid='public.future_function()'::regprocedure");
    for (const row of matrix.rows.filter(row => row.role_name !== "service_role")) {
      assert.equal(row.any_table, false, `${row.role_name} future table access`);
      assert.equal(row.any_sequence, false, `${row.role_name} future sequence access`);
      assert.equal(row.function_execute, false, `${row.role_name} future function access; ACL=${futureFunctionAcl.rows[0]?.acl}; defaults=${JSON.stringify(hardenedFunctionDefaults.rows)}`);
      assert.equal(row.type_usage, false, `${row.role_name} future type access`);
    }
    const service = matrix.rows.find(row => row.role_name === "service_role");
    assert.ok(service);
    assert.equal(service.any_table, true);
    assert.equal(service.any_sequence, true);
    assert.equal(service.function_execute, true);
    assert.equal(service.type_usage, true);

    const defaults = await admin.query(`
      SELECT d.defaclobjtype,
             CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END AS grantee,
             x.privilege_type
      FROM pg_default_acl d
      CROSS JOIN LATERAL aclexplode(d.defaclacl) x
      WHERE d.defaclrole='postgres'::regrole AND d.defaclnamespace='public'::regnamespace
      ORDER BY d.defaclobjtype,grantee,x.privilege_type
    `);
    const forbidden = defaults.rows.filter(row =>
      ["PUBLIC", "anon", "authenticated", "meddecode_scoped_worker", "meddecode_worker"].includes(row.grantee),
    );
    assert.deepEqual(forbidden, []);
    assert.ok(defaults.rows.some(row => row.grantee === "service_role" && row.defaclobjtype === "T" && row.privilege_type === "USAGE"));
  } finally {
    await admin.end();
    await database.stop();
  }
});
