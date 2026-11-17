import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Pool, type PoolClient } from "pg";

import { startPrivatePostgres17 } from "./support/private-postgres17.js";

const originalDir = resolve(__dirname, "../database/integration-migrations/202611160001_medication_reminders_v1");
const fixDir = resolve(__dirname, "../database/integration-migrations/202611160012_medication_reminders_security_fix_v2");

function sqlForNode(sql: string): string {
  return sql.replace(/^\\set\s+[^\r\n]+\r?\n/gm, "");
}

async function sqlFile(dir: string, filename: string): Promise<string> {
  return sqlForNode(await readFile(join(dir, filename), "utf8"));
}

async function asUser<T>(pool: Pool, userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("PostgreSQL 17 reminder security repair revokes anon and enforces Cabinet ownership", async (t) => {
  const cluster = await startPrivatePostgres17();
  const admin = new Pool({ ...cluster.config, connectionTimeoutMillis: 5000 });
  const userA = randomUUID();
  const userB = randomUUID();
  const cabinetA = randomUUID();
  const cabinetB = randomUUID();
  let target: Pool | undefined;

  try {
    const version = await admin.query("SELECT current_setting('server_version_num')::int AS version_num");
    assert.equal(Math.floor(Number(version.rows[0].version_num) / 10000), 17);
    assert.equal((await admin.query("SELECT current_database() AS name")).rows[0]?.name, "postgres");
    target = new Pool({ ...cluster.config, connectionTimeoutMillis: 5000 });

    await target.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE TABLE public.users (id uuid PRIMARY KEY);
      CREATE TABLE public.medicine_cabinet (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES public.users(id),
        medicine_name text NOT NULL,
        medicine_id uuid
      );
      ALTER TABLE public.medicine_cabinet ENABLE ROW LEVEL SECURITY;
      CREATE POLICY medicine_cabinet_owner ON public.medicine_cabinet
        FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicine_cabinet TO authenticated;
      INSERT INTO public.users(id) VALUES ('${userA}'), ('${userB}');
      INSERT INTO public.medicine_cabinet(id, user_id, medicine_name) VALUES
        ('${cabinetA}', '${userA}', 'Synthetic A'),
        ('${cabinetB}', '${userB}', 'Synthetic B');
    `);

    // Recreate the deployed faulty state: original schema plus overly broad
    // grants supplied by a table-default/parallel deployment path.
    await target.query(await sqlFile(originalDir, "002_up.sql"));
    await target.query(`
      GRANT ALL PRIVILEGES ON public.medication_reminders, public.medication_dose_logs TO anon, authenticated;
      GRANT SELECT (medicine_name), UPDATE (scheduled_time) ON public.medication_reminders TO anon;
      GRANT REFERENCES (reminder_id) ON public.medication_dose_logs TO anon;
    `);
    const defective = await target.query(`
      SELECT
        has_table_privilege('anon', 'public.medication_reminders', 'SELECT') AS reminder_select,
        has_table_privilege('anon', 'public.medication_dose_logs', 'INSERT') AS log_insert,
        has_column_privilege('anon', 'public.medication_reminders', 'medicine_name', 'SELECT') AS reminder_column_select,
        (SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
          WHERE polrelid = 'public.medication_reminders'::regclass
            AND polname = 'medication_reminders_owner_insert') AS insert_check
    `);
    assert.equal(defective.rows[0].reminder_select, true);
    assert.equal(defective.rows[0].log_insert, true);
    assert.equal(defective.rows[0].reminder_column_select, true);
    assert.match(String(defective.rows[0].insert_check), /mc\.id = mc\.medicine_id/);

    // Demonstrate fail-closed behavior when anon inherits another role's CRUD.
    // Membership is changed only inside this local test transaction and rolled back.
    await target.query("BEGIN; GRANT authenticated TO anon");
    await assert.rejects(target.query(await sqlFile(fixDir, "002_up.sql")), /unexpected effective privilege/);
    await target.query("ROLLBACK");
    assert.equal((await target.query("SELECT has_table_privilege('anon','public.medication_reminders','TRUNCATE') AS ok")).rows[0].ok,true);
    await target.query(await sqlFile(fixDir, "001_preflight.sql"));
    await target.query(await sqlFile(fixDir, "002_up.sql"));
    await target.query(await sqlFile(fixDir, "003_verify.sql"));

    const repaired = await target.query(`
      SELECT
        has_table_privilege('anon', 'public.medication_reminders', 'SELECT') AS reminder_select,
        has_table_privilege('anon', 'public.medication_reminders', 'INSERT') AS reminder_insert,
        has_table_privilege('anon', 'public.medication_dose_logs', 'UPDATE') AS log_update,
        has_column_privilege('anon', 'public.medication_reminders', 'medicine_name', 'SELECT') AS reminder_column_select,
        has_column_privilege('anon', 'public.medication_dose_logs', 'reminder_id', 'REFERENCES') AS dose_log_column_reference,
        has_table_privilege('authenticated', 'public.medication_reminders', 'DELETE') AS authenticated_delete,
        (SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
          WHERE polrelid = 'public.medication_reminders'::regclass
            AND polname = 'medication_reminders_owner_insert') AS insert_check
    `);
    assert.equal(repaired.rows[0].reminder_select, false);
    assert.equal(repaired.rows[0].reminder_insert, false);
    assert.equal(repaired.rows[0].log_update, false);
    assert.equal(repaired.rows[0].reminder_column_select, false);
    assert.equal(repaired.rows[0].dose_log_column_reference, false);
    assert.equal(repaired.rows[0].authenticated_delete, true);
    assert.match(String(repaired.rows[0].insert_check), /medication_reminders\.medicine_id/);
    assert.doesNotMatch(String(repaired.rows[0].insert_check), /mc\.id = mc\.medicine_id/);

    const snapshot = async () => (await target!.query("SELECT md5(jsonb_build_object('reminders',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.medication_reminders r),'logs',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.medication_dose_logs d),'cabinet',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.medicine_cabinet c))::text) AS hash")).rows[0].hash;
    const mutations: [string,string][] = [
      ['missing policy','DROP POLICY medication_reminders_owner_select ON public.medication_reminders'],
      ['NULL predicate','DROP POLICY medication_reminders_owner_select ON public.medication_reminders; CREATE POLICY medication_reminders_owner_select ON public.medication_reminders FOR SELECT TO authenticated'],
      ['wrong correlation',"ALTER POLICY medication_reminders_owner_insert ON public.medication_reminders WITH CHECK ((SELECT auth.uid())=user_id AND (medicine_id IS NULL OR EXISTS(SELECT FROM public.medicine_cabinet mc WHERE mc.id=mc.medicine_id AND mc.user_id=(SELECT auth.uid()))))"],
      ['unsafe added clause',"ALTER POLICY medication_reminders_owner_insert ON public.medication_reminders WITH CHECK (((SELECT auth.uid())=user_id AND (medicine_id IS NULL OR EXISTS(SELECT FROM public.medicine_cabinet mc WHERE mc.id=public.medication_reminders.medicine_id AND mc.user_id=(SELECT auth.uid())))) OR true)"],
      ['wrong role','ALTER POLICY medication_reminders_owner_select ON public.medication_reminders TO anon'],
      ['wrong command','DROP POLICY medication_reminders_owner_select ON public.medication_reminders; CREATE POLICY medication_reminders_owner_select ON public.medication_reminders FOR ALL TO authenticated USING(auth.uid()=user_id)'],
      ['wrong permissive mode','DROP POLICY medication_reminders_owner_select ON public.medication_reminders; CREATE POLICY medication_reminders_owner_select ON public.medication_reminders AS RESTRICTIVE FOR SELECT TO authenticated USING(auth.uid()=user_id)'],
      ['worker table privilege',"DO $$ BEGIN IF to_regrole('meddecode_scoped_worker') IS NULL THEN CREATE ROLE meddecode_scoped_worker NOLOGIN; END IF; END $$; GRANT SELECT ON public.medication_reminders TO meddecode_scoped_worker"],
      ['worker column privilege',"DO $$ BEGIN IF to_regrole('meddecode_scoped_worker') IS NULL THEN CREATE ROLE meddecode_scoped_worker NOLOGIN; END IF; END $$; GRANT SELECT(medicine_name) ON public.medication_reminders TO meddecode_scoped_worker"],
      ['inherited REFERENCES','CREATE ROLE meddecode_v2_reference_fixture NOLOGIN; GRANT REFERENCES(medicine_name) ON public.medication_reminders TO meddecode_v2_reference_fixture; GRANT meddecode_v2_reference_fixture TO authenticated'],
      ['column REFERENCES','GRANT REFERENCES(medicine_name) ON public.medication_reminders TO authenticated'],
      ['anon TRUNCATE','GRANT TRUNCATE ON public.medication_reminders TO anon'],
      ['wrong owner','ALTER TABLE public.medication_reminders OWNER TO authenticated'],
      ['RLS disabled','ALTER TABLE public.medication_reminders DISABLE ROW LEVEL SECURITY'],
    ];
    for (const [name,sql] of mutations) await t.test(`independent verifier rejects ${name}`, async () => {
      const before = await snapshot();
      const client = await target!.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await assert.rejects(client.query(await sqlFile(fixDir,'003_verify.sql')), /verification/);
      } finally { await client.query('ROLLBACK'); client.release(); }
      assert.equal(await snapshot(),before);
      await target!.query(await sqlFile(fixDir,'003_verify.sql'));
    });
    const denied = async (role: string, statement: string, params: unknown[] = []) => {
      const before = await snapshot();
      const c = await target!.connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE " + role);
        await assert.rejects(c.query(statement, params), /permission denied|row-level security|foreign key/);
      } finally { await c.query("ROLLBACK"); c.release(); }
      assert.equal(await snapshot(), before);
    };
    const rollbackReview = await target.connect();
    try {
      await rollbackReview.query(await sqlFile(fixDir, "004_rollback_review.sql"));
      await rollbackReview.query("ROLLBACK");
    } finally {
      rollbackReview.release();
    }

    const nullReminder = await asUser(target, userA, async (client) => {
      const result = await client.query(
        `INSERT INTO public.medication_reminders (user_id, medicine_id, medicine_name, scheduled_time)
         VALUES ($1, NULL, 'No Cabinet Link', '08:00') RETURNING id`,
        [userA]
      );
      return String(result.rows[0].id);
    });
    assert.ok(nullReminder);

    const reminderA = await asUser(target, userA, async (client) => {
      const result = await client.query(
        `INSERT INTO public.medication_reminders (user_id, medicine_id, medicine_name, scheduled_time)
         VALUES ($1, $2, 'A Medicine', '09:00') RETURNING id`,
        [userA, cabinetA]
      );
      return String(result.rows[0].id);
    });
    const reminderB = await asUser(target, userB, async (client) => {
      const result = await client.query(
        `INSERT INTO public.medication_reminders (user_id, medicine_id, medicine_name, scheduled_time)
         VALUES ($1, $2, 'B Medicine', '10:00') RETURNING id`,
        [userB, cabinetB]
      );
      return String(result.rows[0].id);
    });

    await assert.rejects(
      asUser(target, userA, (client) => client.query(
        `INSERT INTO public.medication_reminders (user_id, medicine_id, medicine_name, scheduled_time)
         VALUES ($1, $2, 'Cross Owner', '11:00')`, [userA, cabinetB]
      )),
      /row-level security/
    );
    await assert.rejects(
      asUser(target, userA, (client) => client.query(
        "UPDATE public.medication_reminders SET medicine_id = $1 WHERE id = $2", [cabinetB, reminderA]
      )),
      /row-level security/
    );

    const doseTime = "2026-11-16T09:00:00Z";
    await asUser(target, userA, (client) => client.query(
      `INSERT INTO public.medication_dose_logs (reminder_id, user_id, dose_time, status)
       VALUES ($1, $2, $3, 'taken')`, [reminderA, userA, doseTime]
    ));
    await assert.rejects(
      asUser(target, userA, (client) => client.query(
        `INSERT INTO public.medication_dose_logs (reminder_id, user_id, dose_time, status)
         VALUES ($1, $2, now(), 'taken')`, [reminderB, userA]
      )),
      /foreign key|row-level security/
    );
    await assert.rejects(
      asUser(target, userA, (client) => client.query(
        `INSERT INTO public.medication_dose_logs (reminder_id, user_id, dose_time, status)
         VALUES ($1, $2, $3, 'taken')`, [reminderA, userA, doseTime]
      )),
      /duplicate key/
    );

    for (const table of ["medication_reminders","medication_dose_logs"]) {
      for (const statement of ["SELECT * FROM ", "UPDATE ", "DELETE FROM ", "TRUNCATE "]) {
        const sql = statement === "UPDATE " ? "UPDATE public." + table + " SET user_id=user_id" : statement + "public." + table;
        await denied("anon",sql);
      }
    }
    await denied("anon","INSERT INTO public.medication_reminders(user_id,medicine_name,scheduled_time) VALUES ($1,'Denied','12:00')",[userA]);
    await denied("anon","INSERT INTO public.medication_dose_logs(reminder_id,user_id,dose_time,status) VALUES ($1,$2,now(),'taken')",[reminderA,userA]);
    await denied("authenticated","TRUNCATE public.medication_reminders");
    for (const privilege of ["REFERENCES","TRIGGER"]) assert.equal((await target.query("SELECT has_table_privilege('authenticated','public.medication_reminders',$1) AS ok",[privilege])).rows[0].ok,false);
    await assert.rejects(asUser(target,userA,c=>c.query("UPDATE public.medication_dose_logs SET reminder_id=$1 WHERE reminder_id=$2",[reminderB,reminderA])),/foreign key|row-level security/);
    await asUser(target,userA,async c=>{
      assert.ok((await c.query("SELECT id FROM public.medication_reminders WHERE id=$1",[reminderA])).rows.length);
      await c.query("UPDATE public.medication_reminders SET notes='Synthetic persisted' WHERE id=$1",[reminderA]);
      await c.query("DELETE FROM public.medication_reminders WHERE id=$1",[nullReminder]);
    });
    const reconnect = new Pool(cluster.config);
    try { assert.equal((await reconnect.query("SELECT notes FROM public.medication_reminders WHERE id=$1",[reminderA])).rows[0].notes,"Synthetic persisted"); } finally { await reconnect.end(); }
    await target.query("BEGIN");
    await target.query("ALTER POLICY medication_reminders_owner_insert ON public.medication_reminders WITH CHECK (true)");
    await assert.rejects(target.query(await sqlFile(fixDir,"003_verify.sql")),/predicate|correlation|verification/);
    await target.query("ROLLBACK");

    // A second application is deliberately blocked by the defect-state
    // precondition rather than silently changing a subsequently altered ACL.
    const secondApplication = await target.connect();
    try {
      await assert.rejects(
        secondApplication.query(await sqlFile(fixDir, "002_up.sql")),
        /expected deployed Cabinet policy defect is absent/
      );
      await secondApplication.query("ROLLBACK");
    } finally {
      secondApplication.release();
    }
  } finally {
    await target?.end();
    await admin.end();
    await cluster.stop();
  }
});
