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

const firstPrescriptionId = "20000000-0000-4000-8000-000000000002";
const secondPrescriptionId = "10000000-0000-4000-8000-000000000001";
const firstCabinetId = "40000000-0000-4000-8000-000000000004";
const secondCabinetId = "30000000-0000-4000-8000-000000000003";
const medicineId = "50000000-0000-4000-8000-000000000005";
const firstFamilyMemberId = "60000000-0000-4000-8000-000000000006";
const secondFamilyMemberId = "70000000-0000-4000-8000-000000000007";

function historyItem(
  id = firstPrescriptionId,
  createdAt = "2026-11-10T10:00:00.000Z"
) {
  return {
    id,
    file_type: "application/pdf",
    file_size_bytes: "9007199254740993",
    status: "uploaded",
    prescription_date: null,
    created_at: createdAt,
    updated_at: createdAt,
    processed_at: null
  };
}

function historyList(items: readonly unknown[] = []): SmokeHttpResponse {
  return {
    status: 200,
    body: {
      items,
      pagination: {
        limit: 20,
        offset: 0,
        returned: items.length,
        has_more: false,
        next_offset: null
      }
    }
  };
}

function cabinetItem(
  id = firstCabinetId,
  createdAt = "2026-11-10T10:00:00.000Z",
  quantity: string | null = "2.5"
) {
  return {
    id,
    medicine_id: medicineId,
    quantity,
    purchase_date: null,
    expiry_date: "2027-01-31",
    refill_date: null,
    usage_information: null,
    created_at: createdAt,
    updated_at: createdAt
  };
}

function cabinetList(items: readonly unknown[] = []): SmokeHttpResponse {
  return {
    status: 200,
    body: {
      items,
      pagination: {
        limit: 20,
        offset: 0,
        returned: items.length,
        has_more: false,
        next_offset: null
      }
    }
  };
}

function familyMemberItem(
  id = firstFamilyMemberId,
  createdAt = "2026-11-10T10:00:00.000Z",
  relationship: string | null = null
) {
  return {
    id,
    name: "Synthetic Member",
    relationship,
    created_at: createdAt,
    updated_at: createdAt
  };
}

function familyMemberList(items: readonly unknown[] = []): SmokeHttpResponse {
  return {
    status: 200,
    body: {
      items,
      pagination: {
        limit: 20,
        offset: 0,
        returned: items.length,
        has_more: false,
        next_offset: null
      }
    }
  };
}

interface HarnessProbe {
  readonly output: string[];
  readonly httpCalls: Array<{ path: string; accessToken?: string }>;
  readonly authCalls: Array<{ email: string; password: string }>;
  createHttpClientCalls: number;
  createAuthProviderCalls: number;
}

