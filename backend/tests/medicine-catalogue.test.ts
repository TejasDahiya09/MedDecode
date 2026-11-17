import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import {
  createMedicineCatalogueRouter,
  userMedicineCatalogueRepository,
  type MedicineCatalogueRepository,
} from "../src/routes/medicine-catalogue.routes.js";
import { errorHandler } from "../src/middleware/error.middleware.js";
import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import { parseMedicineCatalogueDefaultSource } from "../src/config/env.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
test("browse migration preserves tested RPC body and checks temporary privileges", async () => {
  const root = join(process.cwd(), "database");
  const draft = await readFile(join(root, "official_catalogue_browse_v2_review.sql"), "utf8");
  const base = join(root, "integration-migrations", "202611130006_official_catalogue_browse");
  const up = await readFile(join(base, "002_up.sql"), "utf8");
  const pre = await readFile(join(base, "001_preflight.sql"), "utf8");
  const verify = await readFile(join(base, "003_verify.sql"), "utf8");
  const body = (s: string) => s.match(/CREATE FUNCTION public\.meddecode_official_catalogue_browse_v2[\s\S]*?END \$function\$;/)?.[0];
  assert.ok(body(draft)); assert.equal(body(draft), body(up));
  for (const sql of [pre, verify]) {
    assert.match(sql, /has_schema_privilege\('meddecode_catalogue_rpc_owner','public','CREATE'\)/);
    assert.match(sql, /has_table_privilege\('authenticated','official_catalogue\.formulations','SELECT'\)/);
    assert.match(sql, /pg_auth_members/);
  }
});
test("official paginated search applies server-side page and dosage-form filters", async () => {
  const calls: unknown[] = [];
  const paged: MedicineCatalogueRepository = {
    ...repository,
    async searchPage(_client, term, limit, offset, form) {
      calls.push({ term, limit, offset, form });
      return { items: [{ id: a, canonical_name: "PARACETAMOL TABLET" }], total: 49 };
    },
  };
  const response = await request(app(true, paged))
    .get("/api/v1/medicines?q=paracetamol&limit=24&offset=24&form=Tablet&source=official_catalogue")
    .set("Authorization", "Bearer ok");
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ term: "paracetamol", limit: 24, offset: 24, form: "Tablet" }]);
  assert.equal(response.body.pagination.total, 49);
  assert.equal(response.body.pagination.has_more, true);
  assert.equal((await request(app(true, paged))
    .get("/api/v1/medicines?q=paracetamol&form=Unknown&source=official_catalogue")
    .set("Authorization", "Bearer ok")).status, 400);
});
const verifier = { async verifyAccessToken(token: string) { if (token !== "ok") throw new Error(); return { userId: a }; } };
const factory = () => ({} as UserSupabaseClient);
const repository = {
  async search(_client: UserSupabaseClient, term: string) { return term === "para" ? [{ id: a }, { id: b }] : []; },
  async detail(_client: UserSupabaseClient, id: string) { return id === a || id === b ? { id, dosage_form: null } : null; },
};
function app(
  enabled: boolean,
  catalogueRepository: MedicineCatalogueRepository = repository,
  defaultSource: "legacy" | "official_catalogue" = "legacy",
) {
  const instance = express();
  instance.use(createMedicineCatalogueRouter(
    verifier, factory, catalogueRepository, enabled, defaultSource
  ));
  instance.use(errorHandler);
  return instance;
}
test("catalogue routes require authentication and remain disabled unless configured", async () => {
  assert.equal((await request(app(false)).get("/api/v1/medicines?q=para")).status, 401);
  assert.equal((await request(app(false)).get("/api/v1/medicines?q=para").set("Authorization", "Bearer ok")).status, 503);
});
test("search bounds query and preserves separate results", async () => {
  const server = app(true);
  const response = await request(server).get("/api/v1/medicines?q=PARA&limit=1").set("Authorization", "Bearer ok");
  assert.equal(response.status, 200);
  assert.equal(response.body.items.length, 1);
  assert.equal(response.body.pagination.has_more, true);
  assert.equal((await request(server).get("/api/v1/medicines?q=%25").set("Authorization", "Bearer ok")).status, 400);
});
test("browse is authenticated, bounded, source-aware and paginated", async () => {
  const calls: unknown[] = [];
  const browsing: MedicineCatalogueRepository = { ...repository,
    async browse(_client, limit, offset, form) { calls.push({ limit, offset, form }); return { items: [{ id: offset === 0 ? a : b }], total: 2 }; },
  };
  const server = app(true, browsing);
  assert.equal((await request(server).get('/api/v1/medicines/browse')).status, 401);
  const first = await request(server).get('/api/v1/medicines/browse?limit=1&form=Tablet').set('Authorization', 'Bearer ok');
  const second = await request(server).get('/api/v1/medicines/browse?limit=1&offset=1&form=Tablet').set('Authorization', 'Bearer ok');
  assert.equal(first.status, 200); assert.equal(first.body.items[0].id, a); assert.equal(first.body.pagination.total, 2);
  assert.equal(first.body.pagination.has_more, true); assert.equal(second.body.items[0].id, b); assert.equal(second.body.pagination.has_more, false);
  assert.deepEqual(calls, [{ limit: 1, offset: 0, form: 'Tablet' }, { limit: 1, offset: 1, form: 'Tablet' }]);
  for (const q of ['?limit=51', '?offset=10001', '?form=%25', '?source=legacy'])
    assert.equal((await request(server).get(`/api/v1/medicines/browse${q}`).set('Authorization', 'Bearer ok')).status, 400);
});
test("missing browse RPC is a service failure, not an empty catalogue", async () => {
  const bad = { rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) } as unknown as UserSupabaseClient;
  const server = express(); server.use(createMedicineCatalogueRouter(verifier, () => bad, userMedicineCatalogueRepository, true)); server.use(errorHandler);
  assert.equal((await request(server).get('/api/v1/medicines/browse').set('Authorization', 'Bearer ok')).status, 503);
});
test("successful no-match searches remain distinct from sanitized catalogue failures", async () => {
  const empty = await request(app(true)).get("/api/v1/medicines?q=nomatch&source=official_catalogue")
    .set("Authorization", "Bearer ok");
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.items, []);
  const unavailable: MedicineCatalogueRepository = {
    async search() { throw new Error("private provider detail"); },
    async detail() { throw new Error("private provider detail"); },
  };
  const failure = await request(app(true, unavailable)).get("/api/v1/medicines?q=para&source=official_catalogue")
    .set("Authorization", "Bearer ok");
  assert.equal(failure.status, 500);
  assert.equal(failure.body.error.code, "INTERNAL_SERVER_ERROR");
  assert.doesNotMatch(JSON.stringify(failure.body), /private provider detail/);
});
test("detail and comparison reject invalid, duplicate and missing identifiers", async () => {
  const server = app(true), auth = "Bearer ok";
  assert.equal((await request(server).get(`/api/v1/medicines/${a}`).set("Authorization", auth)).status, 200);
  assert.equal((await request(server).get("/api/v1/medicines/not-a-uuid").set("Authorization", auth)).status, 400);
  assert.equal((await request(server).get(`/api/v1/medicines/compare?a=${a}&b=${a}`).set("Authorization", auth)).status, 400);
  const result = await request(server).get(`/api/v1/medicines/compare?a=${a}&b=${b}`).set("Authorization", auth);
  assert.equal(result.status, 200);
  assert.equal(result.body.clinical_equivalence, null);
});

