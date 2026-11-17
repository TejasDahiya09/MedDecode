import assert from "node:assert/strict";
import test from "node:test";
import { parseCorsOrigin, validateSupabaseUrl } from "../src/config/env.js";

test("production requires an explicit origin and does not fall back to localhost", () => {
  assert.throws(() => parseCorsOrigin(undefined, "production"));
  assert.throws(() => parseCorsOrigin("", "production"));
  assert.equal(parseCorsOrigin(undefined, "development"), "http://127.0.0.1:5174");
  assert.equal(parseCorsOrigin("https://app.example.invalid", "production"), "https://app.example.invalid");
});

test("production Supabase URL requires HTTPS and cannot embed credentials", () => {
  assert.equal(validateSupabaseUrl("https://example.invalid", "production"), "https://example.invalid");
  assert.equal(validateSupabaseUrl("http://127.0.0.1:54321", "development"), "http://127.0.0.1:54321");
  for (const value of ["http://example.invalid", "https://user:password@example.invalid", "https://example.invalid?secret=value"]) {
    assert.throws(() => validateSupabaseUrl(value, "production"));
  }
});

test("rejects wildcard, credentials, paths and non-HTTP origins", () => {
  for (const value of ["*", "https://user:pass@example.invalid", "https://example.invalid/path", "file:///secret"]) {
    assert.throws(() => parseCorsOrigin(value, "production"));
  }
});
