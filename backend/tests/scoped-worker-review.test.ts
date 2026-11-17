import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

test('review candidate scopes claim, heartbeat, finalization and recovery to registered lineage', async () => {
  const sql = await readFile(join(process.cwd(), 'database/scoped-worker-isolation-review.sql'), 'utf8');
  assert.match(sql, /REVIEW ONLY\. NOT TESTED OR APPROVED/);
  assert.match(sql, /scope\.user_id = j\.user_id/);
  assert.match(sql, /scope\.worker_login = session_user/);
  assert.match(sql, /scope\.worker_instance_id = j\.lease_owner/);
  assert.match(sql, /FOR UPDATE OF j, scope SKIP LOCKED/);
  assert.equal((sql.match(/scoped worker authorization required/g) ?? []).length, 7);
  assert.match(sql, /v_existing_found := FOUND/);
  assert.match(sql, /scope.expires_at > clock_timestamp\(\)[\s\S]*?CONTINUE/);
  assert.equal((sql.match(/scoped_job\.user_id = scope\.user_id/g) ?? []).length, 3);
  assert.equal((sql.match(/TO meddecode_scoped_worker;/g) ?? []).length, 5);
  assert.doesNotMatch(sql, /GRANT\s+meddecode_worker\s+TO/i);
  assert.match(sql, /REVOKE ALL ON public\.meddecode_scoped_worker_scope FROM PUBLIC, anon, authenticated, meddecode_worker, meddecode_scoped_worker/);
});