test("repository invokes only restricted RPC and propagates permission errors", async () => {
  const calls: { name: string; params: Record<string, unknown> }[] = [];
  const client = {
    rpc(name: string, params: Record<string, unknown>) {
      calls.push({ name, params });
      return Promise.resolve({ data: [{ id: a }, { id: b }], error: null });
    },
  } as unknown as UserSupabaseClient;
  const result = await userMedicineCatalogueRepository.search(client, "test", 10, 0);
  assert.deepEqual(result.map(row => (row as { id: string }).id), [a, b]);
  const officialResult = await userMedicineCatalogueRepository.search(client, "test", 10, 0, "official_catalogue");
  assert.deepEqual(officialResult.map(row => (row as { id: string }).id), [a, b]);
  await userMedicineCatalogueRepository.detail(client, a);
  await userMedicineCatalogueRepository.detail(client, a, "official_catalogue");
  assert.deepEqual(calls, [
    { name: "meddecode_catalogue_search_v1", params: { p_query: "test", p_limit: 11, p_offset: 0 } },
    { name: "meddecode_official_catalogue_search_v1", params: { p_query: "test", p_limit: 11, p_offset: 0 } },
    { name: "meddecode_catalogue_detail_v1", params: { p_id: a } },
    { name: "meddecode_official_catalogue_detail_v1", params: { p_id: a } },
  ]);
  const denied = { rpc() { throw new Error("permission denied"); } } as unknown as UserSupabaseClient;
  await assert.rejects(userMedicineCatalogueRepository.search(denied, "test", 10, 0));
});

