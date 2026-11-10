import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import type { ReadStream, WriteStream } from "node:tty";

type SafeCategory =
  | "APPROVAL_REQUIRED"
  | "INVALID_ARGUMENTS"
  | "MISSING_CONFIGURATION"
  | "UNAPPROVED_PROJECT"
  | "INVALID_BACKEND_ORIGIN"
  | "SAFE_INPUT_UNAVAILABLE"
  | "EMPTY_CREDENTIAL"
  | "HTTP_REQUEST_FAILED"
  | "UNEXPECTED_HTTP_STATUS"
  | "AUTH_SIGN_IN_FAILED"
  | "IDENTITY_MISMATCH"
  | "UNSAFE_RESPONSE";

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
    if (options.status !== undefined) {
      this.status = options.status;
    }
  }
}

export interface SmokeEnvironment {
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
  readonly AUTH_SMOKE_APPROVED_SUPABASE_URL?: string;
  readonly AUTH_SMOKE_BACKEND_ORIGIN?: string;
  readonly AUTH_SMOKE_TEST_EMAIL?: string;
}

export interface SmokeHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface SmokeHttpClient {
  get(path: string, accessToken?: string): Promise<SmokeHttpResponse>;
}

export interface SmokeAuthResult {
  readonly userId: string;
  readonly email?: string;
  readonly accessToken: string;
}

export interface SmokeAuthProvider {
  signInWithPassword(email: string, password: string): Promise<SmokeAuthResult>;
}

export interface SmokeDependencies {
  readonly environment: SmokeEnvironment;
  readonly output: (line: string) => void;
  readonly readHiddenPassword: () => Promise<string>;
  readonly createHttpClient: (backendOrigin: string) => SmokeHttpClient;
  readonly createAuthProvider: (
    supabaseUrl: string,
    publishableKey: string
  ) => SmokeAuthProvider;
}

interface ValidatedConfiguration {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly backendOrigin: string;
  readonly testEmail: string;
}

