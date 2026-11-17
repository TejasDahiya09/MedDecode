import { Router, type Request } from "express";

import {
  createUserSupabaseClient,
  type UserSupabaseClientFactory
} from "../config/supabase-user.js";
import {
  createAuthenticateMiddleware,
  requireAuthenticatedIdentity
} from "../middleware/authenticate.middleware.js";
import { AppError } from "../middleware/error.middleware.js";
import {
  supabaseMedicineCabinetRepository,
  type MedicineCabinetRepository
} from "../repositories/medicine-cabinet.repository.js";
import type { AuthVerifier } from "../services/auth.service.js";
import type {
  MedicineCabinetDetailResponse,
  MedicineCabinetCreate,
  MedicineCabinetItem,
  MedicineCabinetPage,
  MedicineCabinetRow
  , MedicineCabinetUpdate
} from "../types/medicine-cabinet.js";

const DEFAULT_LIMIT = 20;
const MAXIMUM_LIMIT = 50;
const MAXIMUM_OFFSET = 1_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;

function invalidQuery(message: string): AppError {
  return new AppError(400, "INVALID_MEDICINE_CABINET_QUERY", message);
}

function parseUnsignedQueryValue(
  value: unknown,
  name: "limit" | "offset",
  fallback: number,
  maximum: number
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw invalidQuery(`${name} must be a non-negative integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum ||
    (name === "limit" && parsed < 1)) {
    throw invalidQuery(
      name === "limit"
        ? `limit must be between 1 and ${MAXIMUM_LIMIT}.`
        : `offset must be between 0 and ${MAXIMUM_OFFSET}.`
    );
  }
  return parsed;
}

function paginationFromRequest(request: Request) {
  if (Object.keys(request.query).some(
    (key) => key !== "limit" && key !== "offset"
  )) {
    throw invalidQuery("Query contains an unexpected parameter.");
  }
  return {
    limit: parseUnsignedQueryValue(
      request.query.limit,
      "limit",
      DEFAULT_LIMIT,
      MAXIMUM_LIMIT
    ),
    offset: parseUnsignedQueryValue(
      request.query.offset,
      "offset",
      0,
      MAXIMUM_OFFSET
    )
  } as const;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("Medicine cabinet row contains invalid metadata.");
  }
  return value;
}

function serializedQuantity(value: number | string | null): string | null {
  if (value === null) return null;
  if (typeof value === "number") {
    // Fractional JS numbers may already have lost PostgreSQL numeric precision.
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Medicine cabinet row contains an unsafe quantity.");
    }
    return String(value);
  }
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error("Medicine cabinet row contains an invalid quantity.");
  }
  return value;
}

function publicCabinetItem(
  row: MedicineCabinetRow,
  expectedUserId: string
): MedicineCabinetItem {
  if (
    row.user_id !== expectedUserId ||
    typeof row.id !== "string" ||
    !UUID_PATTERN.test(row.id) ||
    typeof row.medicine_id !== "string" ||
    !UUID_PATTERN.test(row.medicine_id) ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    throw new Error("Medicine cabinet row failed validation.");
  }
  return {
    id: row.id,
    medicine_id: row.medicine_id,
    ...(row.family_member_id === undefined ? {} : { family_member_id: nullableString(row.family_member_id) }),
    quantity: serializedQuantity(row.quantity),
    purchase_date: nullableString(row.purchase_date),
    expiry_date: nullableString(row.expiry_date),
    refill_date: nullableString(row.refill_date),
    usage_information: nullableString(row.usage_information),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function requireUserClient(request: Express.Request) {
  if (!request.userSupabase) {
    throw new Error("Authenticated user client is unavailable.");
  }
  return request.userSupabase;
}

function notFound(): AppError {
  return new AppError(
    404,
    "MEDICINE_CABINET_ENTRY_NOT_FOUND",
    "Medicine cabinet entry not found."
  );
}

function parseUpdate(body: unknown): MedicineCabinetUpdate {
  const allowed = ["quantity", "purchase_date", "expiry_date", "refill_date", "usage_information"];
  if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).length ||
      Object.keys(body).some(key => !allowed.includes(key))) {
    throw new AppError(400, "INVALID_CABINET_ENTRY", "Invalid cabinet entry.");
  }
  const input = body as Record<string, unknown>;
  for (const field of ["purchase_date", "expiry_date", "refill_date"]) {
    const value = input[field];
    if (value !== undefined && value !== null && (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) {
      throw new AppError(400, "INVALID_CABINET_ENTRY", "Dates must be valid ISO dates.");
    }
  }
  if (input.quantity != null && (typeof input.quantity !== "string" || input.quantity.length > 30 || !DECIMAL_PATTERN.test(input.quantity)))
    throw new AppError(400, "INVALID_CABINET_ENTRY", "Quantity must be a non-negative decimal string.");
  if (input.usage_information != null && (typeof input.usage_information !== "string" || input.usage_information.length > 2000))
    throw new AppError(400, "INVALID_CABINET_ENTRY", "Usage information is invalid.");
  return input as MedicineCabinetUpdate;
}

export function createMedicineCabinetRouter(
  verifier: AuthVerifier,
  userClientFactory: UserSupabaseClientFactory = createUserSupabaseClient,
  repository: MedicineCabinetRepository = supabaseMedicineCabinetRepository
): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(verifier, userClientFactory);

  router.post("/api/v1/medicine-cabinet", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    const body: unknown = request.body;
    const allowed = ["medicine_id", "family_member_id", "quantity", "purchase_date", "expiry_date", "refill_date", "usage_information"];
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
      throw new AppError(400, "INVALID_CABINET_ENTRY", "Invalid cabinet entry.");
    }
    const value = body as Record<string, unknown>;
    if (typeof value.medicine_id !== "string" || !UUID_PATTERN.test(value.medicine_id) ||
        (value.family_member_id != null && (typeof value.family_member_id !== "string" || !UUID_PATTERN.test(value.family_member_id)))) {
      throw new AppError(400, "INVALID_CABINET_ENTRY", "Valid medicine and family member IDs are required.");
    }
    const date = (field: string): string | null => {
      const input = value[field];
      if (input == null) return null;
      if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input) || Number.isNaN(Date.parse(`${input}T00:00:00Z`)) || new Date(`${input}T00:00:00Z`).toISOString().slice(0, 10) !== input)
        throw new AppError(400, "INVALID_CABINET_ENTRY", "Dates must be valid ISO dates.");
      return input;
    };
    const quantity = value.quantity;
    if (quantity != null && (typeof quantity !== "string" || quantity.length > 30 || !DECIMAL_PATTERN.test(quantity)))
      throw new AppError(400, "INVALID_CABINET_ENTRY", "Quantity must be a non-negative decimal string.");
    const usage = value.usage_information;
    if (usage != null && (typeof usage !== "string" || usage.length > 2000))
      throw new AppError(400, "INVALID_CABINET_ENTRY", "Usage information is invalid.");
    const input: MedicineCabinetCreate = {
      medicine_id: value.medicine_id, family_member_id: (value.family_member_id as string | null | undefined) ?? null,
      quantity: (quantity as string | null | undefined) ?? null, purchase_date: date("purchase_date"),
      expiry_date: date("expiry_date"), refill_date: date("refill_date"), usage_information: (usage as string | null | undefined) ?? null,
    };
    if (!repository.medicineExists || !repository.familyOwned || !repository.createOwned)
      throw new AppError(503, "SERVICE_UNAVAILABLE", "Cabinet creation is unavailable.");
    const client = requireUserClient(request);
    if (!await repository.medicineExists(client, input.medicine_id))
      throw new AppError(404, "MEDICINE_NOT_FOUND", "Medicine not found.");
    if (input.family_member_id && !await repository.familyOwned(client, identity.userId, input.family_member_id))
      throw new AppError(404, "FAMILY_MEMBER_NOT_FOUND", "Family member not found.");
    const created = await repository.createOwned(client, identity.userId, input);
    if (created.medicine_id !== input.medicine_id || created.family_member_id !== input.family_member_id)
      throw new Error("Created cabinet entry failed validation.");
    response.status(201).json({ entry: publicCabinetItem(created, identity.userId) });
  });

  router.get("/api/v1/medicine-cabinet", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    const pagination = paginationFromRequest(request);
    const rows = await repository.listOwned(
      requireUserClient(request),
      identity.userId,
      pagination
    );
    const hasMore = rows.length > pagination.limit;
    const visibleRows = hasMore ? rows.slice(0, pagination.limit) : rows;
    const items = visibleRows.map((row) =>
      publicCabinetItem(row, identity.userId)
    );
    const body: MedicineCabinetPage = {
      items,
      pagination: {
        ...pagination,
        returned: items.length,
        has_more: hasMore,
        next_offset: hasMore ? pagination.offset + pagination.limit : null
      }
    };
    response.status(200).json(body);
  });

  router.get(
    "/api/v1/medicine-cabinet/:id",
    authenticate,
    async (request, response) => {
      const identity = requireAuthenticatedIdentity(request);
      const entryId = request.params.id;
      if (typeof entryId !== "string" || !UUID_PATTERN.test(entryId)) {
        throw new AppError(
          400,
          "INVALID_MEDICINE_CABINET_ENTRY_ID",
          "Medicine cabinet entry ID must be a valid UUID."
        );
      }
      const row = await repository.findOwnedDetail(
        requireUserClient(request),
        identity.userId,
        entryId
      );
      if (!row || row.user_id !== identity.userId) throw notFound();
      const body: MedicineCabinetDetailResponse = {
        entry: publicCabinetItem(row, identity.userId)
      };
      response.status(200).json(body);
    }
  );

  router.patch("/api/v1/medicine-cabinet/:id", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    const entryId = request.params.id;
    if (typeof entryId !== "string" || !UUID_PATTERN.test(entryId))
      throw new AppError(400, "INVALID_MEDICINE_CABINET_ENTRY_ID", "Medicine cabinet entry ID must be a valid UUID.");
    const input = parseUpdate(request.body);
    if (!repository.updateOwned) throw new AppError(503, "SERVICE_UNAVAILABLE", "Medicine cabinet editing is unavailable.");
    const row = await repository.updateOwned(requireUserClient(request), identity.userId, entryId, input);
    if (!row || row.user_id !== identity.userId || row.id !== entryId) throw notFound();
    response.status(200).json({ entry: publicCabinetItem(row, identity.userId) });
  });

  router.delete("/api/v1/medicine-cabinet/:id", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    const entryId = request.params.id;
    if (typeof entryId !== "string" || !UUID_PATTERN.test(entryId)) {
      throw new AppError(400, "INVALID_MEDICINE_CABINET_ENTRY_ID", "Medicine cabinet entry ID must be a valid UUID.");
    }
    if (!repository.deleteOwned) {
      throw new AppError(503, "SERVICE_UNAVAILABLE", "Medicine cabinet removal is unavailable.");
    }
    if (!await repository.deleteOwned(requireUserClient(request), identity.userId, entryId)) throw notFound();
    response.status(204).end();
  });

  return router;
}