test("official browse and search pages use the same restricted RPC", async () => {
  const calls: { name: string; params: Record<string, unknown> }[] = [];
  const client = {
    rpc(name: string, params: Record<string, unknown>) {
      calls.push({ name, params });
      return Promise.resolve({ data: { items: [{ id: a }], total: 25 }, error: null });
    },
  } as unknown as UserSupabaseClient;
  const browsePage = await userMedicineCatalogueRepository.browse?.(client, 24, 24, "Tablet");
  const searchPage = await userMedicineCatalogueRepository.searchPage?.(client, "para", 24, 48, null);
  assert.equal(browsePage?.total, 25);
  assert.equal(searchPage?.items.length, 1);
  assert.deepEqual(calls, [
    {
      name: "meddecode_official_catalogue_page_v1",
      params: { p_query: null, p_form: "Tablet", p_limit: 24, p_offset: 24 },
    },
    {
      name: "meddecode_official_catalogue_page_v1",
      params: { p_query: "para", p_form: null, p_limit: 24, p_offset: 48 },
    },
  ]);
});

test("RPC failures produce a sanitized unavailable response, not an empty success", async () => {
  const bad = { rpc: async () => ({ data: null, error: { code: "42501", message: "private upstream detail" } }) } as unknown as UserSupabaseClient;
  const server = express();
  server.use(createMedicineCatalogueRouter(verifier, () => bad, userMedicineCatalogueRepository, true));
  server.use(errorHandler);
  const response = await request(server).get("/api/v1/medicines?q=para&source=official_catalogue").set("Authorization", "Bearer ok");
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "CATALOGUE_READ_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(response.body), /private upstream detail/);
});

test("official source is explicit for search, detail, and comparison while legacy remains the default", async () => {
  const calls: { method: string; source?: string }[] = [];
  const sourceAwareRepository: MedicineCatalogueRepository = {
    async search(_client, _term, _limit, _offset, source = "legacy") {
      calls.push({ method: "search", source });
      return [{ id: a, catalogue_source: source }];
    },
    async detail(_client, id, source = "legacy") {
      calls.push({ method: `detail:${id}`, source });
      return { id, catalogue_source: source };
    },
  };
  const server = app(true, sourceAwareRepository);
  const auth = "Bearer ok";

  assert.equal((await request(server).get("/api/v1/medicines?q=fixture").set("Authorization", auth)).status, 200);
  const officialSearch = await request(server).get("/api/v1/medicines?q=fixture&source=official_catalogue").set("Authorization", auth);
  assert.equal(officialSearch.status, 200);
  assert.equal(officialSearch.body.items[0].catalogue_source, "official_catalogue");
  const officialDetail = await request(server).get(`/api/v1/medicines/${a}?source=official_catalogue`).set("Authorization", auth);
  assert.equal(officialDetail.status, 200);
  assert.equal(officialDetail.body.medicine.catalogue_source, "official_catalogue");
  const officialCompare = await request(server).get(`/api/v1/medicines/compare?a=${a}&b=${b}&source=official_catalogue`).set("Authorization", auth);
  assert.equal(officialCompare.status, 200);
  assert.equal(officialCompare.body.medicines[0].catalogue_source, "official_catalogue");
  assert.equal((await request(server).get("/api/v1/medicines?q=fixture&source=unknown").set("Authorization", auth)).status, 400);

  assert.deepEqual(calls, [
    { method: "search", source: "legacy" },
    { method: "search", source: "official_catalogue" },
    { method: `detail:${a}`, source: "official_catalogue" },
    { method: `detail:${a}`, source: "official_catalogue" },
    { method: `detail:${b}`, source: "official_catalogue" },
  ]);
});

