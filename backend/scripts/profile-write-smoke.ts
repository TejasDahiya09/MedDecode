import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

import { readHiddenPassword } from "./auth-smoke.js";

type HttpMethod = "GET" | "POST" | "PATCH";
type SafeCategory =
  | "APPROVAL_REQUIRED"
  | "INVALID_ARGUMENTS"
  | "MISSING_CONFIGURATION"
  | "UNAPPROVED_PROJECT"
  | "INVALID_BACKEND_ORIGIN"
  | "EMPTY_CREDENTIAL"
  | "AUTH_SIGN_IN_FAILED"
  | "HTTP_REQUEST_FAILED"
  | "UNEXPECTED_HTTP_STATUS"
  | "UNSAFE_RESPONSE"
  | "IDENTITY_MISMATCH"
  | "APPLICATION_PROFILE_MISSING"
  | "HEALTH_PROFILE_ALREADY_PRESENT"
  | "PROFILE_CONTRACT_INVALID"
  | "PROFILE_OWNER_MISMATCH"
  | "DUPLICATE_CONTRACT_INVALID";

interface SafeFailureOptions {
  readonly testName: string;
  readonly category: SafeCategory;
  readonly status?: number;
}

class SafeFailure extends Error {
  readonly testName: string;
  readonly category: SafeCategory;
  readonly status?: number;

  constructor(options: SafeFailureOptions) {
    super(options.category);
    this.name = "SafeFailure";
    this.testName = options.testName;
    this.category = options.category;
    if (options.status !== undefined) this.status = options.status;
  }
}

export const SYNTHETIC_HEALTH_PROFILE_FIXTURE = Object.freeze({
  age: null,
  gender: null,
  allergies: Object.freeze([]) as readonly string[],
  diabetes: false,
  hypertension: false,
  kidney_disease: false,
  liver_disease: false,
  asthma: false,
  thyroid: false,
  pregnancy: null,
  other_conditions: Object.freeze([]) as readonly string[]
});

const SYNTHETIC_PATCH = Object.freeze({
  other_conditions: Object.freeze(["MedDecode synthetic test only"]) as readonly string[]
});

export interface ProfileWriteSmokeEnvironment {
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
  readonly AUTH_SMOKE_APPROVED_SUPABASE_URL?: string;
  readonly AUTH_SMOKE_BACKEND_ORIGIN?: string;
  readonly AUTH_SMOKE_TEST_EMAIL?: string;
}

export interface ProfileWriteHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface ProfileWriteHttpClient {
  request(
    method: HttpMethod,
    path: string,
    accessToken?: string,
    body?: Readonly<Record<string, unknown>>
  ): Promise<ProfileWriteHttpResponse>;
}

export interface ProfileWriteAuthResult {
  readonly userId: string;
  readonly email?: string;
  readonly accessToken: string;
}

export interface ProfileWriteAuthProvider {
  signInWithPassword(
    email: string,
    password: string
  ): Promise<ProfileWriteAuthResult>;
}

export interface ProfileWriteSmokeDependencies {
  readonly environment: ProfileWriteSmokeEnvironment;
  readonly output: (line: string) => void;
  readonly readHiddenPassword: () => Promise<string>;
  readonly createHttpClient: (backendOrigin: string) => ProfileWriteHttpClient;
  readonly createAuthProvider: (
    supabaseUrl: string,
    publishableKey: string
  ) => ProfileWriteAuthProvider;
}

interface ValidatedConfiguration {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly backendOrigin: string;
  readonly testEmail: string;
}

function requireApprovalFlags(arguments_: readonly string[]): void {
  const expected = new Set(["--allow-live-auth", "--allow-profile-write"]);
  if (
    arguments_.length !== expected.size ||
    arguments_.some((argument) => !expected.has(argument)) ||
    new Set(arguments_).size !== expected.size
  ) {
    throw new SafeFailure({
      testName: "Safety approval",
      category: arguments_.length === 0 ? "APPROVAL_REQUIRED" : "INVALID_ARGUMENTS"
    });
  }
}

function normalizeApprovedSupabaseOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeFailure({
      testName: "Project approval",
      category: "UNAPPROVED_PROJECT"
    });
  }

  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new SafeFailure({
      testName: "Project approval",
      category: "UNAPPROVED_PROJECT"
    });
  }

  return url.origin;
}

function normalizeLoopbackOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeFailure({
      testName: "Backend origin",
      category: "INVALID_BACKEND_ORIGIN"
    });
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new SafeFailure({
      testName: "Backend origin",
      category: "INVALID_BACKEND_ORIGIN"
    });
  }

  return url.origin;
}

