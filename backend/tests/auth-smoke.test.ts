import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runAuthSmokeHarness,
  type SmokeAuthProvider,
  type SmokeDependencies,
  type SmokeEnvironment,
  type SmokeHttpClient,
  type SmokeHttpResponse
} from "../scripts/auth-smoke.js";

const approvedEnvironment: SmokeEnvironment = {
  SUPABASE_URL: "https://approved-project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "public-test-key",
  AUTH_SMOKE_APPROVED_SUPABASE_URL: "https://approved-project.supabase.co",
  AUTH_SMOKE_BACKEND_ORIGIN: "http://127.0.0.1:3000",
  AUTH_SMOKE_TEST_EMAIL: "test-user@example.invalid"
};

interface HarnessProbe {
  readonly output: string[];
  readonly httpCalls: Array<{ path: string; accessToken?: string }>;
  readonly authCalls: Array<{ email: string; password: string }>;
  createHttpClientCalls: number;
  createAuthProviderCalls: number;
}

function createHarness(overrides?: {
  environment?: SmokeEnvironment;
  password?: string;
  responseFor?: (path: string, token?: string) => SmokeHttpResponse;
  authProvider?: SmokeAuthProvider;
}): { dependencies: SmokeDependencies; probe: HarnessProbe } {
  const probe: HarnessProbe = {
    output: [],
    httpCalls: [],
    authCalls: [],
    createHttpClientCalls: 0,
    createAuthProviderCalls: 0
  };

  const responseFor = overrides?.responseFor ?? ((path, token) => {
    if (path === "/health") {
      return { status: 200, body: { status: "ok" } };
    }
    if (!token || token === "meddecode-synthetic-invalid-token") {
      return { status: 401, body: { error: { code: "UNAUTHORIZED" } } };
    }
    return {
      status: 200,
      body: {
        user: {
          id: "mock-user-id",
          email: "test-user@example.invalid"
        }
      }
    };
  });

  const httpClient: SmokeHttpClient = {
    async get(path, accessToken) {
      probe.httpCalls.push({
        path,
        ...(accessToken === undefined ? {} : { accessToken })
      });
      return responseFor(path, accessToken);
    }
  };

  const authProvider = overrides?.authProvider ?? {
    async signInWithPassword(email: string, password: string) {
      probe.authCalls.push({ email, password });
      return {
        userId: "mock-user-id",
        email: "test-user@example.invalid",
        accessToken: "mock-access-token"
      };
    }
  };

  return {
    probe,
    dependencies: {
      environment: overrides?.environment ?? approvedEnvironment,
      output: (line) => probe.output.push(line),
      readHiddenPassword: async () => overrides?.password ?? "mock-password",
      createHttpClient: () => {
        probe.createHttpClientCalls += 1;
        return httpClient;
      },
      createAuthProvider: () => {
        probe.createAuthProviderCalls += 1;
        return authProvider;
      }
    }
  };
}

describe("Authentication smoke-test harness safety", () => {
  it("refuses to run without the explicit approval flag", async () => {
    const { dependencies, probe } = createHarness();
    const exitCode = await runAuthSmokeHarness([], dependencies);

    assert.equal(exitCode, 1);
    assert.equal(probe.createHttpClientCalls, 0);
    assert.equal(probe.createAuthProviderCalls, 0);
    assert.deepEqual(probe.httpCalls, []);
    assert.match(probe.output.join("\n"), /APPROVAL_REQUIRED/);
  });

  it("rejects unexpected command-line arguments before network setup", async () => {
    const { dependencies, probe } = createHarness();
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth", "--token=forbidden"],
      dependencies
    );

    assert.equal(exitCode, 1);
    assert.equal(probe.createHttpClientCalls, 0);
    assert.match(probe.output.join("\n"), /INVALID_ARGUMENTS/);
  });

  it("refuses an unapproved Supabase project", async () => {
    const { dependencies, probe } = createHarness({
      environment: {
        ...approvedEnvironment,
        SUPABASE_URL: "https://different-project.supabase.co"
      }
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 1);
    assert.equal(probe.createHttpClientCalls, 0);
    assert.equal(probe.createAuthProviderCalls, 0);
    assert.match(probe.output.join("\n"), /UNAPPROVED_PROJECT/);
  });

  it("fails safely when required configuration is missing", async () => {
    const { dependencies, probe } = createHarness({ environment: {} });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 1);
    assert.equal(probe.createHttpClientCalls, 0);
    assert.match(probe.output.join("\n"), /MISSING_CONFIGURATION/);
  });

  it("rejects remote backend origins", async () => {
    const { dependencies, probe } = createHarness({
      environment: {
        ...approvedEnvironment,
        AUTH_SMOKE_BACKEND_ORIGIN: "https://remote.example.invalid"
      }
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 1);
    assert.equal(probe.createHttpClientCalls, 0);
    assert.match(probe.output.join("\n"), /INVALID_BACKEND_ORIGIN/);
  });

  it("reports an incorrect expected response without continuing", async () => {
    const { dependencies, probe } = createHarness({
      responseFor: () => ({ status: 503, body: { error: "unavailable" } })
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 1);
    assert.equal(probe.createAuthProviderCalls, 0);
    assert.equal(probe.httpCalls.length, 1);
    assert.match(probe.output.join("\n"), /UNEXPECTED_HTTP_STATUS HTTP 503/);
  });

  it("completes the full plan with mocked HTTP and authentication", async () => {
    const { dependencies, probe } = createHarness();
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 0);
    assert.equal(probe.createHttpClientCalls, 1);
    assert.equal(probe.createAuthProviderCalls, 1);
    assert.deepEqual(probe.httpCalls.map(({ path }) => path), [
      "/health",
      "/api/v1/auth/me",
      "/api/v1/auth/me",
      "/api/v1/auth/me"
    ]);
    assert.deepEqual(probe.authCalls, [{
      email: "test-user@example.invalid",
      password: "mock-password"
    }]);
    assert.match(probe.output.at(-1) ?? "", /^\[SUMMARY\] PASS/);
  });

  it("redacts provider failures and all supplied sensitive values", async () => {
    const sensitiveValues = [
      "mock-password",
      "mock-access-token",
      "test-user@example.invalid",
      "public-test-key",
      "provider-secret-detail"
    ];
    const { dependencies, probe } = createHarness({
      authProvider: {
        async signInWithPassword() {
          throw new Error("provider-secret-detail mock-access-token");
        }
      }
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );
    const output = probe.output.join("\n");

    assert.equal(exitCode, 1);
    for (const sensitiveValue of sensitiveValues) {
      assert.equal(output.includes(sensitiveValue), false);
    }
    assert.match(output, /AUTH_SIGN_IN_FAILED/);
  });

  it("uses only GET endpoint checks and never invokes privileged operations", async () => {
    const { dependencies, probe } = createHarness();
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 0);
    assert.equal(probe.authCalls.length, 1);
    assert.equal(
      probe.httpCalls.every(({ path }) => path === "/health" || path === "/api/v1/auth/me"),
      true
    );
  });
});