test("configured official default can be overridden explicitly to legacy", async () => {
  const calls: string[] = [];
  const sourceAwareRepository: MedicineCatalogueRepository = {
    async search(_client, _term, _limit, _offset, source = "legacy") {
      calls.push(source);
      return [{ id: a, catalogue_source: source }];
    },
    async detail(_client, id, source = "legacy") {
      calls.push(source);
      return { id, catalogue_source: source };
    },
  };
  const server = app(true, sourceAwareRepository, "official_catalogue");
  const auth = "Bearer ok";

  const official = await request(server).get("/api/v1/medicines?q=fixture").set("Authorization", auth);
  const legacy = await request(server).get("/api/v1/medicines?q=fixture&source=legacy").set("Authorization", auth);
  assert.equal(official.body.items[0].catalogue_source, "official_catalogue");
  assert.equal(legacy.body.items[0].catalogue_source, "legacy");
  assert.deepEqual(calls, ["official_catalogue", "legacy"]);
});

test("medicine catalogue default-source configuration is strict and legacy-safe", () => {
  assert.equal(parseMedicineCatalogueDefaultSource(undefined), "legacy");
  assert.equal(parseMedicineCatalogueDefaultSource(""), "legacy");
  assert.equal(parseMedicineCatalogueDefaultSource("legacy"), "legacy");
  assert.equal(parseMedicineCatalogueDefaultSource("official_catalogue"), "official_catalogue");
  assert.throws(() => parseMedicineCatalogueDefaultSource("unknown"));
});

