import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runProfileWriteSmokeHarness,
  type ProfileWriteHttpResponse,
  type ProfileWriteSmokeDependencies,
  type ProfileWriteSmokeEnvironment
} from "../scripts/profile-write-smoke.js";

const flags = ["--allow-live-auth", "--allow-profile-write"] as const;
const environment: ProfileWriteSmokeEnvironment = {
  SUPABASE_URL: "https://approved-project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
  AUTH_SMOKE_APPROVED_SUPABASE_URL: "https://approved-project.supabase.co",
  AUTH_SMOKE_BACKEND_ORIGIN: "http://127.0.0.1:3000",
  AUTH_SMOKE_TEST_EMAIL: "private-user@example.invalid"
};

interface Call {
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly accessToken?: string;
  readonly body?: Readonly<Record<string, unknown>>;
}

interface Probe {
  readonly output: string[];
  readonly calls: Call[];
  httpFactories: number;
  authFactories: number;
}

function profile(options: {
  readonly owner?: string;
  readonly otherConditions?: readonly string[];
  readonly diabetes?: boolean;
} = {}): unknown {
  return { healthProfile: {
    id: "synthetic-health-id",
    user_id: options.owner ?? "verified-user-id",
    age: null, gender: null, allergies: [],
    diabetes: options.diabetes ?? false,
    hypertension: false, kidney_disease: false, liver_disease: false,
    asthma: false, thyroid: false, pregnancy: null,
    other_conditions: [...(options.otherConditions ?? [])],
    created_at: "2026-11-10T10:00:00.000Z",
    updated_at: "2026-11-10T10:00:00.000Z"
  } };
}

type Override = (call: Call, state: { healthGets: number; posts: number }) =>
  ProfileWriteHttpResponse | undefined;

function createHarness(options: {
  readonly environment?: ProfileWriteSmokeEnvironment;
  readonly override?: Override;
} = {}): { dependencies: ProfileWriteSmokeDependencies; probe: Probe } {
  const probe: Probe = { output: [], calls: [], httpFactories: 0, authFactories: 0 };
  const state = { healthGets: 0, posts: 0 };

  const dependencies: ProfileWriteSmokeDependencies = {
    environment: options.environment ?? environment,
    output: (line) => probe.output.push(line),
    readHiddenPassword: async () => "private-password",
    createHttpClient: () => {
      probe.httpFactories += 1;
      return { async request(method, path, accessToken, body) {
        const call: Call = { method, path,
          ...(accessToken === undefined ? {} : { accessToken }),
          ...(body === undefined ? {} : { body }) };
        probe.calls.push(call);
        const overridden = options.override?.(call, state);
        if (overridden) return overridden;
        if (path === "/health") return { status: 200, body: { status: "ok" } };
        if (path === "/api/v1/auth/me") {
          return { status: 200, body: { user: { id: "verified-user-id" } } };
        }
        if (path === "/api/v1/users/me") {
          return { status: 200, body: { profile: {
            id: "verified-user-id", email: null, name: null,
            created_at: "2026-11-10T10:00:00.000Z",
            updated_at: "2026-11-10T10:00:00.000Z"
          } } };
        }
        if (method === "GET") {
          state.healthGets += 1;
          if (state.healthGets === 1) return { status: 404, body: { error: {
            code: "HEALTH_PROFILE_NOT_FOUND", message: "Health profile not found."
          } } };
          return { status: 200, body: profile({
            otherConditions: state.healthGets >= 3
              ? ["MedDecode synthetic test only"] : []
          }) };
        }
        if (method === "PATCH") return { status: 200, body: profile({
          otherConditions: ["MedDecode synthetic test only"]
        }) };
        state.posts += 1;
        return state.posts === 1
          ? { status: 201, body: profile() }
          : { status: 409, body: { error: {
              code: "HEALTH_PROFILE_ALREADY_EXISTS",
              message: "Health profile already exists."
            } } };
      } };
    },
    createAuthProvider: () => {
      probe.authFactories += 1;
      return { async signInWithPassword() {
        return {
          userId: "verified-user-id",
          email: "private-user@example.invalid",
          accessToken: "private-access-token"
        };
      } };
    }
  };
  return { dependencies, probe };
}

describe("profile-write smoke safety gates", () => {
  for (const args of [[], ["--allow-live-auth"], ["--allow-profile-write"]]) {
    it(`blocks incomplete approval: ${args.join(" ") || "none"}`, async () => {
      const { dependencies, probe } = createHarness();
      assert.equal(await runProfileWriteSmokeHarness(args, dependencies), 1);
      assert.equal(probe.httpFactories, 0);
      assert.equal(probe.authFactories, 0);
      assert.deepEqual(probe.calls, []);
    });
  }

  it("blocks extra arguments, another project and a remote backend before requests", async () => {
    const cases = [
      { args: [...flags, "--force"], env: environment },
      { args: [...flags], env: { ...environment,
        SUPABASE_URL: "https://another-project.supabase.co" } },
      { args: [...flags], env: { ...environment,
        AUTH_SMOKE_BACKEND_ORIGIN: "https://remote.example.invalid" } }
    ];
    for (const item of cases) {
      const { dependencies, probe } = createHarness({ environment: item.env });
      assert.equal(await runProfileWriteSmokeHarness(item.args, dependencies), 1);
      assert.equal(probe.httpFactories, 0);
      assert.deepEqual(probe.calls, []);
    }
  });
});