function validateConfiguration(
  environment: ProfileWriteSmokeEnvironment
): ValidatedConfiguration {
  const {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    AUTH_SMOKE_APPROVED_SUPABASE_URL: approvedUrl,
    AUTH_SMOKE_BACKEND_ORIGIN: backendOrigin,
    AUTH_SMOKE_TEST_EMAIL: testEmail
  } = environment;

  if (!supabaseUrl || !publishableKey || !approvedUrl || !backendOrigin || !testEmail) {
    throw new SafeFailure({
      testName: "Configuration",
      category: "MISSING_CONFIGURATION"
    });
  }

  const configuredOrigin = normalizeApprovedSupabaseOrigin(supabaseUrl);
  const approvedOrigin = normalizeApprovedSupabaseOrigin(approvedUrl);
  if (configuredOrigin !== approvedOrigin) {
    throw new SafeFailure({
      testName: "Project approval",
      category: "UNAPPROVED_PROJECT"
    });
  }

  return {
    supabaseUrl: configuredOrigin,
    publishableKey,
    backendOrigin: normalizeLoopbackOrigin(backendOrigin),
    testEmail
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function assertStatus(
  testName: string,
  response: ProfileWriteHttpResponse,
  expectedStatus: number
): void {
  if (response.status !== expectedStatus) {
    throw new SafeFailure({
      testName,
      category: "UNEXPECTED_HTTP_STATUS",
      status: response.status
    });
  }
}

function assertIdentity(
  response: ProfileWriteHttpResponse,
  expectedUserId: string
): void {
  assertStatus("Verified identity", response, 200);
  if (!isRecord(response.body) || !hasExactKeys(response.body, ["user"])) {
    throw new SafeFailure({
      testName: "Verified identity",
      category: "UNSAFE_RESPONSE",
      status: response.status
    });
  }

  const user = response.body.user;
  if (!isRecord(user) || user.id !== expectedUserId) {
    throw new SafeFailure({
      testName: "Verified identity",
      category: "IDENTITY_MISMATCH",
      status: response.status
    });
  }
}

function assertApplicationProfile(
  response: ProfileWriteHttpResponse,
  expectedUserId: string
): void {
  if (response.status === 404) {
    throw new SafeFailure({
      testName: "Application profile precondition",
      category: "APPLICATION_PROFILE_MISSING",
      status: response.status
    });
  }
  assertStatus("Application profile precondition", response, 200);
  if (!isRecord(response.body) || !hasExactKeys(response.body, ["profile"])) {
    throw new SafeFailure({
      testName: "Application profile precondition",
      category: "PROFILE_CONTRACT_INVALID",
      status: response.status
    });
  }
  const profile = response.body.profile;
  if (!isRecord(profile) || profile.id !== expectedUserId) {
    throw new SafeFailure({
      testName: "Application profile precondition",
      category: "PROFILE_OWNER_MISMATCH",
      status: response.status
    });
  }
}

function assertExpectedMissingHealthProfile(
  response: ProfileWriteHttpResponse
): void {
  if (response.status === 200) {
    throw new SafeFailure({
      testName: "Health profile absence precondition",
      category: "HEALTH_PROFILE_ALREADY_PRESENT",
      status: response.status
    });
  }
  assertStatus("Health profile absence precondition", response, 404);
  if (!isRecord(response.body) || !hasExactKeys(response.body, ["error"])) {
    throw new SafeFailure({
      testName: "Health profile absence precondition",
      category: "PROFILE_CONTRACT_INVALID",
      status: response.status
    });
  }
  const error = response.body.error;
  if (
    !isRecord(error) ||
    !hasExactKeys(error, ["code", "message"]) ||
    error.code !== "HEALTH_PROFILE_NOT_FOUND" ||
    typeof error.message !== "string"
  ) {
    throw new SafeFailure({
      testName: "Health profile absence precondition",
      category: "PROFILE_CONTRACT_INVALID",
      status: response.status
    });
  }
}

function assertSyntheticHealthProfile(
  testName: string,
  response: ProfileWriteHttpResponse,
  expectedStatus: number,
  expectedUserId: string,
  expectedOtherConditions: readonly string[]
): void {
  assertStatus(testName, response, expectedStatus);
  if (!isRecord(response.body) || !hasExactKeys(response.body, ["healthProfile"])) {
    throw new SafeFailure({
      testName,
      category: "PROFILE_CONTRACT_INVALID",
      status: response.status
    });
  }

  const profile = response.body.healthProfile;
  const expectedKeys = [
    "id", "user_id", "age", "gender", "allergies", "diabetes",
    "hypertension", "kidney_disease", "liver_disease", "asthma", "thyroid",
    "pregnancy", "other_conditions", "created_at", "updated_at"
  ];
  if (
    !isRecord(profile) ||
    !hasExactKeys(profile, expectedKeys) ||
    typeof profile.id !== "string" ||
    profile.user_id !== expectedUserId ||
    typeof profile.created_at !== "string" ||
    typeof profile.updated_at !== "string"
  ) {
    throw new SafeFailure({
      testName,
      category: isRecord(profile) && profile.user_id !== expectedUserId
        ? "PROFILE_OWNER_MISMATCH"
        : "PROFILE_CONTRACT_INVALID",
      status: response.status
    });
  }

  const expectedValues: Record<string, unknown> = {
    ...SYNTHETIC_HEALTH_PROFILE_FIXTURE,
    other_conditions: expectedOtherConditions
  };
  for (const [field, expected] of Object.entries(expectedValues)) {
    const actual = profile[field];
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) ||
          actual.length !== expected.length ||
          actual.some((value, index) => value !== expected[index])) {
        throw new SafeFailure({
          testName,
          category: "PROFILE_CONTRACT_INVALID",
          status: response.status
        });
      }
    } else if (actual !== expected) {
      throw new SafeFailure({
        testName,
        category: "PROFILE_CONTRACT_INVALID",
        status: response.status
      });
    }
  }
}

