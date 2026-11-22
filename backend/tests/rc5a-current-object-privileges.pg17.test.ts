import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { startPrivatePostgres17 } from "./support/private-postgres17.js";

const migration = resolve(
  __dirname,
  "../database/integration-migrations/202611190014_current_object_privilege_hardening_v1",
);
const tables = [
  "active_ingredients", "ai_jobs", "analytics_events", "audit_logs", "family_members",
  "health_profiles", "manufacturers", "medicine_aliases", "medicine_cabinet",
  "medicine_contract_identifiers", "medicine_contraindications", "medicine_ingredients",
  "medicine_interactions", "medicine_precautions", "medicine_prices", "medicine_side_effects",
  "medicine_similarities", "medicine_sources", "medicines", "notifications",
  "prescription_intelligence_results", "prescription_medicine_alternatives",
  "prescription_medicines", "prescription_recommendations", "prescription_warnings",
  "prescriptions", "users",
] as const;

async function sql(name: string): Promise<string> {
  return (await readFile(resolve(migration, name), "utf8"))
    .split(/\r?\n/)
    .filter(line => !line.startsWith("\\set "))
    .join("\n");
}

async function rejected(client: PoolClient, statement: string, code = "42501"): Promise<void> {
  await assert.rejects(client.query(statement), (error: NodeJS.ErrnoException) => error.code === code);
}