test("migration confines reference output and revokes anonymous function execution", async () => {
  const sql = await readFile(join(process.cwd(), "database/integration-migrations/202611130003_restricted_medicine_catalogue/002_up.sql"), "utf8");
  assert.match(sql, /SECURITY DEFINER SET search_path = ''/);
  assert.match(sql, /auth\.uid\(\) IS NULL/);
  assert.match(sql, /FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
  assert.doesNotMatch(sql, /source_url|source_record_hash|image_url|prescriptions|patient/i);
  assert.doesNotMatch(sql, /CREATE POLICY|GRANT SELECT ON/i);
  assert.match(sql, /ingredient_strength_value/);
});

test("official catalogue migration uses a separate RPC namespace and never maps legacy IDs", async () => {
  const migrationDirectory = "database/integration-migrations/202611130004_official_catalogue_read_rpc";
  const sql = await readFile(join(process.cwd(), "database/integration-migrations/202611130004_official_catalogue_read_rpc/002_up.sql"), "utf8");
  const preflight = await readFile(join(process.cwd(), migrationDirectory, "001_preflight.sql"), "utf8");
  const verify = await readFile(join(process.cwd(), migrationDirectory, "003_verify.sql"), "utf8");
  assert.match(sql, /meddecode_official_catalogue_search_v1/);
  assert.match(sql, /meddecode_official_catalogue_detail_v1/);
  assert.match(sql, /official_catalogue\.formulations/);
  assert.match(sql, /official_catalogue\.catalogue_entities/);
  assert.match(sql, /'official_catalogue\.formulation_id'/);
  assert.match(sql, /'prices',\s*'\[\]'::jsonb/);
  assert.match(sql, /SET search_path = ''/);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(sql, /GRANT (USAGE ON SCHEMA auth|EXECUTE ON FUNCTION auth\.uid\(\))/i);
  assert.match(sql, /CREATE FUNCTION public\.meddecode_catalogue_request_uid\(\)/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.meddecode_catalogue_request_uid\(\) FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.meddecode_catalogue_request_uid\(\)\s+TO meddecode_catalogue_rpc_owner/i);
  assert.match(sql, /restricted RPC owner auth dependency is not isolated through the locked-down wrapper/i);
  assert.match(sql, /GRANT meddecode_catalogue_rpc_owner TO CURRENT_USER\s+WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER/i);
  assert.match(sql, /REVOKE meddecode_catalogue_rpc_owner FROM CURRENT_USER GRANTED BY CURRENT_USER/i);
  const roleReset = sql.indexOf("RESET ROLE;");
  const ownerGrant = sql.indexOf("GRANT EXECUTE ON FUNCTION public.meddecode_official_catalogue_detail_v1(uuid)");
  assert.ok(ownerGrant >= 0 && ownerGrant < roleReset, "RPC grants must be applied by their owner before RESET ROLE");
  assert.match(verify, /grantor = 10[\s\S]*admin_option AND NOT inherit_option AND NOT set_option/i);
  assert.doesNotMatch(sql, /public\.medicines|public\.medicine_prices|original_payload|acquisition_url/i);
  assert.match(preflight, /relrowsecurity OR c\.relforcerowsecurity/);
  assert.match(verify, /relrowsecurity OR c\.relforcerowsecurity/);
});

test("official page RPC migration matches its review draft and preserves restricted access", async () => {
  const root = join(process.cwd(), "database");
  const draft = await readFile(join(root, "official_catalogue_page_v1_review.sql"), "utf8");
  const base = join(root, "integration-migrations", "202611160007_official_catalogue_page_v1");
  const up = await readFile(join(base, "002_up.sql"), "utf8");
  const preflight = await readFile(join(base, "001_preflight.sql"), "utf8");
  const verify = await readFile(join(base, "003_verify.sql"), "utf8");
  const behavior = await readFile(join(base, "test", "20_behavior.sql"), "utf8");
  const unauthorized = await readFile(join(base, "test", "30_unauthorized.sql"), "utf8");
  const body = (sql: string) => sql.match(/CREATE FUNCTION public\.meddecode_official_catalogue_page_v1[\s\S]*?END\s*\$function\$;/)?.[0];
  assert.ok(body(draft));
  assert.equal(body(draft), body(up));
  for (const sql of [draft, up]) {
    assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
    assert.match(sql, /public\.meddecode_catalogue_request_uid\(\) IS NULL/);
    assert.match(sql, /official_catalogue\.formulation_ingredients/);
    assert.match(sql, /official_catalogue\.ingredients/);
    assert.match(sql, /official_catalogue\.releases/);
    assert.match(sql, /trim_scale\(fi\.strength_value\)/);
    assert.match(sql, /p_form IS NULL/);
    for (const form of ["Tablet", "Capsule", "Syrup", "Injection", "Ointment", "Drops"])
      assert.match(sql, new RegExp(`WHEN '${form}' THEN`));
    assert.match(sql, /p_limit NOT BETWEEN 1 AND 50/);
    assert.match(sql, /p_offset NOT BETWEEN 0 AND 10000/);
    assert.match(sql, /ORDER BY matching\.canonical_name COLLATE "C", matching\.id/);
    for (const field of ["normalized_name", "canonical_name", "generic_name", "brand_name", "dosage_form", "display_name"])
      assert.match(sql, new RegExp(`evidence->>'${field}'|i\\.${field}`));
    assert.match(sql, /'official_catalogue\.formulation_id'/);
    assert.match(sql, /'total', \(SELECT count\(\*\) FROM matching\)/);
    assert.match(sql, /FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /TO authenticated/);
  }
  assert.match(preflight, /BEGIN READ ONLY/);
  assert.match(preflight, /has_column_privilege/);
  assert.match(preflight, /pg_catalog\.trim_scale\(numeric\)/);
  assert.match(preflight, /NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls/);
  assert.match(preflight, /relrowsecurity OR c\.relforcerowsecurity/);
  assert.match(up, /SET LOCAL ROLE meddecode_catalogue_rpc_owner/);
  assert.match(up, /REVOKE CREATE ON SCHEMA public FROM meddecode_catalogue_rpc_owner/);
  assert.doesNotMatch(up, /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|DROP|ALTER)\b/im);
  assert.match(verify, /proowner = 'meddecode_catalogue_rpc_owner'::regrole/);
  assert.match(verify, /has_function_privilege\('authenticated', f, 'EXECUTE'\)/);
  assert.match(verify, /has_function_privilege\('anon', f, 'EXECUTE'\)/);
  assert.match(verify, /proconfig @> ARRAY\['search_path=""'\]/);
  assert.match(verify, /retained temporary CREATE privilege/);
  assert.match(verify, /catalogue auth wrapper ownership, search_path, or EXECUTE ACL is invalid/);
  assert.match(verify, /RLS state changed from the verified RPC baseline/);
  assert.match(behavior, /BEGIN READ ONLY/);
  assert.match(behavior, /stable ordering, or distinct rows/);
  assert.match(behavior, /brand search/);
  assert.match(behavior, /ingredient search/);
  assert.match(behavior, /strength search/);
  assert.match(behavior, /dosage-form search/);
  assert.match(unauthorized, /SET LOCAL ROLE anon/);
  assert.match(unauthorized, /anon unexpectedly executed/);
});
