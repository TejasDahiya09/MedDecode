import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import {
  ProfileRepositoryError,
  supabaseProfileRepository
} from "../src/repositories/profile.repository.js";
import type { HealthProfileInput } from "../src/types/profiles.js";

interface QueryProbe {
  table?: string;
  fields?: string;
  filterColumn?: string;
  filterValue?: string;
}

interface MutationProbe extends QueryProbe {
  operation?: "insert" | "update";
  payload?: unknown;
}

function createQueryClient(
  result: { data: unknown; error: unknown },
  probe: QueryProbe
): UserSupabaseClient {
  const builder = {
    select(fields: string) {
      probe.fields = fields;
      return builder;
    },
    eq(column: string, value: string) {
      probe.filterColumn = column;
      probe.filterValue = value;
      return builder;
    },
    async maybeSingle<T>() {
      return result as { data: T | null; error: unknown };
    }
  };

  return {
    from(table: string) {
      probe.table = table;
      return builder;
    }
  } as unknown as UserSupabaseClient;
}

function createMutationClient(
  result: { data: unknown; error: unknown },
  probe: MutationProbe
): UserSupabaseClient {
  const builder = {
    insert(payload: unknown) {
      probe.operation = "insert";
      probe.payload = payload;
      return builder;
    },
    update(payload: unknown) {
      probe.operation = "update";
      probe.payload = payload;
      return builder;
    },
    select(fields: string) {
      probe.fields = fields;
      return builder;
    },
    eq(column: string, value: string) {
      probe.filterColumn = column;
      probe.filterValue = value;
      return builder;
    },
    async maybeSingle<T>() {
      return result as { data: T | null; error: unknown };
    },
    async single<T>() {
      return result as { data: T | null; error: unknown };
    }
  };

  return {
    from(table: string) {
      probe.table = table;
      return builder;
    }
  } as unknown as UserSupabaseClient;
}