test("Migration 014 preserves CRUD/RLS and removes current-object privilege escalation paths", { timeout: 120_000 }, async () => {
  const database = await startPrivatePostgres17();
  const admin = new Pool({ ...database.config, max: 1 });
  try {
    await admin.query(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE ROLE meddecode_scoped_worker NOLOGIN NOINHERIT;
      CREATE ROLE meddecode_worker NOLOGIN NOINHERIT;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE
        AS 'SELECT current_setting(''request.jwt.claim.sub'',true)';
      GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role,
        meddecode_scoped_worker,meddecode_worker;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
    `);

    for (const table of tables) {
      await admin.query(`
        CREATE TABLE public.${table} (
          id text PRIMARY KEY,
          user_id text NOT NULL,
          value text,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
        CREATE POLICY ${table}_owner_all ON public.${table}
          FOR ALL TO authenticated
          USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
        GRANT ALL PRIVILEGES ON public.${table} TO anon,authenticated,service_role;
      `);
    }
    await admin.query(`
      REVOKE UPDATE ON public.ai_jobs FROM anon;
      REVOKE INSERT,UPDATE ON public.ai_jobs FROM authenticated;

      CREATE TABLE public.trigger_events (event_name text NOT NULL);

      CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS
        'BEGIN NEW.updated_at=clock_timestamp(); RETURN NEW; END';
      CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS
        'BEGIN NEW.updated_at=clock_timestamp(); RETURN NEW; END';
      CREATE FUNCTION public.validate_cabinet_family_member() RETURNS trigger LANGUAGE plpgsql AS
        'BEGIN IF NEW.value=''blocked'' THEN RAISE EXCEPTION ''blocked cabinet reference''; END IF; RETURN NEW; END';
      CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql
        SECURITY DEFINER SET search_path=public AS
        'BEGIN INSERT INTO public.trigger_events(event_name) VALUES (''handle_new_user''); RETURN NEW; END';
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

      CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
      CREATE TRIGGER active_ingredients_updated BEFORE UPDATE ON public.active_ingredients
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
      CREATE TRIGGER medicine_cabinet_validate BEFORE INSERT OR UPDATE ON public.medicine_cabinet
        FOR EACH ROW EXECUTE FUNCTION public.validate_cabinet_family_member();
      CREATE TRIGGER analytics_handle_user AFTER INSERT ON public.analytics_events
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
    `);

    await admin.query("REVOKE DELETE ON public.users FROM anon");
    await assert.rejects(admin.query(await sql("001_preflight.sql")), /reviewed CRUD matrix changed/);
    await admin.query("ROLLBACK");
    await admin.query("GRANT DELETE ON public.users TO anon");
    await admin.query(await sql("001_preflight.sql"));

    const before = await admin.query(`
      SELECT c.relname,c.relacl::text,c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[])
      ORDER BY c.relname
    `, [tables]);
    const policiesBefore = await admin.query(`
      SELECT count(*)::integer AS count FROM pg_policy p
      JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    `, [tables]);

    await admin.query("REVOKE DELETE ON public.users FROM anon");
    await assert.rejects(admin.query(await sql("002_up.sql")), /reviewed CRUD matrix changed/);
    await admin.query("ROLLBACK");
    await admin.query("GRANT DELETE ON public.users TO anon");
    await admin.query(await sql("002_up.sql"));
    await admin.query(await sql("003_verify.sql"));

    const after = await admin.query(`
      SELECT c.relname,c.relacl::text,c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[])
      ORDER BY c.relname
    `, [tables]);
    assert.equal(after.rowCount, 27);
    assert.ok(after.rows.every(row => row.relrowsecurity === true));
    assert.notDeepEqual(after.rows, before.rows, "only ACL removals should change table metadata");
    const policiesAfter = await admin.query(`
      SELECT count(*)::integer AS count FROM pg_policy p
      JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    `, [tables]);
    assert.deepEqual(policiesAfter.rows, policiesBefore.rows);

    const owner = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const app = await admin.connect();
    try {
      await app.query("SET ROLE authenticated");
      await app.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
      await app.query("INSERT INTO public.users(id,user_id,value) VALUES ('owned',$1,'initial')", [owner]);
      assert.equal((await app.query("SELECT count(*)::integer AS count FROM public.users")).rows[0]?.count, 1);
      await app.query("UPDATE public.users SET value='updated' WHERE id='owned'");
      const updatedUser = (await app.query("SELECT value,updated_at > '2020-01-01'::timestamptz AS trigger_ran FROM public.users WHERE id='owned'")).rows[0];
      assert.equal(updatedUser?.value, "updated");
      assert.equal(updatedUser?.trigger_ran, true);
      await app.query("INSERT INTO public.active_ingredients(id,user_id,value,updated_at) VALUES ('ingredient',$1,'initial','2000-01-01')", [owner]);
      await app.query("UPDATE public.active_ingredients SET value='updated' WHERE id='ingredient'");
      assert.equal((await app.query("SELECT updated_at > '2020-01-01'::timestamptz AS trigger_ran FROM public.active_ingredients WHERE id='ingredient'")).rows[0]?.trigger_ran, true);
      await app.query("INSERT INTO public.medicine_cabinet(id,user_id,value) VALUES ('cabinet',$1,'allowed')", [owner]);
      await rejected(app, `INSERT INTO public.medicine_cabinet(id,user_id,value) VALUES ('blocked','${owner}','blocked')`, "P0001");
      await app.query("INSERT INTO public.analytics_events(id,user_id,value) VALUES ('event',$1,'ok')", [owner]);
      await rejected(app, "INSERT INTO public.users(id,user_id,value) VALUES ('cross','" + other + "','no')");
      assert.equal((await app.query("UPDATE public.users SET value='cross' WHERE user_id=$1", [other])).rowCount, 0);
      await rejected(app, "TRUNCATE public.users");
      await rejected(app, "SELECT public.set_updated_at()");
      await app.query("DELETE FROM public.users WHERE id='owned'");
      await app.query("RESET ROLE");
    } finally {
      app.release();
    }
    assert.equal((await admin.query("SELECT count(*)::integer AS count FROM public.trigger_events WHERE event_name='handle_new_user'")).rows[0]?.count, 1);

    const anonymous = await admin.connect();
    try {
      await anonymous.query("SET ROLE anon");
      assert.equal((await anonymous.query("SELECT count(*)::integer AS count FROM public.users")).rows[0]?.count, 0);
      await rejected(anonymous, `INSERT INTO public.users(id,user_id,value) VALUES ('anon','${owner}','no')`);
      await rejected(anonymous, "TRUNCATE public.users");
      await rejected(anonymous, "SELECT public.handle_new_user()");
      await anonymous.query("RESET ROLE");
    } finally {
      anonymous.release();
    }

    const privilegeMatrix = await admin.query(`
      SELECT role_name,
        has_table_privilege(role_name,'public.users','TRUNCATE') AS truncate,
        has_table_privilege(role_name,'public.users','REFERENCES') AS references,
        has_table_privilege(role_name,'public.users','TRIGGER') AS trigger,
        has_table_privilege(role_name,'public.users','MAINTAIN') AS maintain
      FROM unnest(ARRAY['anon','authenticated','meddecode_scoped_worker','meddecode_worker','service_role']) role_name
      ORDER BY role_name
    `);
    for (const row of privilegeMatrix.rows.filter(row => row.role_name !== "service_role")) {
      assert.deepEqual([row.truncate,row.references,row.trigger,row.maintain],[false,false,false,false]);
    }
    const service = privilegeMatrix.rows.find(row => row.role_name === "service_role");
    assert.deepEqual([service?.truncate,service?.references,service?.trigger,service?.maintain],[true,true,true,true]);
    const maintenance = await admin.connect();
    try {
      await maintenance.query("SET ROLE service_role");
      await maintenance.query("TRUNCATE public.audit_logs");
      await maintenance.query("RESET ROLE");
    } finally {
      maintenance.release();
    }

    await assert.rejects(admin.query(await sql("002_up.sql")), /reviewed privilege state changed/);
  } finally {
    await admin.end();
    await database.stop();
  }
});