function assertDuplicateConflict(response: ProfileWriteHttpResponse): void {
  assertStatus("Duplicate create", response, 409);
  if (!isRecord(response.body) || !hasExactKeys(response.body, ["error"])) {
    throw new SafeFailure({
      testName: "Duplicate create",
      category: "DUPLICATE_CONTRACT_INVALID",
      status: response.status
    });
  }
  const error = response.body.error;
  if (
    !isRecord(error) ||
    !hasExactKeys(error, ["code", "message"]) ||
    error.code !== "HEALTH_PROFILE_ALREADY_EXISTS" ||
    typeof error.message !== "string"
  ) {
    throw new SafeFailure({
      testName: "Duplicate create",
      category: "DUPLICATE_CONTRACT_INVALID",
      status: response.status
    });
  }
}

function pass(
  dependencies: ProfileWriteSmokeDependencies,
  testName: string,
  status?: number
): void {
  const suffix = status === undefined ? "" : ` HTTP ${status}`;
  dependencies.output(`[PASS] ${testName}${suffix}`);
}

function safeFailure(error: unknown): SafeFailure {
  return error instanceof SafeFailure
    ? error
    : new SafeFailure({
        testName: "Profile write smoke test",
        category: "HTTP_REQUEST_FAILED"
      });
}