function requireSingleApprovalFlag(arguments_: readonly string[]): void {
  if (arguments_.length === 0) {
    throw new SafeFailure({
      testName: "Safety approval",
      category: "APPROVAL_REQUIRED"
    });
  }

  if (arguments_.length !== 1 || arguments_[0] !== "--allow-live-auth") {
    throw new SafeFailure({
      testName: "Safety approval",
      category: "INVALID_ARGUMENTS"
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

  const officialHostname = /^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname);
  if (
    url.protocol !== "https:" ||
    !officialHostname ||
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

  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !loopbackHosts.has(url.hostname) ||
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
  environment: SmokeEnvironment
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

function assertStatus(
  testName: string,
  response: SmokeHttpResponse,
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

function assertSafeIdentityResponse(
  response: SmokeHttpResponse,
  expected: Omit<SmokeAuthResult, "accessToken">
): void {
  if (!response.body || typeof response.body !== "object") {
    throw new SafeFailure({
      testName: "Verified identity",
      category: "IDENTITY_MISMATCH"
    });
  }

  const record = response.body as Record<string, unknown>;
  const user = record.user;
  const topLevelKeys = Object.keys(record);
  if (
    topLevelKeys.length !== 1 ||
    topLevelKeys[0] !== "user" ||
    !user ||
    typeof user !== "object"
  ) {
    throw new SafeFailure({
      testName: "Verified identity",
      category: "UNSAFE_RESPONSE"
    });
  }

  const userRecord = user as Record<string, unknown>;
  const allowedUserKeys = new Set(["id", "email"]);
  if (Object.keys(userRecord).some((key) => !allowedUserKeys.has(key))) {
    throw new SafeFailure({
      testName: "Verified identity",
      category: "UNSAFE_RESPONSE"
    });
  }

  if (userRecord.id !== expected.userId) {
    throw new SafeFailure({
      testName: "Verified identity",
      category: "IDENTITY_MISMATCH"
    });
  }

  if (expected.email !== undefined && userRecord.email !== expected.email) {
    throw new SafeFailure({
      testName: "Verified identity",
      category: "IDENTITY_MISMATCH"
    });
  }
}

function pass(
  dependencies: SmokeDependencies,
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
        testName: "Smoke test",
        category: "HTTP_REQUEST_FAILED"
      });
}

export async function runAuthSmokeHarness(
  arguments_: readonly string[],
  dependencies: SmokeDependencies
): Promise<number> {
  let password = "";
  let accessToken = "";
  let passed = 0;

  try {
    requireSingleApprovalFlag(arguments_);
    pass(dependencies, "Safety approval");
    passed += 1;

    const configuration = validateConfiguration(dependencies.environment);
    pass(dependencies, "Approved configuration");
    passed += 1;

    const http = dependencies.createHttpClient(configuration.backendOrigin);

    const health = await http.get("/health");
    assertStatus("Public health", health, 200);
    pass(dependencies, "Public health", health.status);
    passed += 1;

    const missingToken = await http.get("/api/v1/auth/me");
    assertStatus("Missing token", missingToken, 401);
    pass(dependencies, "Missing token", missingToken.status);
    passed += 1;

    const invalidToken = await http.get(
      "/api/v1/auth/me",
      "meddecode-synthetic-invalid-token"
    );
    assertStatus("Invalid token", invalidToken, 401);
    pass(dependencies, "Invalid token", invalidToken.status);
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
    let signedIn: SmokeAuthResult | undefined;
    try {
      signedIn = await provider.signInWithPassword(
        configuration.testEmail,
        password
      );
    } catch {
      throw new SafeFailure({
        testName: "Test account sign-in",
        category: "AUTH_SIGN_IN_FAILED"
      });
    }
    password = "";
    accessToken = signedIn.accessToken;
    const expectedIdentity: Omit<SmokeAuthResult, "accessToken"> = {
      userId: signedIn.userId,
      ...(signedIn.email === undefined ? {} : { email: signedIn.email })
    };
    signedIn = undefined;
    pass(dependencies, "Test account sign-in");
    passed += 1;

    const verified = await http.get("/api/v1/auth/me", accessToken);
    accessToken = "";
    assertStatus("Verified identity", verified, 200);
    assertSafeIdentityResponse(verified, expectedIdentity);
    pass(dependencies, "Verified identity", verified.status);
    passed += 1;

    dependencies.output(`[SUMMARY] PASS ${passed} checks`);
    return 0;
  } catch (error) {
    password = "";
    accessToken = "";
    const failure = safeFailure(error);
    const status = failure.status === undefined ? "" : ` HTTP ${failure.status}`;
    dependencies.output(
      `[FAIL] ${failure.testName} ${failure.category}${status}`
    );
    dependencies.output(`[SUMMARY] FAIL after ${passed} checks`);
    return 1;
  }
}

function createDefaultHttpClient(backendOrigin: string): SmokeHttpClient {
  return {
    async get(path, accessToken) {
      try {
        const response = await fetch(`${backendOrigin}${path}`, {
          method: "GET",
          redirect: "error",
          ...(accessToken
            ? { headers: { Authorization: `Bearer ${accessToken}` } }
            : {})
        });
        const body = await response.json().catch(() => undefined);
        return { status: response.status, body };
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
): SmokeAuthProvider {
  const client = createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  return {
    async signInWithPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password
      });

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

export function readHiddenPassword(
  input: ReadStream = process.stdin,
  output: WriteStream = process.stdout
): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new SafeFailure({
      testName: "Credential input",
      category: "SAFE_INPUT_UNAVAILABLE"
    }));
  }

  return new Promise((resolve, reject) => {
    let secret = "";
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
    };
    const onData = (chunk: Buffer | string) => {
      const characters = chunk.toString();
      for (const character of characters) {
        if (character === "\u0003") {
          secret = "";
          cleanup();
          reject(new SafeFailure({
            testName: "Credential input",
            category: "EMPTY_CREDENTIAL"
          }));
          return;
        }
        if (character === "\r" || character === "\n") {
          const result = secret;
          secret = "";
          cleanup();
          resolve(result);
          return;
        }
        if (character === "\b" || character === "\u007f") {
          secret = secret.slice(0, -1);
          continue;
        }
        if (character >= " " && secret.length < 256) {
          secret += character;
        }
      }
    };

    output.write("Credential input: ");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

function loadLocalEnvironment(): void {
  dotenv.config({
    ...(process.env.DOTENV_CONFIG_PATH
      ? { path: process.env.DOTENV_CONFIG_PATH }
      : {}),
    quiet: true
  });
}

function createDefaultDependencies(): SmokeDependencies {
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
  void runAuthSmokeHarness(process.argv.slice(2), createDefaultDependencies())
    .then((exitCode) => {
      process.exitCode = exitCode;
    });
}