describe("Supabase profile repository query contracts", () => {
  it("queries only the allowed application-user fields for the verified ID", async () => {
    const probe: QueryProbe = {};
    const row = {
      id: "user-one",
      email: null,
      name: null,
      created_at: "2026-11-10T10:00:00.000Z",
      updated_at: "2026-11-10T10:00:00.000Z"
    };
    const client = createQueryClient({ data: row, error: null }, probe);

    const result = await supabaseProfileRepository.findApplicationUser(
      client,
      "user-one"
    );

    assert.deepEqual(probe, {
      table: "users",
      fields: "id,email,name,created_at,updated_at",
      filterColumn: "id",
      filterValue: "user-one"
    });
    assert.deepEqual(result, row);
  });

  it("queries all 15 allowed health fields for the verified user ID", async () => {
    const probe: QueryProbe = {};
    const row = {
      id: "health-one",
      user_id: "user-one",
      age: null,
      gender: null,
      allergies: [],
      diabetes: false,
      hypertension: false,
      kidney_disease: false,
      liver_disease: false,
      asthma: false,
      thyroid: false,
      pregnancy: null,
      other_conditions: [],
      created_at: "2026-11-10T10:00:00.000Z",
      updated_at: "2026-11-10T10:00:00.000Z"
    };
    const client = createQueryClient({ data: row, error: null }, probe);

    const result = await supabaseProfileRepository.findHealthProfile(
      client,
      "user-one"
    );

    assert.deepEqual(probe, {
      table: "health_profiles",
      fields: [
        "id",
        "user_id",
        "age",
        "gender",
        "allergies",
        "diabetes",
        "hypertension",
        "kidney_disease",
        "liver_disease",
        "asthma",
        "thyroid",
        "pregnancy",
        "other_conditions",
        "created_at",
        "updated_at"
      ].join(","),
      filterColumn: "user_id",
      filterValue: "user-one"
    });
    assert.deepEqual(result, row);
  });

  it("returns null only when maybeSingle reports no row and no error", async () => {
    const client = createQueryClient(
      { data: null, error: null },
      {}
    );

    const result = await supabaseProfileRepository.findApplicationUser(
      client,
      "user-one"
    );

    assert.equal(result, null);
  });

  it("converts provider query errors into a non-sensitive repository error", async () => {
    const client = createQueryClient(
      {
        data: null,
        error: { message: "private SQL and credential detail" }
      },
      {}
    );

    await assert.rejects(
      supabaseProfileRepository.findHealthProfile(client, "user-one"),
      (error: Error) => {
        assert.equal(error.message, "Health profile query failed.");
        assert.doesNotMatch(error.message, /SQL|credential|private/i);
        return true;
      }
    );
  });

  it("updates only name on the verified application-user row", async () => {
    const probe: MutationProbe = {};
    const row = {
      id: "user-one",
      email: null,
      name: "Updated Name",
      created_at: "2026-11-10T10:00:00.000Z",
      updated_at: "2026-11-10T11:00:00.000Z"
    };
    const client = createMutationClient({ data: row, error: null }, probe);
    const result = await supabaseProfileRepository.updateApplicationUser(
      client,
      "user-one",
      { name: "Updated Name" }
    );

    assert.deepEqual(probe, {
      table: "users",
      operation: "update",
      payload: { name: "Updated Name" },
      filterColumn: "id",
      filterValue: "user-one",
      fields: "id,email,name,created_at,updated_at"
    });
    assert.deepEqual(result, row);
  });

  it("creates a health profile with ownership derived from the verified user", async () => {
    const probe: MutationProbe = {};
    const input: HealthProfileInput = {
      age: null,
      gender: null,
      allergies: [],
      diabetes: false,
      hypertension: false,
      kidney_disease: false,
      liver_disease: false,
      asthma: false,
      thyroid: false,
      pregnancy: null,
      other_conditions: []
    };
    const row = {
      id: "health-one",
      user_id: "user-one",
      ...input,
      created_at: "2026-11-10T10:00:00.000Z",
      updated_at: "2026-11-10T10:00:00.000Z"
    };
    const client = createMutationClient({ data: row, error: null }, probe);
    const result = await supabaseProfileRepository.createHealthProfile(
      client,
      "user-one",
      input
    );

    assert.equal(probe.table, "health_profiles");
    assert.equal(probe.operation, "insert");
    assert.deepEqual(probe.payload, { user_id: "user-one", ...input });
    assert.equal(probe.filterColumn, undefined);
    assert.deepEqual(result, row);
  });

  it("updates only supplied health fields for the verified owner", async () => {
    const probe: MutationProbe = {};
    const row = {
      id: "health-one",
      user_id: "user-one",
      age: 35,
      gender: null,
      allergies: [],
      diabetes: false,
      hypertension: false,
      kidney_disease: false,
      liver_disease: false,
      asthma: false,
      thyroid: false,
      pregnancy: null,
      other_conditions: [],
      created_at: "2026-11-10T10:00:00.000Z",
      updated_at: "2026-11-10T11:00:00.000Z"
    };
    const client = createMutationClient({ data: row, error: null }, probe);
    const result = await supabaseProfileRepository.updateHealthProfile(
      client,
      "user-one",
      { age: 35 }
    );

    assert.equal(probe.table, "health_profiles");
    assert.equal(probe.operation, "update");
    assert.deepEqual(probe.payload, { age: 35 });
    assert.equal(probe.filterColumn, "user_id");
    assert.equal(probe.filterValue, "user-one");
    assert.deepEqual(result, row);
  });

  for (const [providerCode, expectedCode] of [
    ["23505", "DUPLICATE_HEALTH_PROFILE"],
    ["23503", "MISSING_APPLICATION_PROFILE"],
    ["42501", "QUERY_FAILED"]
  ] as const) {
    it(`maps provider error ${providerCode} to a safe repository error`, async () => {
      const client = createMutationClient(
        { data: null, error: { code: providerCode, message: "private detail" } },
        {}
      );

      await assert.rejects(
        supabaseProfileRepository.createHealthProfile(
          client,
          "user-one",
          {
            age: null,
            gender: null,
            allergies: [],
            diabetes: false,
            hypertension: false,
            kidney_disease: false,
            liver_disease: false,
            asthma: false,
            thyroid: false,
            pregnancy: null,
            other_conditions: []
          }
        ),
        (error: Error) => {
          assert.ok(error instanceof ProfileRepositoryError);
          assert.equal(error.code, expectedCode);
          assert.doesNotMatch(error.message, /private|42501|2350/i);
          return true;
        }
      );
    });
  }
});
