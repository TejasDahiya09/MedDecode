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
  MedicineCabinetItem,
  MedicineCabinetPage,
  MedicineCabinetRow
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

export function createMedicineCabinetRouter(
  verifier: AuthVerifier,
  userClientFactory: UserSupabaseClientFactory = createUserSupabaseClient,
  repository: MedicineCabinetRepository = supabaseMedicineCabinetRepository
): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(verifier, userClientFactory);

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

  return router;
}
