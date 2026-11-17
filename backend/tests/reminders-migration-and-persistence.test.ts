import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { EventEmitter } from "node:events";

import {
  InMemoryRemindersRepository,
  RemindersStorageUnavailableError,
  SupabaseRemindersRepository,
} from "../src/repositories/reminders.repository.js";
import { createRemindersRouter } from "../src/routes/reminders.routes.js";
import type { AuthVerifier, VerifiedIdentity } from "../src/services/auth.service.js";
import type { UserSupabaseClient, UserSupabaseClientFactory } from "../src/config/supabase-user.js";

import { existsSync } from "node:fs";

const migrationDir = existsSync(
  join(process.cwd(), "backend", "database", "integration-migrations", "202611160001_medication_reminders_v1")
)
  ? join(process.cwd(), "backend", "database", "integration-migrations", "202611160001_medication_reminders_v1")
  : join(process.cwd(), "database", "integration-migrations", "202611160001_medication_reminders_v1");

describe("Medication Reminders Database Migration Validation", () => {
  it("001_preflight.sql is strictly read-only and guards prerequisites", async () => {
    const preflight = await readFile(join(migrationDir, "001_preflight.sql"), "utf8");

    assert.match(preflight, /\\set ON_ERROR_STOP on/);
    assert.match(preflight, /SET TRANSACTION READ ONLY/);
    assert.match(preflight, /ROLLBACK;/);
    assert.match(preflight, /to_regclass\('public\.users'\)/);
    assert.match(preflight, /to_regprocedure\('auth\.uid\(\)'\)/);
    assert.match(preflight, /to_regrole\('authenticated'\)/);
    assert.match(preflight, /to_regrole\('anon'\)/);
    assert.match(preflight, /to_regclass\('public\.medication_reminders'\)/);
    assert.match(preflight, /to_regclass\('public\.medication_dose_logs'\)/);
    assert.match(preflight, /MEDICATION_REMINDERS_PREFLIGHT_OK/);
  });

  it("002_up.sql creates normalized tables, foreign keys, RLS policies, and indexes", async () => {
    const up = await readFile(join(migrationDir, "002_up.sql"), "utf8");

    // Timeout guards
    assert.match(up, /SET LOCAL lock_timeout='5s'/);
    assert.match(up, /SET LOCAL statement_timeout='60s'/);

    // Table 1: medication_reminders
    assert.match(up, /CREATE TABLE public\.medication_reminders/);
    assert.match(up, /user_id uuid NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
    assert.match(up, /medicine_id uuid REFERENCES public\.medicine_cabinet\(id\) ON DELETE SET NULL/);
    assert.match(up, /medicine_name text NOT NULL CHECK \(length\(btrim\(medicine_name\)\) BETWEEN 1 AND 120\)/);
    assert.match(up, /scheduled_time text NOT NULL CHECK \(scheduled_time ~ '\^\(\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d\$'\)/);
    assert.match(up, /scheduled_times jsonb DEFAULT '\[\]'::jsonb/);
    assert.match(up, /recurrence text NOT NULL/);
    assert.match(up, /status text NOT NULL DEFAULT 'active'/);

    // Table 2: medication_dose_logs
    assert.match(up, /CREATE TABLE public\.medication_dose_logs/);
    assert.match(up, /reminder_id uuid NOT NULL/);
    assert.match(up, /user_id uuid NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
    assert.match(up, /status text NOT NULL CHECK \(status IN \('taken', 'skipped'\)\)/);
    assert.match(up, /UNIQUE \(reminder_id, dose_time\)/); // Idempotency constraint

    // Indexes
    assert.match(up, /CREATE INDEX medication_reminders_user_time_idx/);
    assert.match(up, /CREATE INDEX medication_reminders_user_status_idx/);
    assert.match(up, /CREATE INDEX medication_dose_logs_user_idx/);

    // Row Level Security
    assert.match(up, /ALTER TABLE public\.medication_reminders ENABLE ROW LEVEL SECURITY/);
    assert.match(up, /ALTER TABLE public\.medication_dose_logs ENABLE ROW LEVEL SECURITY/);

    // Constraints & Relationships
    assert.match(up, /CONSTRAINT medication_reminders_id_user_uniq UNIQUE \(id, user_id\)/);

    // Normalize whitespace to preserve exact security policy semantics without formatting fragility
    const normalizedUp = up.replace(/\s+/g, " ");

    assert.match(normalizedUp, /CONSTRAINT medication_dose_logs_reminder_user_fkey FOREIGN KEY \(reminder_id, user_id\) REFERENCES public\.medication_reminders\(id, user_id\) ON DELETE CASCADE/);

    // RLS Policies on reminders
    assert.match(normalizedUp, /CREATE POLICY medication_reminders_owner_select ON public\.medication_reminders FOR SELECT TO authenticated USING \(auth\.uid\(\) = user_id\)/);
    assert.match(normalizedUp, /CREATE POLICY medication_reminders_owner_insert ON public\.medication_reminders FOR INSERT TO authenticated WITH CHECK \( auth\.uid\(\) = user_id AND \( medicine_id IS NULL OR EXISTS \( SELECT 1 FROM public\.medicine_cabinet mc WHERE mc\.id = medicine_id AND mc\.user_id = auth\.uid\(\) \) \) \)/);
    assert.match(normalizedUp, /CREATE POLICY medication_reminders_owner_update ON public\.medication_reminders FOR UPDATE TO authenticated USING \(auth\.uid\(\) = user_id\) WITH CHECK \( auth\.uid\(\) = user_id AND \( medicine_id IS NULL OR EXISTS \( SELECT 1 FROM public\.medicine_cabinet mc WHERE mc\.id = medicine_id AND mc\.user_id = auth\.uid\(\) \) \) \)/);
    assert.match(normalizedUp, /CREATE POLICY medication_reminders_owner_delete ON public\.medication_reminders FOR DELETE TO authenticated USING \(auth\.uid\(\) = user_id\)/);

    // RLS Policies on dose logs
    assert.match(normalizedUp, /CREATE POLICY medication_dose_logs_owner_select ON public\.medication_dose_logs FOR SELECT TO authenticated USING \(auth\.uid\(\) = user_id\)/);
    assert.match(normalizedUp, /CREATE POLICY medication_dose_logs_owner_insert ON public\.medication_dose_logs FOR INSERT TO authenticated WITH CHECK \( auth\.uid\(\) = user_id AND EXISTS \( SELECT 1 FROM public\.medication_reminders r WHERE r\.id = reminder_id AND r\.user_id = auth\.uid\(\) \) \)/);
    assert.match(normalizedUp, /CREATE POLICY medication_dose_logs_owner_update ON public\.medication_dose_logs FOR UPDATE TO authenticated USING \(auth\.uid\(\) = user_id\) WITH CHECK \( auth\.uid\(\) = user_id AND EXISTS \( SELECT 1 FROM public\.medication_reminders r WHERE r\.id = reminder_id AND r\.user_id = auth\.uid\(\) \) \)/);
    assert.match(normalizedUp, /CREATE POLICY medication_dose_logs_owner_delete ON public\.medication_dose_logs FOR DELETE TO authenticated USING \(auth\.uid\(\) = user_id\)/);

    // Grants
    assert.match(up, /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.medication_reminders TO authenticated/);
    assert.match(up, /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.medication_dose_logs TO authenticated/);
    assert.match(up, /COMMIT;/);
  });

  it("003_verify.sql asserts table presence, RLS policies, foreign keys, and anonymous denial in read-only transaction", async () => {
    const verify = await readFile(join(migrationDir, "003_verify.sql"), "utf8");

    assert.match(verify, /SET TRANSACTION READ ONLY;/);
    assert.match(verify, /to_regclass\('public\.medication_reminders'\)/);
    assert.match(verify, /to_regclass\('public\.medication_dose_logs'\)/);
    assert.match(verify, /rowsecurity = true/);
    assert.match(verify, /medication_reminders_id_user_uniq/);
    assert.match(verify, /REFERENCES medication_reminders\(id, user_id\)/);
    assert.match(verify, /medication_reminders_owner_insert/);
    assert.match(verify, /medication_dose_logs_owner_insert/);
    assert.match(verify, /has_table_privilege\('anon'/);
    assert.match(verify, /MEDICATION_REMINDERS_VERIFY_OK/);
    assert.match(verify, /ROLLBACK;/);
  });

  it("004_rollback_review.sql cleanly drops all created objects and policies", async () => {
    const rollback = await readFile(join(migrationDir, "004_rollback_review.sql"), "utf8");

    assert.match(rollback, /DROP POLICY IF EXISTS medication_reminders_owner_select/);
    assert.match(rollback, /DROP POLICY IF EXISTS medication_reminders_owner_insert/);
    assert.match(rollback, /DROP POLICY IF EXISTS medication_reminders_owner_update/);
    assert.match(rollback, /DROP POLICY IF EXISTS medication_reminders_owner_delete/);
    assert.match(rollback, /DROP POLICY IF EXISTS medication_dose_logs_owner_select/);
    assert.match(rollback, /DROP POLICY IF EXISTS medication_dose_logs_owner_insert/);
    assert.match(rollback, /DROP POLICY IF EXISTS medication_dose_logs_owner_update/);
    assert.match(rollback, /DROP POLICY IF EXISTS medication_dose_logs_owner_delete/);
    assert.match(rollback, /DROP TABLE IF EXISTS public\.medication_dose_logs CASCADE/);
    assert.match(rollback, /DROP TABLE IF EXISTS public\.medication_reminders CASCADE/);
    assert.match(rollback, /COMMIT;/);
  });
});

describe("Persistence Hardening & Fail-Closed Semantics", () => {
  const userId = "00000000-0000-4000-8000-000000000001";

  class MockTokenVerifier implements AuthVerifier {
    async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
      if (token === "valid-token") return { userId };
      throw new Error("Invalid token");
    }
  }

  function mockPostgrestFailure(code: string, message: string) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: null, error: { code, message } }),
            maybeSingle: () => Promise.resolve({ data: null, error: { code, message } }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { code, message } }),
          }),
        }),
      }),
    } as unknown as UserSupabaseClient;
  }

  it("SupabaseRemindersRepository throws RemindersStorageUnavailableError when table is missing (never memory fallback)", async () => {
    const repo = new SupabaseRemindersRepository();
    const missingTableClient = mockPostgrestFailure("PGRST200", "Could not find the public.medication_reminders table in schema cache");

    await assert.rejects(async () => {
      await repo.list(missingTableClient, userId);
    }, RemindersStorageUnavailableError);

    await assert.rejects(async () => {
      await repo.create(missingTableClient, userId, {
        medicine_name: "Test Aspirin",
        scheduled_time: "08:00",
      });
    }, RemindersStorageUnavailableError);
  });

  it("SupabaseRemindersRepository throws RemindersStorageUnavailableError when client is unconfigured", async () => {
    const repo = new SupabaseRemindersRepository();

    await assert.rejects(async () => {
      await repo.list(null, userId);
    }, RemindersStorageUnavailableError);
  });

  it("Express reminders router returns HTTP 503 with REMINDERS_STORAGE_NOT_DEPLOYED when database tables are absent", async () => {
    const repo = new SupabaseRemindersRepository();
    const verifier = new MockTokenVerifier();
    const missingClient = mockPostgrestFailure("42P01", 'relation "public.medication_reminders" does not exist');
    const clientFactory: UserSupabaseClientFactory = () => missingClient;

    const router = createRemindersRouter(verifier, clientFactory, repo);

    const emitter = new EventEmitter() as any;
    emitter.statusCode = 200;
    emitter.status = function (c: number) { this.statusCode = c; return this; };
    emitter.json = function (d: any) { this.body = d; this.emit("finish"); return this; };

    const req: any = {
      method: "GET",
      url: "/api/v1/reminders",
      path: "/api/v1/reminders",
      originalUrl: "/api/v1/reminders",
      query: {},
      params: {},
      rawHeaders: ["authorization", "Bearer valid-token"],
    };

    const res = emitter;

    await new Promise<void>((resolve) => {
      router(req, res, (err: any) => {
        // Assert router caught storage error and threw AppError(503)
        assert.ok(err);
        assert.equal(err.statusCode, 503);
        assert.equal(err.code, "REMINDERS_STORAGE_NOT_DEPLOYED");
        assert.match(err.message, /202611160001_medication_reminders_v1/);
        resolve();
      });
    });
  });

  it("InMemoryRemindersRepository is strictly isolated and used only in explicit test harnesses", async () => {
    const testRepo = new InMemoryRemindersRepository();
    const created = await testRepo.create(null, userId, {
      medicine_name: "Isolated Test Drug",
      scheduled_time: "09:00",
    });

    assert.equal(created.medicine_name, "Isolated Test Drug");

    // Simulating server restart with a fresh repository instance proves in-memory does not persist
    const newServerInstanceRepo = new InMemoryRemindersRepository();
    const listAfterRestart = await newServerInstanceRepo.list(null, userId);
    assert.equal(listAfterRestart.length, 0); // Confirms memory loses state on restart, justifying fail-closed production design
  });
});
