import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("isolated runner requires approval, a fixed new target and an empty-database guard", async () => {
  const script = await readFile("scripts/worker-isolated-sql-test.ps1", "utf8");
  assert.match(script, /if \(-not \$ApproveSyntheticWrites\)/);
  assert.match(script, /meddecode_worker_claim_20261113/);
  assert.match(script, /meddecode_worker_final_20261113/);
  assert.match(script, /current_database\(\)=:'expected_database'/);
  assert.match(script, /inet_server_addr\(\)='127\.0\.0\.1'::inet/);
  assert.match(script, /pg_stat_activity/);
  assert.match(script, /pg_auth_members/);
  assert.match(script, /Synthetic bootstrap is unsafe or incompatible/);
  assert.doesNotMatch(script, /'-d','meddecode_job_test'|'-d','meddecode_worker_test'/);
  assert.doesNotMatch(script, /CREATE DATABASE|DROP DATABASE/i);
  const fixture = await readFile("scripts/worker-synthetic-bootstrap.sql", "utf8");
  assert.match(fixture, /CREATE TABLE public\.users/);
  assert.doesNotMatch(fixture, /\bDROP\b|\bTRUNCATE\b|CREATE\s+ROLE|ALTER\s+ROLE/i);
});