export async function runProfileWriteSmokeHarness(
  arguments_: readonly string[],
  dependencies: ProfileWriteSmokeDependencies
): Promise<number> {
  let password = "";
  let accessToken = "";
  let profileCreated = false;
  let passed = 0;

  try {
    requireApprovalFlags(arguments_);
    pass(dependencies, "Dual safety approval");
    passed += 1;

    const configuration = validateConfiguration(dependencies.environment);
    pass(dependencies, "Approved configuration");
    passed += 1;
    const http = dependencies.createHttpClient(configuration.backendOrigin);

    const health = await http.request("GET", "/health");
    assertStatus("Public health precondition", health, 200);
    pass(dependencies, "Public health precondition", health.status);
    passed += 1;

    password = await dependencies.readHiddenPassword();
    if (!password) {
      throw new SafeFailure({
        testName: "Credential input",
        category: "EMPTY_CREDENTIAL"
      });
    }

    const provider = dependencies.createAuthProvider(
      configuration.supabaseUrl,
      configuration.publishableKey
    );
    let signedIn: ProfileWriteAuthResult | undefined;
    try {
      signedIn = await provider.signInWithPassword(configuration.testEmail, password);
    } catch {
      throw new SafeFailure({
        testName: "Test account sign-in",
        category: "AUTH_SIGN_IN_FAILED"
      });
    }
    password = "";
    accessToken = signedIn.accessToken;
    const expectedUserId = signedIn.userId;
    signedIn = undefined;
    pass(dependencies, "Test account sign-in");
    passed += 1;

    const identity = await http.request("GET", "/api/v1/auth/me", accessToken);
    assertIdentity(identity, expectedUserId);
    pass(dependencies, "Verified identity", identity.status);
    passed += 1;

    const applicationProfile = await http.request(
      "GET",
      "/api/v1/users/me",
      accessToken
    );
    assertApplicationProfile(applicationProfile, expectedUserId);
    pass(dependencies, "Application profile precondition", applicationProfile.status);
    passed += 1;

    const existingHealth = await http.request(
      "GET",
      "/api/v1/health-profile/me",
      accessToken
    );
    assertExpectedMissingHealthProfile(existingHealth);
    pass(dependencies, "Health profile absence precondition", existingHealth.status);
    passed += 1;

    const created = await http.request(
      "POST",
      "/api/v1/health-profile/me",
      accessToken,
      SYNTHETIC_HEALTH_PROFILE_FIXTURE
    );
    if (created.status === 201) profileCreated = true;
    assertSyntheticHealthProfile(
      "Synthetic profile create",
      created,
      201,
      expectedUserId,
      []
    );
    pass(dependencies, "Synthetic profile create", created.status);
    passed += 1;

    const afterCreate = await http.request(
      "GET",
      "/api/v1/health-profile/me",
      accessToken
    );
    assertSyntheticHealthProfile(
      "Create persistence verification",
      afterCreate,
      200,
      expectedUserId,
      []
    );
    pass(dependencies, "Create persistence verification", afterCreate.status);
    passed += 1;

    const patched = await http.request(
      "PATCH",
      "/api/v1/health-profile/me",
      accessToken,
      SYNTHETIC_PATCH
    );
    assertSyntheticHealthProfile(
      "Synthetic profile patch",
      patched,
      200,
      expectedUserId,
      SYNTHETIC_PATCH.other_conditions
    );
    pass(dependencies, "Synthetic profile patch", patched.status);
    passed += 1;

    const afterPatch = await http.request(
      "GET",
      "/api/v1/health-profile/me",
      accessToken
    );
    assertSyntheticHealthProfile(
      "Patch persistence verification",
      afterPatch,
      200,
      expectedUserId,
      SYNTHETIC_PATCH.other_conditions
    );
    pass(dependencies, "Patch persistence verification", afterPatch.status);
    passed += 1;

    const duplicate = await http.request(
      "POST",
      "/api/v1/health-profile/me",
      accessToken,
      SYNTHETIC_HEALTH_PROFILE_FIXTURE
    );
    accessToken = "";
    assertDuplicateConflict(duplicate);
    pass(dependencies, "Duplicate create", duplicate.status);
    passed += 1;

    dependencies.output("[NOTICE] SYNTHETIC_PROFILE_RETAINED");
    dependencies.output(`[SUMMARY] PASS ${passed} checks`);
    return 0;
  } catch (error) {
    password = "";
    accessToken = "";
    const failure = safeFailure(error);
    const status = failure.status === undefined ? "" : ` HTTP ${failure.status}`;
    dependencies.output(`[FAIL] ${failure.testName} ${failure.category}${status}`);
    if (profileCreated) dependencies.output("[NOTICE] SYNTHETIC_PROFILE_MAY_REMAIN");
    dependencies.output(`[SUMMARY] FAIL after ${passed} checks`);
    return 1;
  }
}

function createDefaultHttpClient(backendOrigin: string): ProfileWriteHttpClient {
  return {
    async request(method, path, accessToken, body) {
      try {
        const response = await fetch(`${backendOrigin}${path}`, {
          method,
          redirect: "error",
          headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...(body ? { "Content-Type": "application/json" } : {})
          },
          ...(body ? { body: JSON.stringify(body) } : {})
        });
        return {
          status: response.status,
          body: await response.json().catch(() => undefined)
        };
      } catch {
        throw new SafeFailure({
          testName: "Backend request",
          category: "HTTP_REQUEST_FAILED"
        });
      }
    }
  };
}

function createDefaultAuthProvider(
  supabaseUrl: string,
  publishableKey: string
): ProfileWriteAuthProvider {
  const client = createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  return {
    async signInWithPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.user?.id || !data.session?.access_token) {
        throw new SafeFailure({
          testName: "Test account sign-in",
          category: "AUTH_SIGN_IN_FAILED"
        });
      }
      return {
        userId: data.user.id,
        ...(data.user.email === undefined ? {} : { email: data.user.email }),
        accessToken: data.session.access_token
      };
    }
  };
}

function loadLocalEnvironment(): void {
  dotenv.config({
    ...(process.env.DOTENV_CONFIG_PATH
      ? { path: process.env.DOTENV_CONFIG_PATH }
      : {}),
    quiet: true
  });
}

function createDefaultDependencies(): ProfileWriteSmokeDependencies {
  return {
    environment: process.env,
    output: (line) => console.log(line),
    readHiddenPassword,
    createHttpClient: createDefaultHttpClient,
    createAuthProvider: createDefaultAuthProvider
  };
}

if (require.main === module) {
  loadLocalEnvironment();
  void runProfileWriteSmokeHarness(
    process.argv.slice(2),
    createDefaultDependencies()
  ).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
