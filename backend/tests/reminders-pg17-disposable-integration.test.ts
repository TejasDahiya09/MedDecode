import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Pool } from "pg";

import { startPrivatePostgres17 } from "./support/private-postgres17.js";

const migrationDir = resolve(
  __dirname,
  "../database/integration-migrations/202611160001_medication_reminders_v1"
);

async function runTest(): Promise<void> {
  console.log("=== STARTING LOCAL POSTGRESQL 17 REMINDERS INTEGRATION & SECURITY TEST ===");
  const cluster = await startPrivatePostgres17();
  const pgConfig = cluster.config;

  const adminPool = new Pool({
    ...pgConfig,
    connectionTimeoutMillis: 5000,
  });

  try {
    // 1. Verify PostgreSQL 17
    const versionRes = await adminPool.query("SELECT version(), current_setting('server_version_num')::integer as ver");
    console.log("Connected to PostgreSQL:", versionRes.rows[0]?.version);
    const majorVer = Math.floor(Number(versionRes.rows[0]?.ver) / 10000);
    assert.equal(majorVer, 17, "Target database must be PostgreSQL 17");

    assert.equal((await adminPool.query("SELECT current_database() AS name")).rows[0]?.name, "postgres");
    console.log("Verified task-owned disposable database: postgres");
  } finally {
    await adminPool.end();
  }

  // Pool for target database
  let targetPool = new Pool({
    ...pgConfig,
    connectionTimeoutMillis: 5000,
  });

  const userA = randomUUID();
  const userB = randomUUID();
  const cabinetItemA = randomUUID();
  const cabinetItemB = randomUUID();
  let reminderIdA = "";
  let reminderIdB = "";

  try {
    // 3. Synthetic Prerequisite Setup
    console.log("Setting up prerequisite schemas, tables, and roles...");
    await targetPool.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;

      CREATE TABLE public.users (
        id uuid PRIMARY KEY
      );

      CREATE TABLE public.medicine_cabinet (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        medicine_name text NOT NULL
      );
      ALTER TABLE public.medicine_cabinet ENABLE ROW LEVEL SECURITY;
      CREATE POLICY medicine_cabinet_owner ON public.medicine_cabinet
        FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
      GRANT ALL ON public.medicine_cabinet TO authenticated;

      INSERT INTO public.users(id) VALUES ('${userA}'), ('${userB}');
      INSERT INTO public.medicine_cabinet(id, user_id, medicine_name) VALUES
        ('${cabinetItemA}', '${userA}', 'User A Cabinet Medicine'),
        ('${cabinetItemB}', '${userB}', 'User B Cabinet Medicine');
    `);

    // Helper for authenticated client simulation
    async function withUserSession<T>(userId: string, role: string, fn: (client: any) => Promise<T>): Promise<T> {
      const client = await targetPool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL ROLE ${role}`);
        await client.query(`SET LOCAL "request.jwt.claim.sub" = '${userId}'`);
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    // 4. Apply Migration: 002_up.sql
    console.log("Applying 002_up.sql...");
    const upSql = await readFile(join(migrationDir, "002_up.sql"), "utf8");
    const cleanUpSql = upSql.replace(/\\set\s+[^\r\n]+/g, "");
    await targetPool.query(cleanUpSql);
    console.log("PASS: 002_up.sql applied successfully.");

    // 5. Apply Independent Verification: 003_verify.sql
    console.log("Applying 003_verify.sql (comprehensive catalog verification)...");
    const verifySql = await readFile(join(migrationDir, "003_verify.sql"), "utf8");
    const cleanVerifySql = verifySql.replace(/\\set\s+[^\r\n]+/g, "");
    const verifyRes = await targetPool.query(cleanVerifySql);
    console.log("PASS: 003_verify.sql executed successfully.");

    // 6. Test Nullable Cabinet Medicine Behavior
    console.log("Testing reminder creation with NULL medicine_id (allowed contract)...");
    const nullCabinetReminderId = await withUserSession(userA, "authenticated", async (c) => {
      const res = await c.query(
        `INSERT INTO public.medication_reminders
          (user_id, medicine_id, medicine_name, dosage, scheduled_time, recurrence)
         VALUES ($1, NULL, $2, $3, $4, $5) RETURNING id`,
        [userA, "Vitamin D3", "2000 IU", "08:00", "daily"]
      );
      return res.rows[0].id;
    });
    assert.ok(nullCabinetReminderId, "Reminder without cabinet link must be accepted");
    console.log("PASS: Reminder with NULL medicine_id successfully created.");

    // 7. Test Reminder Creation with User A's own medicine_cabinet item
    console.log("Testing reminder creation with User A's own cabinet medicine...");
    reminderIdA = await withUserSession(userA, "authenticated", async (c) => {
      const res = await c.query(
        `INSERT INTO public.medication_reminders
          (user_id, medicine_id, medicine_name, dosage, scheduled_time, scheduled_times, recurrence, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [userA, cabinetItemA, "Amoxicillin", "500 mg", "09:00", JSON.stringify(["09:00", "21:00"]), "twice_daily", "active", "Take after food"]
      );
      return res.rows[0].id;
    });
    assert.ok(reminderIdA, "Reminder with own cabinet item must succeed");
    console.log("PASS: User A created reminder with own cabinet item:", reminderIdA);

    // 8. SECURITY ATTACK 1A: User A attempts INSERT of a reminder referencing User B's cabinet item
    console.log("SECURITY ATTACK 1A: Testing cross-owner cabinet attack on INSERT...");
    await assert.rejects(
      withUserSession(userA, "authenticated", async (c) => {
        await c.query(
          `INSERT INTO public.medication_reminders
            (user_id, medicine_id, medicine_name, dosage, scheduled_time)
           VALUES ($1, $2, $3, $4, $5)`,
          [userA, cabinetItemB, "Stolen Cabinet Med", "100 mg", "10:00"]
        );
      }),
      (err: any) => {
        assert.match(err.message, /new row violates row-level security policy for table "medication_reminders"/);
        return true;
      },
      "User A must NOT be able to insert a reminder with User B's cabinet item"
    );
    console.log("PASS: Cross-owner cabinet attack on INSERT was BLOCKED by RLS.");

    // 9. SECURITY ATTACK 1B: User A attempts UPDATE of a reminder to steal User B's cabinet item
    console.log("SECURITY ATTACK 1B: Testing cross-owner cabinet attack on UPDATE...");
    await assert.rejects(
      withUserSession(userA, "authenticated", async (c) => {
        await c.query(
          `UPDATE public.medication_reminders SET medicine_id = $1 WHERE id = $2`,
          [cabinetItemB, reminderIdA]
        );
      }),
      (err: any) => {
        assert.match(err.message, /new row violates row-level security policy for table "medication_reminders"/);
        return true;
      },
      "User A must NOT be able to update a reminder to reference User B's cabinet item"
    );
    console.log("PASS: Cross-owner cabinet attack on UPDATE was BLOCKED by RLS.");

    // 10. User B creates a reminder for dose log cross-owner attack testing
    reminderIdB = await withUserSession(userB, "authenticated", async (c) => {
      const res = await c.query(
        `INSERT INTO public.medication_reminders
          (user_id, medicine_id, medicine_name, dosage, scheduled_time)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [userB, cabinetItemB, "User B Medicine", "10 mg", "14:00"]
      );
      return res.rows[0].id;
    });
    console.log("User B created reminder:", reminderIdB);

    // 11. SECURITY ATTACK 2A: User A attempts INSERT of dose log referencing User B's reminder with user_id = userA
    console.log("SECURITY ATTACK 2A: Cross-owner dose log INSERT (user_id = userA, reminder_id = reminderB)...");
    await assert.rejects(
      withUserSession(userA, "authenticated", async (c) => {
        await c.query(
          `INSERT INTO public.medication_dose_logs (reminder_id, user_id, dose_time, status)
           VALUES ($1, $2, now(), 'taken')`,
          [reminderIdB, userA]
        );
      }),
      (err: any) => {
        // Enforced by both foreign key (composite fk) and RLS WITH CHECK
        assert.match(
          err.message,
          /violates foreign key constraint "medication_dose_logs_reminder_user_fkey"|violates row-level security policy/
        );
        return true;
      },
      "User A must NOT be able to log dose against User B's reminder"
    );
    console.log("PASS: Cross-owner dose log INSERT was BLOCKED.");

    // 12. SECURITY ATTACK 2B: User A attempts INSERT of dose log with user_id = userB and reminder_id = reminderB
    console.log("SECURITY ATTACK 2B: Cross-owner dose log INSERT (user_id = userB, reminder_id = reminderB)...");
    await assert.rejects(
      withUserSession(userA, "authenticated", async (c) => {
        await c.query(
          `INSERT INTO public.medication_dose_logs (reminder_id, user_id, dose_time, status)
           VALUES ($1, $2, now(), 'taken')`,
          [reminderIdB, userB]
        );
      }),
      (err: any) => {
        assert.match(err.message, /violates row-level security policy for table "medication_dose_logs"/);
        return true;
      },
      "User A must NOT be able to insert dose log impersonating User B"
    );
    console.log("PASS: Impersonated dose log INSERT was BLOCKED by RLS.");

    // 13. Legitimate Dose Log by User A
    const doseTimeA = new Date("2026-11-16T09:00:00Z");
    let doseLogIdA = "";
    doseLogIdA = await withUserSession(userA, "authenticated", async (c) => {
      const res = await c.query(
        `INSERT INTO public.medication_dose_logs (reminder_id, user_id, dose_time, status, notes)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [reminderIdA, userA, doseTimeA, "taken", "Morning dose taken"]
      );
      return res.rows[0].id;
    });
    console.log("User A created dose log:", doseLogIdA);

    // 14. SECURITY ATTACK 2C: User A attempts UPDATE of their dose log to reference User B's reminder
    console.log("SECURITY ATTACK 2C: Cross-owner dose log UPDATE (changing reminder_id to reminderB)...");
    await assert.rejects(
      withUserSession(userA, "authenticated", async (c) => {
        await c.query(
          `UPDATE public.medication_dose_logs SET reminder_id = $1 WHERE id = $2`,
          [reminderIdB, doseLogIdA]
        );
      }),
      (err: any) => {
        assert.match(
          err.message,
          /violates foreign key constraint "medication_dose_logs_reminder_user_fkey"|violates row-level security policy/
        );
        return true;
      },
      "User A must NOT be able to update dose log to point to User B's reminder"
    );
    console.log("PASS: Cross-owner dose log UPDATE was BLOCKED.");

    // 15. Test Dose Log Idempotency (Duplicate Prevention)
    console.log("Testing dose log duplicate prevention...");
    await assert.rejects(
      withUserSession(userA, "authenticated", async (c) => {
        await c.query(
          `INSERT INTO public.medication_dose_logs (reminder_id, user_id, dose_time, status)
           VALUES ($1, $2, $3, 'taken')`,
          [reminderIdA, userA, doseTimeA]
        );
      }),
      (err: any) => {
        assert.match(err.message, /duplicate key value violates unique constraint|medication_dose_logs_reminder_id_dose_time_key/);
        return true;
      },
      "Duplicate dose log for same reminder and time must be rejected"
    );
    console.log("PASS: Duplicate dose log prevented by unique constraint.");

    // 16. Anonymous Denial
    console.log("Testing anonymous denial...");
    const testAnonOp = async (queryText: string, params: any[] = []) => {
      const anonClient = await targetPool.connect();
      try {
        await anonClient.query("BEGIN");
        await anonClient.query("SET LOCAL ROLE anon");
        await anonClient.query(queryText, params);
        await anonClient.query("ROLLBACK");
      } catch (err: any) {
        try { await anonClient.query("ROLLBACK"); } catch {}
        throw err;
      } finally {
        anonClient.release();
      }
    };

    await assert.rejects(
      testAnonOp("SELECT * FROM public.medication_reminders"),
      /permission denied for table medication_reminders/
    );
    await assert.rejects(
      testAnonOp("SELECT * FROM public.medication_dose_logs"),
      /permission denied for table medication_dose_logs/
    );
    console.log("PASS: Anonymous access strictly denied.");

    // 17. Test Persistence Across Server / Connection Restart
    console.log("Simulating server restart & fresh connection pool...");
    await targetPool.end();

    targetPool = new Pool({
      ...pgConfig,
      connectionTimeoutMillis: 5000,
    });

    await withUserSession(userA, "authenticated", async (c) => {
      const rem = await c.query("SELECT * FROM public.medication_reminders WHERE id = $1", [reminderIdA]);
      assert.equal(rem.rows.length, 1);
      assert.equal(rem.rows[0].medicine_name, "Amoxicillin");
      assert.equal(rem.rows[0].medicine_id, cabinetItemA);

      const dose = await c.query("SELECT * FROM public.medication_dose_logs WHERE id = $1", [doseLogIdA]);
      assert.equal(dose.rows.length, 1);
      assert.equal(dose.rows[0].status, "taken");
    });
    console.log("PASS: Reminder & dose log persisted across restart.");

    // 18. Test Rollback (004_rollback_review.sql)
    console.log("Testing 004_rollback_review.sql...");
    const rollbackSql = await readFile(join(migrationDir, "004_rollback_review.sql"), "utf8");
    const cleanRollbackSql = rollbackSql.replace(/\\set\s+[^\r\n]+/g, "");
    await targetPool.query(cleanRollbackSql);

    const checkDrop = await targetPool.query(`
      SELECT to_regclass('public.medication_reminders') as rem,
             to_regclass('public.medication_dose_logs') as dose;
    `);
    assert.equal(checkDrop.rows[0].rem, null);
    assert.equal(checkDrop.rows[0].dose, null);
    console.log("PASS: Rollback cleanly dropped tables and policies.");

    // 19. Test Reapplication (Clean reapplication test)
    console.log("Testing clean reapplication after rollback...");
    await targetPool.query(cleanUpSql);
    await targetPool.query(cleanVerifySql);
    console.log("PASS: Migration successfully re-applied and re-verified.");

  } finally {
    await targetPool.end();
    await cluster.stop();
  }

  console.log("=== ALL POSTGRESQL 17 REMINDERS INTEGRATION & SECURITY TESTS PASSED ===");
}

test("PostgreSQL 17 reminders migration and security behavior", runTest);
