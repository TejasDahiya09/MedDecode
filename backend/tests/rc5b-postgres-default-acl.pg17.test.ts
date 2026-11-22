import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { startPrivatePostgres17 } from "./support/private-postgres17.js";

const migration = resolve(
  __dirname,
  "../database/integration-migrations/202611200015_postgres_public_default_privilege_hardening_v1",
);

async function sql(name: string): Promise<string> {
  return (await readFile(resolve(migration, name), "utf8"))
    .split(/\r?\n/)
    .filter(line => !line.startsWith("\\set "))
    .join("\n");
}

test("Migration 015 hardens only postgres future public tables and sequences", { timeout: 120_000 }, async () => {
  const database = await startPrivatePostgres17();
  const admin = new Pool({ ...database.config, max: 1 });
  try {
    await admin.query(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE ROLE meddecode_scoped_worker NOLOGIN NOINHERIT;
      CREATE ROLE meddecode_worker NOLOGIN NOINHERIT;
      CREATE ROLE supabase_admin NOLOGIN;
      GRANT CREATE,USAGE ON SCHEMA public TO supabase_admin;
      CREATE SCHEMA other_app AUTHORIZATION postgres;

      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT ALL PRIVILEGES ON TABLES TO postgres,anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT ALL PRIVILEGES ON SEQUENCES TO postgres,anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO postgres,anon,authenticated,service_role;

      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA other_app
        GRANT ALL PRIVILEGES ON TABLES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
        GRANT ALL PRIVILEGES ON TABLES TO anon,authenticated,service_role;

      CREATE TABLE public.existing_object (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id text NOT NULL
      );
      ALTER TABLE public.existing_object ENABLE ROW LEVEL SECURITY;
    `);

    const existingBefore = await admin.query(`
      SELECT c.relacl::text AS acl,c.relrowsecurity
      FROM pg_class c WHERE c.oid='public.existing_object'::regclass
    `);
    const unrelatedDefaultsBefore = await admin.query(`
      SELECT d.defaclrole::regrole::text creator,n.nspname,d.defaclobjtype,d.defaclacl::text acl
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
      WHERE (d.defaclrole='supabase_admin'::regrole AND n.nspname='public')
         OR (d.defaclrole='postgres'::regrole AND n.nspname='other_app')
      ORDER BY creator,n.nspname,d.defaclobjtype
    `);

    await admin.query(await sql("001_preflight.sql"));
    await admin.query(await sql("002_up.sql"));
    await admin.query(await sql("003_verify.sql"));

    const existingAfter = await admin.query(`
      SELECT c.relacl::text AS acl,c.relrowsecurity
      FROM pg_class c WHERE c.oid='public.existing_object'::regclass
    `);
    assert.deepEqual(existingAfter.rows, existingBefore.rows);
    const unrelatedDefaultsAfter = await admin.query(`
      SELECT d.defaclrole::regrole::text creator,n.nspname,d.defaclobjtype,d.defaclacl::text acl
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
      WHERE (d.defaclrole='supabase_admin'::regrole AND n.nspname='public')
         OR (d.defaclrole='postgres'::regrole AND n.nspname='other_app')
      ORDER BY creator,n.nspname,d.defaclobjtype
    `);
    assert.deepEqual(unrelatedDefaultsAfter.rows, unrelatedDefaultsBefore.rows);

    await admin.query(`
      CREATE TYPE public.future_state AS ENUM ('ready');
      CREATE TABLE public.future_object (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        state public.future_state NOT NULL
      );
      ALTER TABLE public.future_object ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION public.future_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
      CREATE TABLE other_app.future_other (id bigint PRIMARY KEY);
      SET ROLE supabase_admin;
      CREATE TABLE public.supabase_future (id bigint PRIMARY KEY);
      RESET ROLE;
    `);

    const matrix = await admin.query(`
      SELECT role_name,
        has_table_privilege(role_name,'public.future_object','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') any_public_table,
        has_sequence_privilege(role_name,'public.future_object_id_seq','SELECT,UPDATE,USAGE') any_public_sequence,
        has_function_privilege(role_name,'public.future_function()','EXECUTE') future_function_execute,
        has_type_privilege(role_name,'public.future_state','USAGE') future_type_usage,
        has_table_privilege(role_name,'other_app.future_other','SELECT') other_schema_select,
        has_table_privilege(role_name,'public.supabase_future','SELECT') supabase_creator_select
      FROM unnest(ARRAY['anon','authenticated','meddecode_scoped_worker','meddecode_worker','service_role']) role_name
      ORDER BY role_name
    `);
    for (const row of matrix.rows.filter(row => row.role_name !== "service_role")) {
      assert.equal(row.any_public_table, false, `${row.role_name} future public table`);
      assert.equal(row.any_public_sequence, false, `${row.role_name} future public sequence`);
    }
    const service = matrix.rows.find(row => row.role_name === "service_role");
    assert.ok(service);
    assert.equal(service.any_public_table, true);
    assert.equal(service.any_public_sequence, true);

    for (const role of ["anon", "authenticated"]) {
      const row = matrix.rows.find(candidate => candidate.role_name === role);
      assert.equal(row?.future_function_execute, true, `${role} function default intentionally unchanged`);
      assert.equal(row?.future_type_usage, true, `${role} type default intentionally unchanged`);
      assert.equal(row?.other_schema_select, true, `${role} other schema default unchanged`);
      assert.equal(row?.supabase_creator_select, true, `${role} supabase_admin default unchanged`);
    }

    await assert.rejects(admin.query(await sql("002_up.sql")), /postgres public table default ACL drift/);
    await admin.query("ROLLBACK");
  } finally {
    await admin.end();
    await database.stop();
  }
});