function standardResponseFor(
  path: string,
  token?: string
): SmokeHttpResponse {
  if (path === "/health") {
    return { status: 200, body: { status: "ok" } };
  }
  if (!token || token === "meddecode-synthetic-invalid-token") {
    return { status: 401, body: { error: { code: "UNAUTHORIZED" } } };
  }
  if (path === "/api/v1/users/me") {
    return {
      status: 200,
      body: {
        profile: {
          id: "mock-user-id",
          email: null,
          name: null,
          created_at: "2026-11-10T10:00:00.000Z",
          updated_at: "2026-11-10T10:00:00.000Z"
        }
      }
    };
  }
  if (path === "/api/v1/health-profile/me") {
    return {
      status: 200,
      body: {
        healthProfile: {
          id: "mock-health-id",
          user_id: "mock-user-id",
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
        }
      }
    };
  }
  if (path === "/api/v1/prescriptions?limit=20&offset=0") {
    return historyList();
  }
  if (path === "/api/v1/prescriptions/not-a-uuid") {
    return {
      status: 400,
      body: {
        error: {
          code: "INVALID_PRESCRIPTION_ID",
          message: "Prescription ID must be a valid UUID."
        }
      }
    };
  }
  if (path.startsWith("/api/v1/prescriptions/")) {
    return {
      status: 404,
      body: {
        error: {
          code: "PRESCRIPTION_NOT_FOUND",
          message: "Prescription not found."
        }
      }
    };
  }
  if (path === "/api/v1/medicine-cabinet?limit=20&offset=0") {
    return cabinetList();
  }
  if (path === "/api/v1/medicine-cabinet/not-a-uuid") {
    return {
      status: 400,
      body: {
        error: {
          code: "INVALID_MEDICINE_CABINET_ENTRY_ID",
          message: "Medicine cabinet entry ID must be a valid UUID."
        }
      }
    };
  }
  if (path.startsWith("/api/v1/medicine-cabinet/")) {
    return {
      status: 404,
      body: {
        error: {
          code: "MEDICINE_CABINET_ENTRY_NOT_FOUND",
          message: "Medicine cabinet entry not found."
        }
      }
    };
  }
  if (path === "/api/v1/family-members?limit=20&offset=0") {
    return familyMemberList();
  }
  if (path === "/api/v1/family-members/not-a-uuid") {
    return {
      status: 400,
      body: {
        error: {
          code: "INVALID_FAMILY_MEMBER_ID",
          message: "Family member ID must be a valid UUID."
        }
      }
    };
  }
  if (path.startsWith("/api/v1/family-members/")) {
    return {
      status: 404,
      body: {
        error: {
          code: "FAMILY_MEMBER_NOT_FOUND",
          message: "Family member not found."
        }
      }
    };
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

  const responseFor = overrides?.responseFor ?? standardResponseFor;

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
    const paths = probe.httpCalls.map(({ path }) => path);
    assert.deepEqual(paths.slice(0, 14), [
      "/health",
      "/api/v1/auth/me",
      "/api/v1/auth/me",
      "/api/v1/prescriptions?limit=20&offset=0",
      "/api/v1/prescriptions?limit=20&offset=0",
      "/api/v1/medicine-cabinet?limit=20&offset=0",
      "/api/v1/medicine-cabinet?limit=20&offset=0",
      "/api/v1/family-members?limit=20&offset=0",
      "/api/v1/family-members?limit=20&offset=0",
      "/api/v1/auth/me",
      "/api/v1/users/me",
      "/api/v1/health-profile/me",
      "/api/v1/prescriptions?limit=20&offset=0",
      "/api/v1/prescriptions/not-a-uuid"
    ]);
    assert.match(paths[14] ?? "", /^\/api\/v1\/prescriptions\/[0-9a-f-]{36}$/);
    assert.deepEqual(paths.slice(15, 17), [
      "/api/v1/medicine-cabinet?limit=20&offset=0",
      "/api/v1/medicine-cabinet/not-a-uuid"
    ]);
    assert.match(paths[17] ?? "", /^\/api\/v1\/medicine-cabinet\/[0-9a-f-]{36}$/);
    assert.deepEqual(paths.slice(18, 20), [
      "/api/v1/family-members?limit=20&offset=0",
      "/api/v1/family-members/not-a-uuid"
    ]);
    assert.match(paths[20] ?? "", /^\/api\/v1\/family-members\/[0-9a-f-]{36}$/);
    const historyAuthCalls = probe.httpCalls.filter(
      ({ path }) => path === "/api/v1/prescriptions?limit=20&offset=0"
    );
    assert.deepEqual(
      historyAuthCalls.map(({ accessToken }) => accessToken),
      [undefined, "meddecode-synthetic-invalid-token", "mock-access-token"]
    );
    const cabinetAuthCalls = probe.httpCalls.filter(
      ({ path }) => path === "/api/v1/medicine-cabinet?limit=20&offset=0"
    );
    assert.deepEqual(
      cabinetAuthCalls.map(({ accessToken }) => accessToken),
      [undefined, "meddecode-synthetic-invalid-token", "mock-access-token"]
    );
    const familyMemberAuthCalls = probe.httpCalls.filter(
      ({ path }) => path === "/api/v1/family-members?limit=20&offset=0"
    );
    assert.deepEqual(
      familyMemberAuthCalls.map(({ accessToken }) => accessToken),
      [undefined, "meddecode-synthetic-invalid-token", "mock-access-token"]
    );
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

  it("accepts an absent application profile only with its exact 404 code", async () => {
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) => {
        if (path === "/api/v1/users/me") {
          return {
            status: 404,
            body: {
              error: {
                code: "USER_PROFILE_NOT_FOUND",
                message: "User profile not found."
              }
            }
          };
        }
        return standardResponseFor(path, token);
      }
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 0);
    assert.match(
      probe.output.join("\n"),
      /\[PASS\] Application profile HTTP 404 PROFILE_NOT_FOUND/
    );
  });

  it("accepts an absent health profile only with its exact 404 code", async () => {
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) => path === "/api/v1/health-profile/me"
        ? {
            status: 404,
            body: {
              error: {
                code: "HEALTH_PROFILE_NOT_FOUND",
                message: "Health profile not found."
              }
            }
          }
        : standardResponseFor(path, token)
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 0);
    assert.match(
      probe.output.join("\n"),
      /\[PASS\] Health profile HTTP 404 PROFILE_NOT_FOUND/
    );
  });

  it("rejects a profile 404 carrying the wrong error code", async () => {
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) => path === "/api/v1/users/me"
        ? {
            status: 404,
            body: {
              error: {
                code: "HEALTH_PROFILE_NOT_FOUND",
                message: "Wrong route contract."
              }
            }
          }
        : standardResponseFor(path, token)
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 1);
    assert.match(probe.output.join("\n"), /PROFILE_CONTRACT_INVALID HTTP 404/);
  });

  for (const status of [401, 403, 500]) {
    it(`rejects HTTP ${status} from a profile endpoint`, async () => {
      const { dependencies, probe } = createHarness({
        responseFor: (path, token) => path === "/api/v1/users/me"
          ? { status, body: { error: { code: "SAFE_SYNTHETIC_ERROR" } } }
          : standardResponseFor(path, token)
      });
      const exitCode = await runAuthSmokeHarness(
        ["--allow-live-auth"],
        dependencies
      );

      assert.equal(exitCode, 1);
      assert.match(
        probe.output.join("\n"),
        new RegExp(`UNEXPECTED_HTTP_STATUS HTTP ${status}`)
      );
    });
  }

  it("rejects an application profile owned by another user", async () => {
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) => {
        const response = standardResponseFor(path, token);
        if (path !== "/api/v1/users/me") return response;
        return {
          status: 200,
          body: {
            profile: {
              ...(response.body as { profile: Record<string, unknown> }).profile,
              id: "different-user-id"
            }
          }
        };
      }
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 1);
    assert.match(probe.output.join("\n"), /PROFILE_OWNER_MISMATCH HTTP 200/);
  });

  it("rejects extra fields that could expose sensitive profile data", async () => {
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) => {
        const response = standardResponseFor(path, token);
        if (path !== "/api/v1/health-profile/me") return response;
        return {
          status: 200,
          body: {
            healthProfile: {
              ...(response.body as {
                healthProfile: Record<string, unknown>;
              }).healthProfile,
              access_token: "must-never-be-returned"
            }
          }
        };
      }
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 1);
    const output = probe.output.join("\n");
    assert.match(output, /PROFILE_CONTRACT_INVALID HTTP 200/);
    assert.equal(output.includes("must-never-be-returned"), false);
  });

  it("never prints profile values, identity data or credentials", async () => {
    const sensitiveValues = [
      "private-display-name",
      "private-health-id",
      "private-allergy",
      "test-user@example.invalid",
      "mock-password",
      "mock-access-token",
      "public-test-key"
    ];
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) => {
        const response = standardResponseFor(path, token);
        if (path === "/api/v1/users/me") {
          return {
            status: 200,
            body: {
              profile: {
                ...(response.body as {
                  profile: Record<string, unknown>;
                }).profile,
                name: "private-display-name"
              }
            }
          };
        }
        if (path === "/api/v1/health-profile/me") {
          return {
            status: 200,
            body: {
              healthProfile: {
                ...(response.body as {
                  healthProfile: Record<string, unknown>;
                }).healthProfile,
                id: "private-health-id",
                allergies: ["private-allergy"]
              }
            }
          };
        }
        return response;
      }
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );
    const output = probe.output.join("\n");

    assert.equal(exitCode, 0);
    for (const value of sensitiveValues) {
      assert.equal(output.includes(value), false);
    }
    assert.match(output, /Application profile HTTP 200 PROFILE_PRESENT/);
    assert.match(output, /Health profile HTTP 200 PROFILE_PRESENT/);
  });

  it("accepts a valid empty prescription history and safely skips detail", async () => {
    const { dependencies, probe } = createHarness();
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );
    const output = probe.output.join("\n");

    assert.equal(exitCode, 0);
    assert.match(output, /Prescription history HTTP 200 HISTORY_EMPTY/);
    assert.match(output, /\[SKIP\] Prescription history detail NO_EXISTING_RECORD/);
  });

  it("validates populated history, ordering and the first owned detail", async () => {
    const items = [
      historyItem(firstPrescriptionId, "2026-11-10T10:00:00.000Z"),
      historyItem(secondPrescriptionId, "2026-11-09T10:00:00.000Z")
    ];
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) => {
        if (path === "/api/v1/prescriptions?limit=20&offset=0" &&
          token === "mock-access-token") return historyList(items);
        if (path === `/api/v1/prescriptions/${firstPrescriptionId}`) {
          return {
            status: 200,
            body: { prescription: items[0] }
          };
        }
        return standardResponseFor(path, token);
      }
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );
    const output = probe.output.join("\n");

    assert.equal(exitCode, 0);
    assert.match(output, /Prescription history HTTP 200 HISTORY_PRESENT/);
    assert.match(output, /Prescription history detail HTTP 200/);
    assert.equal(output.includes(firstPrescriptionId), false);
    assert.equal(output.includes("9007199254740993"), false);
  });

  for (const [name, response] of [
    ["malformed JSON", { status: 200, body: undefined }],
    ["incorrect field set", {
      status: 200,
      body: { items: [], pagination: {}, unexpected: true }
    }],
    ["unexpected status", { status: 500, body: { error: { code: "SAFE" } } }]
  ] as const) {
    it(`rejects ${name} from prescription history`, async () => {
      const { dependencies, probe } = createHarness({
        responseFor: (path, token) =>
          path === "/api/v1/prescriptions?limit=20&offset=0" &&
            token === "mock-access-token"
            ? response
            : standardResponseFor(path, token)
      });
      const exitCode = await runAuthSmokeHarness(
        ["--allow-live-auth"],
        dependencies
      );

      assert.equal(exitCode, 1);
      assert.match(
        probe.output.join("\n"),
        /HISTORY_CONTRACT_INVALID|UNEXPECTED_HTTP_STATUS/
      );
    });
  }

  it("rejects private fields and never prints prescription metadata", async () => {
    const privateValues = [
      "private/storage/key.pdf",
      "private-bucket",
      "private-patient-name",
      firstPrescriptionId,
      "9007199254740993"
    ];
    const exposed = {
      ...historyItem(),
      object_key: privateValues[0],
      storage_bucket: privateValues[1],
      patient_name: privateValues[2]
    };
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) =>
        path === "/api/v1/prescriptions?limit=20&offset=0" &&
          token === "mock-access-token"
          ? historyList([exposed])
          : standardResponseFor(path, token)
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );
    const output = probe.output.join("\n");

    assert.equal(exitCode, 1);
    assert.match(output, /HISTORY_CONTRACT_INVALID/);
    for (const privateValue of privateValues) {
      assert.equal(output.includes(privateValue), false);
    }
  });

  it("rejects out-of-order history records", async () => {
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) =>
        path === "/api/v1/prescriptions?limit=20&offset=0" &&
          token === "mock-access-token"
          ? historyList([
              historyItem(secondPrescriptionId, "2026-11-09T10:00:00.000Z"),
              historyItem(firstPrescriptionId, "2026-11-10T10:00:00.000Z")
            ])
          : standardResponseFor(path, token)
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 1);
    assert.match(probe.output.join("\n"), /HISTORY_CONTRACT_INVALID/);
  });

  it("accepts an empty medicine cabinet and safely skips detail", async () => {
    const { dependencies, probe } = createHarness();
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );
    const output = probe.output.join("\n");

    assert.equal(exitCode, 0);
    assert.match(output, /Medicine cabinet HTTP 200 CABINET_EMPTY/);
    assert.match(output, /\[SKIP\] Medicine cabinet detail NO_EXISTING_RECORD/);
  });

  it("validates populated cabinet, nullable fields and first owned detail", async () => {
    const items = [
      cabinetItem(firstCabinetId, "2026-11-10T10:00:00.000Z", null),
      cabinetItem(secondCabinetId, "2026-11-09T10:00:00.000Z", "2.5")
    ];
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) => {
        if (path === "/api/v1/medicine-cabinet?limit=20&offset=0" &&
          token === "mock-access-token") return cabinetList(items);
        if (path === `/api/v1/medicine-cabinet/${firstCabinetId}`) {
          return { status: 200, body: { entry: items[0] } };
        }
        return standardResponseFor(path, token);
      }
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );
    const output = probe.output.join("\n");

    assert.equal(exitCode, 0);
    assert.match(output, /Medicine cabinet HTTP 200 CABINET_PRESENT/);
    assert.match(output, /Medicine cabinet detail HTTP 200/);
    for (const privateValue of [firstCabinetId, medicineId, "2.5", "2027-01-31"]) {
      assert.equal(output.includes(privateValue), false);
    }
  });

  for (const [name, response] of [
    ["malformed JSON", { status: 200, body: undefined }],
    ["invalid pagination", {
      status: 200,
      body: {
        items: [],
        pagination: {
          limit: 20,
          offset: 0,
          returned: 1,
          has_more: false,
          next_offset: null
        }
      }
    }],
    ["unexpected status", { status: 500, body: { error: { code: "SAFE" } } }]
  ] as const) {
    it(`rejects ${name} from medicine cabinet`, async () => {
      const { dependencies, probe } = createHarness({
        responseFor: (path, token) =>
          path === "/api/v1/medicine-cabinet?limit=20&offset=0" &&
            token === "mock-access-token"
            ? response
            : standardResponseFor(path, token)
      });
      const exitCode = await runAuthSmokeHarness(
        ["--allow-live-auth"],
        dependencies
      );

      assert.equal(exitCode, 1);
      assert.match(
        probe.output.join("\n"),
        /CABINET_CONTRACT_INVALID|UNEXPECTED_HTTP_STATUS/
      );
    });
  }

  it("rejects private cabinet fields without printing sensitive values", async () => {
    const privateValues = [firstCabinetId, medicineId, "private-user-id", "private-family-id"];
    const exposed = {
      ...cabinetItem(),
      user_id: privateValues[2],
      family_member_id: privateValues[3]
    };
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) =>
        path === "/api/v1/medicine-cabinet?limit=20&offset=0" &&
          token === "mock-access-token"
          ? cabinetList([exposed])
          : standardResponseFor(path, token)
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );
    const output = probe.output.join("\n");

    assert.equal(exitCode, 1);
    assert.match(output, /CABINET_CONTRACT_INVALID/);
    for (const privateValue of privateValues) {
      assert.equal(output.includes(privateValue), false);
    }
  });

  for (const [name, item] of [
    ["numeric quantity", { ...cabinetItem(), quantity: 2.5 }],
    ["scientific quantity", { ...cabinetItem(), quantity: "2e1" }],
    ["invalid date", { ...cabinetItem(), expiry_date: "2027-02-30" }],
    ["invalid identifier", { ...cabinetItem(), medicine_id: "not-a-uuid" }]
  ] as const) {
    it(`rejects ${name} in cabinet metadata`, async () => {
      const { dependencies, probe } = createHarness({
        responseFor: (path, token) =>
          path === "/api/v1/medicine-cabinet?limit=20&offset=0" &&
            token === "mock-access-token"
            ? cabinetList([item])
            : standardResponseFor(path, token)
      });
      const exitCode = await runAuthSmokeHarness(
        ["--allow-live-auth"],
        dependencies
      );

      assert.equal(exitCode, 1);
      assert.match(probe.output.join("\n"), /CABINET_CONTRACT_INVALID/);
    });
  }

  it("rejects out-of-order medicine cabinet records", async () => {
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) =>
        path === "/api/v1/medicine-cabinet?limit=20&offset=0" &&
          token === "mock-access-token"
          ? cabinetList([
              cabinetItem(secondCabinetId, "2026-11-09T10:00:00.000Z"),
              cabinetItem(firstCabinetId, "2026-11-10T10:00:00.000Z")
            ])
          : standardResponseFor(path, token)
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 1);
    assert.match(probe.output.join("\n"), /CABINET_CONTRACT_INVALID/);
  });

  it("accepts an empty family member list and safely skips detail", async () => {
    const { dependencies, probe } = createHarness();
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );
    const output = probe.output.join("\n");

    assert.equal(exitCode, 0);
    assert.match(output, /Family members HTTP 200 FAMILY_MEMBERS_EMPTY/);
    assert.match(output, /\[SKIP\] Family member detail NO_EXISTING_RECORD/);
  });

  it("validates populated family members, ordering and first owned detail", async () => {
    const items = [
      familyMemberItem(firstFamilyMemberId, "2026-11-10T10:00:00.000Z", null),
      familyMemberItem(secondFamilyMemberId, "2026-11-09T10:00:00.000Z", "Sibling")
    ];
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) => {
        if (path === "/api/v1/family-members?limit=20&offset=0" &&
          token === "mock-access-token") return familyMemberList(items);
        if (path === `/api/v1/family-members/${firstFamilyMemberId}`) {
          return { status: 200, body: { member: items[0] } };
        }
        return standardResponseFor(path, token);
      }
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );
    const output = probe.output.join("\n");

    assert.equal(exitCode, 0);
    assert.match(output, /Family members HTTP 200 FAMILY_MEMBERS_PRESENT/);
    assert.match(output, /Family member detail HTTP 200/);
    for (const privateValue of [
      firstFamilyMemberId,
      secondFamilyMemberId,
      "Synthetic Member",
      "Sibling"
    ]) {
      assert.equal(output.includes(privateValue), false);
    }
  });

  for (const [name, response] of [
    ["malformed JSON", { status: 200, body: undefined }],
    ["invalid pagination", {
      status: 200,
      body: {
        items: [],
        pagination: {
          limit: 20,
          offset: 0,
          returned: 1,
          has_more: false,
          next_offset: null
        }
      }
    }],
    ["unexpected status", { status: 500, body: { error: { code: "SAFE" } } }]
  ] as const) {
    it(`rejects ${name} from family members`, async () => {
      const { dependencies, probe } = createHarness({
        responseFor: (path, token) =>
          path === "/api/v1/family-members?limit=20&offset=0" &&
            token === "mock-access-token"
            ? response
            : standardResponseFor(path, token)
      });
      const exitCode = await runAuthSmokeHarness(
        ["--allow-live-auth"],
        dependencies
      );

      assert.equal(exitCode, 1);
      assert.match(
        probe.output.join("\n"),
        /FAMILY_MEMBER_CONTRACT_INVALID|UNEXPECTED_HTTP_STATUS/
      );
    });
  }

  it("rejects private family-member fields without printing personal values", async () => {
    const privateValues = [
      firstFamilyMemberId,
      "private-user-id",
      "Synthetic Member",
      "Private Relationship"
    ];
    const exposed = {
      ...familyMemberItem(
        firstFamilyMemberId,
        "2026-11-10T10:00:00.000Z",
        privateValues[3]
      ),
      user_id: privateValues[1]
    };
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) =>
        path === "/api/v1/family-members?limit=20&offset=0" &&
          token === "mock-access-token"
          ? familyMemberList([exposed])
          : standardResponseFor(path, token)
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );
    const output = probe.output.join("\n");

    assert.equal(exitCode, 1);
    assert.match(output, /FAMILY_MEMBER_CONTRACT_INVALID/);
    for (const privateValue of privateValues) {
      assert.equal(output.includes(privateValue), false);
    }
  });

  for (const [name, item] of [
    ["blank name", { ...familyMemberItem(), name: " " }],
    ["oversized name", { ...familyMemberItem(), name: "x".repeat(101) }],
    ["numeric relationship", { ...familyMemberItem(), relationship: 4 }],
    ["blank relationship", { ...familyMemberItem(), relationship: "" }],
    ["malformed timestamp", { ...familyMemberItem(), created_at: "not-a-date" }]
  ] as const) {
    it(`rejects ${name} in family-member metadata`, async () => {
      const { dependencies, probe } = createHarness({
        responseFor: (path, token) =>
          path === "/api/v1/family-members?limit=20&offset=0" &&
            token === "mock-access-token"
            ? familyMemberList([item])
            : standardResponseFor(path, token)
      });
      const exitCode = await runAuthSmokeHarness(
        ["--allow-live-auth"],
        dependencies
      );

      assert.equal(exitCode, 1);
      assert.match(probe.output.join("\n"), /FAMILY_MEMBER_CONTRACT_INVALID/);
    });
  }

  it("rejects out-of-order family-member records", async () => {
    const { dependencies, probe } = createHarness({
      responseFor: (path, token) =>
        path === "/api/v1/family-members?limit=20&offset=0" &&
          token === "mock-access-token"
          ? familyMemberList([
              familyMemberItem(secondFamilyMemberId, "2026-11-09T10:00:00.000Z"),
              familyMemberItem(firstFamilyMemberId, "2026-11-10T10:00:00.000Z")
            ])
          : standardResponseFor(path, token)
    });
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 1);
    assert.match(probe.output.join("\n"), /FAMILY_MEMBER_CONTRACT_INVALID/);
  });

  it("uses only GET endpoint checks and never invokes privileged operations", async () => {
    const { dependencies, probe } = createHarness();
    const exitCode = await runAuthSmokeHarness(
      ["--allow-live-auth"],
      dependencies
    );

    assert.equal(exitCode, 0);
    assert.equal(probe.authCalls.length, 1);
    assert.equal(probe.createHttpClientCalls, 1);
    assert.equal(probe.createAuthProviderCalls, 1);
    assert.equal(
      probe.httpCalls.every(({ path }) => [
        "/health",
        "/api/v1/auth/me",
        "/api/v1/users/me",
        "/api/v1/health-profile/me",
        "/api/v1/prescriptions?limit=20&offset=0",
        "/api/v1/prescriptions/not-a-uuid",
        "/api/v1/medicine-cabinet?limit=20&offset=0",
        "/api/v1/medicine-cabinet/not-a-uuid",
        "/api/v1/family-members?limit=20&offset=0",
        "/api/v1/family-members/not-a-uuid"
      ].includes(path) ||
        /^\/api\/v1\/prescriptions\/[0-9a-f-]{36}$/.test(path) ||
        /^\/api\/v1\/medicine-cabinet\/[0-9a-f-]{36}$/.test(path) ||
        /^\/api\/v1\/family-members\/[0-9a-f-]{36}$/.test(path)),
      true
    );
  });
});
