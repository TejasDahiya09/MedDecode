import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
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
  | "UNSAFE_RESPONSE"
  | "PROFILE_CONTRACT_INVALID"
  | "PROFILE_OWNER_MISMATCH"
  | "HISTORY_CONTRACT_INVALID"
  | "CABINET_CONTRACT_INVALID"
  | "FAMILY_MEMBER_CONTRACT_INVALID";

type ProfileReadReason = "PROFILE_PRESENT" | "PROFILE_NOT_FOUND";
type HistoryReadReason = "HISTORY_EMPTY" | "HISTORY_PRESENT";
type CabinetReadReason = "CABINET_EMPTY" | "CABINET_PRESENT";
type FamilyMemberReadReason = "FAMILY_MEMBERS_EMPTY" | "FAMILY_MEMBERS_PRESENT";

const PRESCRIPTION_FILE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf"
]);
const PRESCRIPTION_STATUSES = new Set([
  "uploaded",
  "queued",
  "processing",
  "completed",
  "completed_with_warnings",
  "failed"
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;
const HISTORY_ITEM_FIELDS = [
  "id",
  "file_type",
  "file_size_bytes",
  "status",
  "prescription_date",
  "created_at",
  "updated_at",
  "processed_at"
] as const;
const CABINET_ITEM_FIELDS = [
  "id",
  "medicine_id",
  "quantity",
  "purchase_date",
  "expiry_date",
  "refill_date",
  "usage_information",
  "created_at",
  "updated_at"
] as const;
const FAMILY_MEMBER_ITEM_FIELDS = [
  "id",
  "name",
  "relationship",
  "created_at",
  "updated_at"
] as const;
const DECIMAL_QUANTITY_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  record: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  const actualKeys = Object.keys(record).sort();
  const sortedExpected = [...expectedKeys].sort();
  return actualKeys.length === sortedExpected.length &&
    actualKeys.every((key, index) => key === sortedExpected[index]);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function assertExpectedMissingProfile(
  testName: string,
  response: SmokeHttpResponse,
  expectedCode: string
): ProfileReadReason {
  if (!isRecord(response.body) || !hasExactKeys(response.body, ["error"])) {
    throw new SafeFailure({
      testName,
      category: "PROFILE_CONTRACT_INVALID",
      status: response.status
    });
  }

  const error = response.body.error;
  if (
    !isRecord(error) ||
    !hasExactKeys(error, ["code", "message"]) ||
    error.code !== expectedCode ||
    typeof error.message !== "string"
  ) {
    throw new SafeFailure({
      testName,
      category: "PROFILE_CONTRACT_INVALID",
      status: response.status
    });
  }

  return "PROFILE_NOT_FOUND";
}

function assertApplicationProfileResponse(
  response: SmokeHttpResponse,
  expectedUserId: string
): ProfileReadReason {
  const testName = "Application profile";
  if (response.status === 404) {
    return assertExpectedMissingProfile(
      testName,
      response,
      "USER_PROFILE_NOT_FOUND"
    );
  }

  if (response.status !== 200) {
    throw new SafeFailure({
      testName,
      category: "UNEXPECTED_HTTP_STATUS",
      status: response.status
    });
  }

  if (!isRecord(response.body) || !hasExactKeys(response.body, ["profile"])) {
    throw new SafeFailure({
      testName,
      category: "PROFILE_CONTRACT_INVALID",
      status: response.status
    });
  }

  const profile = response.body.profile;
  const fields = ["id", "email", "name", "created_at", "updated_at"];
  if (
    !isRecord(profile) ||
    !hasExactKeys(profile, fields) ||
    typeof profile.id !== "string" ||
    !isNullableString(profile.email) ||
    !isNullableString(profile.name) ||
    typeof profile.created_at !== "string" ||
    typeof profile.updated_at !== "string"
  ) {
    throw new SafeFailure({
      testName,
      category: "PROFILE_CONTRACT_INVALID",
      status: response.status
    });
  }

  if (profile.id !== expectedUserId) {
    throw new SafeFailure({
      testName,
      category: "PROFILE_OWNER_MISMATCH",
      status: response.status
    });
  }

  return "PROFILE_PRESENT";
}

function assertHealthProfileResponse(
  response: SmokeHttpResponse,
  expectedUserId: string
): ProfileReadReason {
  const testName = "Health profile";
  if (response.status === 404) {
    return assertExpectedMissingProfile(
      testName,
      response,
      "HEALTH_PROFILE_NOT_FOUND"
    );
  }

  if (response.status !== 200) {
    throw new SafeFailure({
      testName,
      category: "UNEXPECTED_HTTP_STATUS",
      status: response.status
    });
  }

  if (
    !isRecord(response.body) ||
    !hasExactKeys(response.body, ["healthProfile"])
  ) {
    throw new SafeFailure({
      testName,
      category: "PROFILE_CONTRACT_INVALID",
      status: response.status
    });
  }

  const profile = response.body.healthProfile;
  const fields = [
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
  ];
  if (
    !isRecord(profile) ||
    !hasExactKeys(profile, fields) ||
    typeof profile.id !== "string" ||
    typeof profile.user_id !== "string" ||
    !(profile.age === null || Number.isInteger(profile.age)) ||
    !isNullableString(profile.gender) ||
    !isStringArray(profile.allergies) ||
    typeof profile.diabetes !== "boolean" ||
    typeof profile.hypertension !== "boolean" ||
    typeof profile.kidney_disease !== "boolean" ||
    typeof profile.liver_disease !== "boolean" ||
    typeof profile.asthma !== "boolean" ||
    typeof profile.thyroid !== "boolean" ||
    !(profile.pregnancy === null || typeof profile.pregnancy === "boolean") ||
    !isStringArray(profile.other_conditions) ||
    typeof profile.created_at !== "string" ||
    typeof profile.updated_at !== "string"
  ) {
    throw new SafeFailure({
      testName,
      category: "PROFILE_CONTRACT_INVALID",
      status: response.status
    });
  }

  if (profile.user_id !== expectedUserId) {
    throw new SafeFailure({
      testName,
      category: "PROFILE_OWNER_MISMATCH",
      status: response.status
    });
  }

  return "PROFILE_PRESENT";
}

interface SafeHistoryItem {
  readonly id: string;
  readonly createdAt: string;
}

function historyFailure(testName: string, status?: number): SafeFailure {
  return new SafeFailure({
    testName,
    category: "HISTORY_CONTRACT_INVALID",
    ...(status === undefined ? {} : { status })
  });
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    Number.isFinite(Date.parse(value));
}

function assertHistoryItem(
  value: unknown,
  testName: string,
  status: number
): SafeHistoryItem {
  if (!isRecord(value) || !hasExactKeys(value, HISTORY_ITEM_FIELDS)) {
    throw historyFailure(testName, status);
  }

  if (
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.file_type !== "string" ||
    !PRESCRIPTION_FILE_TYPES.has(value.file_type) ||
    !(
      value.file_size_bytes === null ||
      (typeof value.file_size_bytes === "string" &&
        DECIMAL_INTEGER_PATTERN.test(value.file_size_bytes))
    ) ||
    typeof value.status !== "string" ||
    !PRESCRIPTION_STATUSES.has(value.status) ||
    !isNullableString(value.prescription_date) ||
    !isValidTimestamp(value.created_at) ||
    !isValidTimestamp(value.updated_at) ||
    !(value.processed_at === null || isValidTimestamp(value.processed_at))
  ) {
    throw historyFailure(testName, status);
  }

  return { id: value.id, createdAt: value.created_at };
}

function compareHistoryOrder(left: SafeHistoryItem, right: SafeHistoryItem): number {
  const timeDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (timeDifference !== 0) return timeDifference;
  return right.id > left.id ? 1 : right.id < left.id ? -1 : 0;
}

function assertHistoryListResponse(
  response: SmokeHttpResponse
): { readonly reason: HistoryReadReason; readonly firstId?: string } {
  const testName = "Prescription history";
  if (response.status !== 200) {
    throw new SafeFailure({
      testName,
      category: "UNEXPECTED_HTTP_STATUS",
      status: response.status
    });
  }
  if (!isRecord(response.body) || !hasExactKeys(response.body, ["items", "pagination"])) {
    throw historyFailure(testName, response.status);
  }

  const { items, pagination } = response.body;
  if (!Array.isArray(items) || !isRecord(pagination) ||
    !hasExactKeys(pagination, [
      "limit",
      "offset",
      "returned",
      "has_more",
      "next_offset"
    ])) {
    throw historyFailure(testName, response.status);
  }
  if (
    pagination.limit !== 20 ||
    pagination.offset !== 0 ||
    !Number.isInteger(pagination.returned) ||
    (pagination.returned as number) < 0 ||
    (pagination.returned as number) > 20 ||
    pagination.returned !== items.length ||
    typeof pagination.has_more !== "boolean" ||
    !(
      pagination.next_offset === null ||
      Number.isInteger(pagination.next_offset)
    ) ||
    (pagination.has_more
      ? pagination.next_offset !== 20
      : pagination.next_offset !== null)
  ) {
    throw historyFailure(testName, response.status);
  }

  const safeItems = items.map((item) =>
    assertHistoryItem(item, testName, response.status)
  );
  for (let index = 1; index < safeItems.length; index += 1) {
    const previous = safeItems[index - 1];
    const current = safeItems[index];
    if (!previous || !current || compareHistoryOrder(previous, current) > 0) {
      throw historyFailure(testName, response.status);
    }
  }

  return safeItems[0]
    ? { reason: "HISTORY_PRESENT", firstId: safeItems[0].id }
    : { reason: "HISTORY_EMPTY" };
}

function assertHistoryDetailResponse(
  response: SmokeHttpResponse,
  expectedId: string
): void {
  const testName = "Prescription history detail";
  if (response.status !== 200) {
    throw new SafeFailure({
      testName,
      category: "UNEXPECTED_HTTP_STATUS",
      status: response.status
    });
  }
  if (!isRecord(response.body) || !hasExactKeys(response.body, ["prescription"])) {
    throw historyFailure(testName, response.status);
  }
  const item = assertHistoryItem(response.body.prescription, testName, response.status);
  if (item.id !== expectedId) throw historyFailure(testName, response.status);
}

function assertExactError(
  testName: string,
  response: SmokeHttpResponse,
  expectedStatus: number,
  expectedCode: string
): void {
  assertStatus(testName, response, expectedStatus);
  if (!isRecord(response.body) || !hasExactKeys(response.body, ["error"]) ||
    !isRecord(response.body.error) ||
    !hasExactKeys(response.body.error, ["code", "message"]) ||
    response.body.error.code !== expectedCode ||
    typeof response.body.error.message !== "string") {
    throw historyFailure(testName, response.status);
  }
}

function passHistoryRead(
  dependencies: SmokeDependencies,
  status: number,
  reason: HistoryReadReason
): void {
  dependencies.output(`[PASS] Prescription history HTTP ${status} ${reason}`);
}

interface SafeCabinetItem {
  readonly id: string;
  readonly createdAt: string;
}

function cabinetFailure(testName: string, status?: number): SafeFailure {
  return new SafeFailure({
    testName,
    category: "CABINET_CONTRACT_INVALID",
    ...(status === undefined ? {} : { status })
  });
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function assertCabinetItem(
  value: unknown,
  testName: string,
  status: number
): SafeCabinetItem {
  if (!isRecord(value) || !hasExactKeys(value, CABINET_ITEM_FIELDS)) {
    throw cabinetFailure(testName, status);
  }
  if (
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.medicine_id !== "string" ||
    !UUID_PATTERN.test(value.medicine_id) ||
    !(
      value.quantity === null ||
      (typeof value.quantity === "string" &&
        DECIMAL_QUANTITY_PATTERN.test(value.quantity))
    ) ||
    !(value.purchase_date === null || isValidDate(value.purchase_date)) ||
    !(value.expiry_date === null || isValidDate(value.expiry_date)) ||
    !(value.refill_date === null || isValidDate(value.refill_date)) ||
    !isNullableString(value.usage_information) ||
    !isValidTimestamp(value.created_at) ||
    !isValidTimestamp(value.updated_at)
  ) {
    throw cabinetFailure(testName, status);
  }
  return { id: value.id, createdAt: value.created_at };
}

function compareCabinetOrder(left: SafeCabinetItem, right: SafeCabinetItem): number {
  const timeDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (timeDifference !== 0) return timeDifference;
  return right.id > left.id ? 1 : right.id < left.id ? -1 : 0;
}

function assertCabinetListResponse(
  response: SmokeHttpResponse
): { readonly reason: CabinetReadReason; readonly firstId?: string } {
  const testName = "Medicine cabinet";
  if (response.status !== 200) {
    throw new SafeFailure({
      testName,
      category: "UNEXPECTED_HTTP_STATUS",
      status: response.status
    });
  }
  if (!isRecord(response.body) || !hasExactKeys(response.body, ["items", "pagination"])) {
    throw cabinetFailure(testName, response.status);
  }
  const { items, pagination } = response.body;
  if (!Array.isArray(items) || !isRecord(pagination) ||
    !hasExactKeys(pagination, ["limit", "offset", "returned", "has_more", "next_offset"])) {
    throw cabinetFailure(testName, response.status);
  }
  if (
    pagination.limit !== 20 ||
    pagination.offset !== 0 ||
    !Number.isInteger(pagination.returned) ||
    (pagination.returned as number) < 0 ||
    (pagination.returned as number) > 20 ||
    pagination.returned !== items.length ||
    typeof pagination.has_more !== "boolean" ||
    !(pagination.next_offset === null || Number.isInteger(pagination.next_offset)) ||
    (pagination.has_more ? pagination.next_offset !== 20 : pagination.next_offset !== null)
  ) {
    throw cabinetFailure(testName, response.status);
  }
  const safeItems = items.map((item) =>
    assertCabinetItem(item, testName, response.status)
  );
  for (let index = 1; index < safeItems.length; index += 1) {
    const previous = safeItems[index - 1];
    const current = safeItems[index];
    if (!previous || !current || compareCabinetOrder(previous, current) > 0) {
      throw cabinetFailure(testName, response.status);
    }
  }
  return safeItems[0]
    ? { reason: "CABINET_PRESENT", firstId: safeItems[0].id }
    : { reason: "CABINET_EMPTY" };
}

function assertCabinetDetailResponse(
  response: SmokeHttpResponse,
  expectedId: string
): void {
  const testName = "Medicine cabinet detail";
  if (response.status !== 200) {
    throw new SafeFailure({
      testName,
      category: "UNEXPECTED_HTTP_STATUS",
      status: response.status
    });
  }
  if (!isRecord(response.body) || !hasExactKeys(response.body, ["entry"])) {
    throw cabinetFailure(testName, response.status);
  }
  const item = assertCabinetItem(response.body.entry, testName, response.status);
  if (item.id !== expectedId) throw cabinetFailure(testName, response.status);
}

function passCabinetRead(
  dependencies: SmokeDependencies,
  status: number,
  reason: CabinetReadReason
): void {
  dependencies.output(`[PASS] Medicine cabinet HTTP ${status} ${reason}`);
}

interface SafeFamilyMemberItem {
  readonly id: string;
  readonly createdAt: string;
}

function familyMemberFailure(testName: string, status?: number): SafeFailure {
  return new SafeFailure({
    testName,
    category: "FAMILY_MEMBER_CONTRACT_INVALID",
    ...(status === undefined ? {} : { status })
  });
}

function isValidFamilyMemberText(value: unknown): value is string {
  return typeof value === "string" &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 100;
}

function assertFamilyMemberItem(
  value: unknown,
  testName: string,
  status: number
): SafeFamilyMemberItem {
  if (!isRecord(value) || !hasExactKeys(value, FAMILY_MEMBER_ITEM_FIELDS)) {
    throw familyMemberFailure(testName, status);
  }
  if (
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    !isValidFamilyMemberText(value.name) ||
    !(
      value.relationship === null ||
      isValidFamilyMemberText(value.relationship)
    ) ||
    !isValidTimestamp(value.created_at) ||
    !isValidTimestamp(value.updated_at)
  ) {
    throw familyMemberFailure(testName, status);
  }
  return { id: value.id, createdAt: value.created_at };
}

function compareFamilyMemberOrder(
  left: SafeFamilyMemberItem,
  right: SafeFamilyMemberItem
): number {
  const timeDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (timeDifference !== 0) return timeDifference;
  return right.id > left.id ? 1 : right.id < left.id ? -1 : 0;
}

function assertFamilyMemberListResponse(
  response: SmokeHttpResponse
): { readonly reason: FamilyMemberReadReason; readonly firstId?: string } {
  const testName = "Family members";
  if (response.status !== 200) {
    throw new SafeFailure({
      testName,
      category: "UNEXPECTED_HTTP_STATUS",
      status: response.status
    });
  }
  if (!isRecord(response.body) || !hasExactKeys(response.body, ["items", "pagination"])) {
    throw familyMemberFailure(testName, response.status);
  }
  const { items, pagination } = response.body;
  if (!Array.isArray(items) || !isRecord(pagination) ||
    !hasExactKeys(pagination, ["limit", "offset", "returned", "has_more", "next_offset"])) {
    throw familyMemberFailure(testName, response.status);
  }
  if (
    pagination.limit !== 20 ||
    pagination.offset !== 0 ||
    !Number.isInteger(pagination.returned) ||
    (pagination.returned as number) < 0 ||
    (pagination.returned as number) > 20 ||
    pagination.returned !== items.length ||
    typeof pagination.has_more !== "boolean" ||
    !(pagination.next_offset === null || Number.isInteger(pagination.next_offset)) ||
    (pagination.has_more ? pagination.next_offset !== 20 : pagination.next_offset !== null)
  ) {
    throw familyMemberFailure(testName, response.status);
  }
  const safeItems = items.map((item) =>
    assertFamilyMemberItem(item, testName, response.status)
  );
  for (let index = 1; index < safeItems.length; index += 1) {
    const previous = safeItems[index - 1];
    const current = safeItems[index];
    if (!previous || !current || compareFamilyMemberOrder(previous, current) > 0) {
      throw familyMemberFailure(testName, response.status);
    }
  }
  return safeItems[0]
    ? { reason: "FAMILY_MEMBERS_PRESENT", firstId: safeItems[0].id }
    : { reason: "FAMILY_MEMBERS_EMPTY" };
}

function assertFamilyMemberDetailResponse(
  response: SmokeHttpResponse,
  expectedId: string
): void {
  const testName = "Family member detail";
  if (response.status !== 200) {
    throw new SafeFailure({
      testName,
      category: "UNEXPECTED_HTTP_STATUS",
      status: response.status
    });
  }
  if (!isRecord(response.body) || !hasExactKeys(response.body, ["member"])) {
    throw familyMemberFailure(testName, response.status);
  }
  const item = assertFamilyMemberItem(response.body.member, testName, response.status);
  if (item.id !== expectedId) throw familyMemberFailure(testName, response.status);
}

function passFamilyMemberRead(
  dependencies: SmokeDependencies,
  status: number,
  reason: FamilyMemberReadReason
): void {
  dependencies.output(`[PASS] Family members HTTP ${status} ${reason}`);
}

function pass(
  dependencies: SmokeDependencies,
  testName: string,
  status?: number
): void {
  const suffix = status === undefined ? "" : ` HTTP ${status}`;
  dependencies.output(`[PASS] ${testName}${suffix}`);
}

function passProfileRead(
  dependencies: SmokeDependencies,
  endpointName: string,
  status: number,
  reason: ProfileReadReason
): void {
  dependencies.output(`[PASS] ${endpointName} HTTP ${status} ${reason}`);
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

    const missingHistoryToken = await http.get(
      "/api/v1/prescriptions?limit=20&offset=0"
    );
    assertStatus("History missing token", missingHistoryToken, 401);
    pass(dependencies, "History missing token", missingHistoryToken.status);
    passed += 1;

    const invalidHistoryToken = await http.get(
      "/api/v1/prescriptions?limit=20&offset=0",
      "meddecode-synthetic-invalid-token"
    );
    assertStatus("History invalid token", invalidHistoryToken, 401);
    pass(dependencies, "History invalid token", invalidHistoryToken.status);
    passed += 1;

    const missingCabinetToken = await http.get(
      "/api/v1/medicine-cabinet?limit=20&offset=0"
    );
    assertStatus("Cabinet missing token", missingCabinetToken, 401);
    pass(dependencies, "Cabinet missing token", missingCabinetToken.status);
    passed += 1;

    const invalidCabinetToken = await http.get(
      "/api/v1/medicine-cabinet?limit=20&offset=0",
      "meddecode-synthetic-invalid-token"
    );
    assertStatus("Cabinet invalid token", invalidCabinetToken, 401);
    pass(dependencies, "Cabinet invalid token", invalidCabinetToken.status);
    passed += 1;

    const missingFamilyMemberToken = await http.get(
      "/api/v1/family-members?limit=20&offset=0"
    );
    assertStatus("Family members missing token", missingFamilyMemberToken, 401);
    pass(dependencies, "Family members missing token", missingFamilyMemberToken.status);
    passed += 1;

    const invalidFamilyMemberToken = await http.get(
      "/api/v1/family-members?limit=20&offset=0",
      "meddecode-synthetic-invalid-token"
    );
    assertStatus("Family members invalid token", invalidFamilyMemberToken, 401);
    pass(dependencies, "Family members invalid token", invalidFamilyMemberToken.status);
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
    assertStatus("Verified identity", verified, 200);
    assertSafeIdentityResponse(verified, expectedIdentity);
    pass(dependencies, "Verified identity", verified.status);
    passed += 1;

    const applicationProfile = await http.get(
      "/api/v1/users/me",
      accessToken
    );
    const applicationReason = assertApplicationProfileResponse(
      applicationProfile,
      expectedIdentity.userId
    );
    passProfileRead(
      dependencies,
      "Application profile",
      applicationProfile.status,
      applicationReason
    );
    passed += 1;

    const healthProfile = await http.get(
      "/api/v1/health-profile/me",
      accessToken
    );
    const healthReason = assertHealthProfileResponse(
      healthProfile,
      expectedIdentity.userId
    );
    passProfileRead(
      dependencies,
      "Health profile",
      healthProfile.status,
      healthReason
    );
    passed += 1;

    const history = await http.get(
      "/api/v1/prescriptions?limit=20&offset=0",
      accessToken
    );
    const historyResult = assertHistoryListResponse(history);
    passHistoryRead(dependencies, history.status, historyResult.reason);
    passed += 1;

    if (historyResult.firstId) {
      const detail = await http.get(
        `/api/v1/prescriptions/${historyResult.firstId}`,
        accessToken
      );
      assertHistoryDetailResponse(detail, historyResult.firstId);
      pass(dependencies, "Prescription history detail", detail.status);
      passed += 1;
    } else {
      dependencies.output(
        "[SKIP] Prescription history detail NO_EXISTING_RECORD"
      );
    }

    const invalidPrescriptionId = await http.get(
      "/api/v1/prescriptions/not-a-uuid",
      accessToken
    );
    assertExactError(
      "Invalid prescription ID",
      invalidPrescriptionId,
      400,
      "INVALID_PRESCRIPTION_ID"
    );
    pass(dependencies, "Invalid prescription ID", invalidPrescriptionId.status);
    passed += 1;

    const unknownPrescription = await http.get(
      `/api/v1/prescriptions/${randomUUID()}`,
      accessToken
    );
    assertExactError(
      "Unknown prescription",
      unknownPrescription,
      404,
      "PRESCRIPTION_NOT_FOUND"
    );
    pass(dependencies, "Unknown prescription", unknownPrescription.status);
    passed += 1;

    const cabinet = await http.get(
      "/api/v1/medicine-cabinet?limit=20&offset=0",
      accessToken
    );
    const cabinetResult = assertCabinetListResponse(cabinet);
    passCabinetRead(dependencies, cabinet.status, cabinetResult.reason);
    passed += 1;

    if (cabinetResult.firstId) {
      const detail = await http.get(
        `/api/v1/medicine-cabinet/${cabinetResult.firstId}`,
        accessToken
      );
      assertCabinetDetailResponse(detail, cabinetResult.firstId);
      pass(dependencies, "Medicine cabinet detail", detail.status);
      passed += 1;
    } else {
      dependencies.output("[SKIP] Medicine cabinet detail NO_EXISTING_RECORD");
    }

    const invalidCabinetId = await http.get(
      "/api/v1/medicine-cabinet/not-a-uuid",
      accessToken
    );
    assertExactError(
      "Invalid medicine cabinet entry ID",
      invalidCabinetId,
      400,
      "INVALID_MEDICINE_CABINET_ENTRY_ID"
    );
    pass(dependencies, "Invalid medicine cabinet entry ID", invalidCabinetId.status);
    passed += 1;

    const unknownCabinetEntry = await http.get(
      `/api/v1/medicine-cabinet/${randomUUID()}`,
      accessToken
    );
    assertExactError(
      "Unknown medicine cabinet entry",
      unknownCabinetEntry,
      404,
      "MEDICINE_CABINET_ENTRY_NOT_FOUND"
    );
    pass(dependencies, "Unknown medicine cabinet entry", unknownCabinetEntry.status);
    passed += 1;

    const familyMembers = await http.get(
      "/api/v1/family-members?limit=20&offset=0",
      accessToken
    );
    const familyMemberResult = assertFamilyMemberListResponse(familyMembers);
    passFamilyMemberRead(
      dependencies,
      familyMembers.status,
      familyMemberResult.reason
    );
    passed += 1;

    if (familyMemberResult.firstId) {
      const detail = await http.get(
        `/api/v1/family-members/${familyMemberResult.firstId}`,
        accessToken
      );
      assertFamilyMemberDetailResponse(detail, familyMemberResult.firstId);
      pass(dependencies, "Family member detail", detail.status);
      passed += 1;
    } else {
      dependencies.output("[SKIP] Family member detail NO_EXISTING_RECORD");
    }

    const invalidFamilyMemberId = await http.get(
      "/api/v1/family-members/not-a-uuid",
      accessToken
    );
    assertExactError(
      "Invalid family member ID",
      invalidFamilyMemberId,
      400,
      "INVALID_FAMILY_MEMBER_ID"
    );
    pass(dependencies, "Invalid family member ID", invalidFamilyMemberId.status);
    passed += 1;

    const unknownFamilyMember = await http.get(
      `/api/v1/family-members/${randomUUID()}`,
      accessToken
    );
    accessToken = "";
    assertExactError(
      "Unknown family member",
      unknownFamilyMember,
      404,
      "FAMILY_MEMBER_NOT_FOUND"
    );
    pass(dependencies, "Unknown family member", unknownFamilyMember.status);
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
