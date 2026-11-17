import { Router } from "express";
import { createUserSupabaseClient, type UserSupabaseClient, type UserSupabaseClientFactory } from "../config/supabase-user.js";
import { createAuthenticateMiddleware } from "../middleware/authenticate.middleware.js";
import { AppError } from "../middleware/error.middleware.js";
import type { AuthVerifier } from "../services/auth.service.js";
import type { MedicineCatalogueDefaultSource } from "../config/env.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type CatalogueRpc = { rpc(name: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

function catalogueUnavailable(error: unknown, stage: "search" | "detail" | "browse"): AppError {
  const rawCode = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code : undefined;
  const code = typeof rawCode === "string" && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(rawCode)
    ? rawCode : "UNAVAILABLE";
  console.warn(JSON.stringify({ level: "warn", event: "catalogue_rpc_failed", stage, code }));
  return new AppError(503, "CATALOGUE_READ_UNAVAILABLE", "Medicine catalogue is temporarily unavailable.");
}

export type CatalogueSource = "legacy" | "official_catalogue";

export interface MedicineCataloguePage {
  items: unknown[];
  total: number;
}

export interface MedicineCatalogueRepository {
  search(client: UserSupabaseClient, term: string, limit: number, offset: number, source?: CatalogueSource): Promise<unknown[]>;
  searchPage?(client: UserSupabaseClient, term: string, limit: number, offset: number, form: string | null): Promise<MedicineCataloguePage>;
  detail(client: UserSupabaseClient, id: string, source?: CatalogueSource): Promise<unknown | null>;
  browse?(client: UserSupabaseClient, limit: number, offset: number, form: string | null): Promise<MedicineCataloguePage>;
}

async function officialCataloguePage(
  client: UserSupabaseClient,
  query: string | null,
  limit: number,
  offset: number,
  form: string | null,
  stage: "search" | "browse",
): Promise<MedicineCataloguePage> {
  let result: { data: unknown; error: unknown };
  try {
    result = await (client as unknown as CatalogueRpc).rpc("meddecode_official_catalogue_page_v1", {
      p_query: query,
      p_form: form,
      p_limit: limit,
      p_offset: offset,
    });
  } catch (error) {
    throw catalogueUnavailable(error, stage);
  }
  const data = result.data;
  if (result.error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw catalogueUnavailable(result.error, stage);
  }
  const value = data as { items?: unknown; total?: unknown };
  if (!Array.isArray(value.items) || value.items.length > limit || !Number.isSafeInteger(value.total) || (value.total as number) < 0) {
    throw catalogueUnavailable(null, stage);
  }
  return { items: value.items, total: value.total as number };
}

export const userMedicineCatalogueRepository: MedicineCatalogueRepository = {
  async browse(client, limit, offset, form) {
    return officialCataloguePage(client, null, limit, offset, form, "browse");
  },
  async searchPage(client, term, limit, offset, form) {
    return officialCataloguePage(client, term, limit, offset, form, "search");
  },
  async search(client, term, limit, offset, source = "legacy") {
    const functionName = source === "official_catalogue"
      ? "meddecode_official_catalogue_search_v1"
      : "meddecode_catalogue_search_v1";
    let result: { data: unknown; error: unknown };
    try { result = await (client as unknown as CatalogueRpc).rpc(functionName, { p_query: term, p_limit: limit + 1, p_offset: offset }); }
    catch (error) { throw catalogueUnavailable(error, "search"); }
    if (result.error || !Array.isArray(result.data) || result.data.length > limit + 1) throw catalogueUnavailable(result.error, "search");
    return result.data;
  },
  async detail(client, id, source = "legacy") {
    const functionName = source === "official_catalogue"
      ? "meddecode_official_catalogue_detail_v1"
      : "meddecode_catalogue_detail_v1";
    let result: { data: unknown; error: unknown };
    try { result = await (client as unknown as CatalogueRpc).rpc(functionName, { p_id: id }); }
    catch (error) { throw catalogueUnavailable(error, "detail"); }
    if (result.error) throw catalogueUnavailable(result.error, "detail");
    return result.data;
  },
};

function parseCatalogueSource(
  value: unknown,
  defaultSource: CatalogueSource
): CatalogueSource | null {
  if (value === undefined) return defaultSource;
  if (value === "legacy") return "legacy";
  if (value === "official_catalogue") return "official_catalogue";
  return null;
}