describe("profile-write smoke sequence", () => {
  it("uses the exact sequence without delete or retry", async () => {
    const { dependencies, probe } = createHarness();
    assert.equal(await runProfileWriteSmokeHarness(flags, dependencies), 0);
    assert.deepEqual(probe.calls.map((call) => `${call.method} ${call.path}`), [
      "GET /health", "GET /api/v1/auth/me", "GET /api/v1/users/me",
      "GET /api/v1/health-profile/me", "POST /api/v1/health-profile/me",
      "GET /api/v1/health-profile/me", "PATCH /api/v1/health-profile/me",
      "GET /api/v1/health-profile/me", "POST /api/v1/health-profile/me"
    ]);
    assert.ok(probe.calls.every((call) => call.method !== ("DELETE" as string)));
    assert.match(probe.output.join("\n"), /SYNTHETIC_PROFILE_RETAINED/);
  });

  it("requires the application profile before any mutation", async () => {
    const { dependencies, probe } = createHarness({ override: (call) =>
      call.path === "/api/v1/users/me"
        ? { status: 404, body: { error: { code: "USER_PROFILE_NOT_FOUND" } } }
        : undefined });
    assert.equal(await runProfileWriteSmokeHarness(flags, dependencies), 1);
    assert.ok(probe.calls.every((call) => call.method === "GET"));
  });

  it("requires the health profile to be absent before any mutation", async () => {
    const { dependencies, probe } = createHarness({ override: (call) =>
      call.path === "/api/v1/health-profile/me" && call.method === "GET"
        ? { status: 200, body: profile() } : undefined });
    assert.equal(await runProfileWriteSmokeHarness(flags, dependencies), 1);
    assert.ok(probe.calls.every((call) => call.method === "GET"));
  });

  it("rejects an identity ownership mismatch", async () => {
    const { dependencies, probe } = createHarness({ override: (call) =>
      call.path === "/api/v1/auth/me"
        ? { status: 200, body: { user: { id: "different-user" } } } : undefined });
    assert.equal(await runProfileWriteSmokeHarness(flags, dependencies), 1);
    assert.equal(probe.calls.length, 2);
    assert.match(probe.output.join("\n"), /IDENTITY_MISMATCH/);
  });

  it("rejects a created profile owned by another user and warns it may remain", async () => {
    const { dependencies, probe } = createHarness({ override: (call) =>
      call.method === "POST"
        ? { status: 201, body: profile({ owner: "different-user" }) } : undefined });
    assert.equal(await runProfileWriteSmokeHarness(flags, dependencies), 1);
    assert.match(probe.output.join("\n"), /PROFILE_OWNER_MISMATCH/);
    assert.match(probe.output.join("\n"), /SYNTHETIC_PROFILE_MAY_REMAIN/);
  });

  it("verifies omitted fields remain unchanged after patch", async () => {
    const { dependencies, probe } = createHarness({ override: (call, state) =>
      call.method === "GET" && call.path === "/api/v1/health-profile/me" &&
      state.healthGets === 2
        ? { status: 200, body: profile({
            otherConditions: ["MedDecode synthetic test only"], diabetes: true
          }) }
        : undefined });
    assert.equal(await runProfileWriteSmokeHarness(flags, dependencies), 1);
    assert.match(probe.output.join("\n"), /PROFILE_CONTRACT_INVALID/);
    assert.equal(probe.calls.filter((call) => call.method === "POST").length, 1);
  });

  it("requires the exact duplicate conflict", async () => {
    const { dependencies, probe } = createHarness({ override: (call, state) =>
      call.method === "POST" && state.posts === 1
        ? { status: 409, body: { error: { code: "WRONG_CODE", message: "conflict" } } }
        : undefined });
    assert.equal(await runProfileWriteSmokeHarness(flags, dependencies), 1);
    assert.match(probe.output.join("\n"), /DUPLICATE_CONTRACT_INVALID/);
  });

  it("fails safely on an unexpected database response", async () => {
    const { dependencies, probe } = createHarness({ override: (call) =>
      call.method === "POST"
        ? { status: 500, body: { error: { code: "INTERNAL_ERROR" } } } : undefined });
    assert.equal(await runProfileWriteSmokeHarness(flags, dependencies), 1);
    assert.match(probe.output.join("\n"), /UNEXPECTED_HTTP_STATUS/);
  });

  it("does not print credentials, identity, token or profile values", async () => {
    const { dependencies, probe } = createHarness();
    await runProfileWriteSmokeHarness(flags, dependencies);
    const output = probe.output.join("\n");
    for (const sensitive of [
      "private-user@example.invalid", "private-password", "private-access-token",
      "verified-user-id", "synthetic-health-id", "MedDecode synthetic test only"
    ]) assert.ok(!output.includes(sensitive));
  });
});