export function createMedicineCatalogueRouter(
  verifier: AuthVerifier,
  factory: UserSupabaseClientFactory = createUserSupabaseClient,
  repository: MedicineCatalogueRepository = userMedicineCatalogueRepository,
  enabled = false,
  defaultSource: MedicineCatalogueDefaultSource = "legacy",
): Router {
  const router = Router();
  const auth = createAuthenticateMiddleware(verifier, factory);
  const clientFor = (request: Express.Request) => {
    if (!enabled) throw new AppError(503, "CATALOGUE_NOT_CONFIGURED", "Medicine catalogue is unavailable.");
    if (!request.userSupabase) throw new Error("User client unavailable");
    return request.userSupabase;
  };
  router.get("/api/v1/medicines/browse", auth, async (request, response) => {
    const rawLimit = request.query.limit ?? "24", rawOffset = request.query.offset ?? "0", rawForm = request.query.form;
    if (typeof rawLimit !== "string" || !/^[0-9]{1,2}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 50 ||
        typeof rawOffset !== "string" || !/^[0-9]{1,5}$/.test(rawOffset) || Number(rawOffset) > 10000 ||
        (rawForm !== undefined && (typeof rawForm !== "string" || !["Tablet", "Capsule", "Syrup", "Injection", "Ointment", "Drops"].includes(rawForm))) ||
        Object.keys(request.query).some(key => !["limit", "offset", "form"].includes(key)))
      throw new AppError(400, "INVALID_CATALOGUE_QUERY", "Invalid medicine browse query.");
    const client = clientFor(request);
    if (!repository.browse) throw catalogueUnavailable(null, "browse");
    const limit = Number(rawLimit), offset = Number(rawOffset);
    const result = await repository.browse(client, limit, offset, typeof rawForm === "string" ? rawForm : null);
    response.json({ items: result.items, pagination: { limit, offset, total: result.total, has_more: offset + result.items.length < result.total } });
  });
  router.get("/api/v1/medicines", auth, async (request, response) => {
    const term = request.query.q;
    const rawLimit = request.query.limit ?? "20";
    const rawOffset = request.query.offset ?? "0";
    const source = parseCatalogueSource(request.query.source, defaultSource);
    const rawForm = request.query.form;
    const form = typeof rawForm === "string" ? rawForm : null;
    const maxOffset = source === "official_catalogue" && repository.searchPage ? 10000 : 500;
    if (typeof term !== "string" || !/^[\p{L}\p{N} .+\-]{2,80}$/u.test(term.trim()) ||
        typeof rawLimit !== "string" || !/^[0-9]{1,2}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 50 ||
        typeof rawOffset !== "string" || !/^[0-9]{1,5}$/.test(rawOffset) || Number(rawOffset) > maxOffset ||
        source === null ||
        (rawForm !== undefined && (source !== "official_catalogue" || !["Tablet", "Capsule", "Syrup", "Injection", "Ointment", "Drops"].includes(form ?? ""))) ||
        Object.keys(request.query).some(key => !["q", "limit", "offset", "source", "form"].includes(key))) {
      throw new AppError(400, "INVALID_CATALOGUE_QUERY", "Invalid medicine search query.");
    }
    const limit = Number(rawLimit), offset = Number(rawOffset);
    const client = clientFor(request);
    if (source === "official_catalogue" && repository.searchPage) {
      const result = await repository.searchPage(client, term.trim().toLowerCase(), limit, offset, form);
      response.json({ items: result.items, pagination: { limit, offset, total: result.total, has_more: offset + result.items.length < result.total } });
      return;
    }
    const rows = await repository.search(client, term.trim().toLowerCase(), limit, offset, source);
    response.json({ items: rows.slice(0, limit), pagination: { limit, offset, has_more: rows.length > limit && offset + limit < 500 } });
  });
  router.get("/api/v1/medicines/compare", auth, async (request, response) => {
    const a = request.query.a, b = request.query.b;
    const source = parseCatalogueSource(request.query.source, defaultSource);
    if (typeof a !== "string" || typeof b !== "string" || !uuid.test(a) || !uuid.test(b) || a.toLowerCase() === b.toLowerCase() ||
        source === null || Object.keys(request.query).some(key => !["a", "b", "source"].includes(key))) {
      throw new AppError(400, "INVALID_MEDICINE_IDS", "Two different medicine UUIDs are required.");
    }
    const client = clientFor(request);
    const [first, second] = await Promise.all([repository.detail(client, a, source), repository.detail(client, b, source)]);
    if (!first || !second) throw new AppError(404, "MEDICINE_NOT_FOUND", "Medicine not found.");
    response.json({ medicines: [first, second], clinical_equivalence: null });
  });
  router.get("/api/v1/medicines/:id", auth, async (request, response) => {
    const id = request.params.id;
    const source = parseCatalogueSource(request.query.source, defaultSource);
    if (typeof id !== "string" || !uuid.test(id) || source === null ||
        Object.keys(request.query).some(key => key !== "source")) {
      throw new AppError(400, "INVALID_MEDICINE_ID", "A medicine UUID is required.");
    }
    const item = await repository.detail(clientFor(request), id, source);
    if (!item) throw new AppError(404, "MEDICINE_NOT_FOUND", "Medicine not found.");
    response.json({ medicine: item });
  });
  return router;
}
