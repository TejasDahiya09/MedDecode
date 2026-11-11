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
  supabasePrescriptionHistoryRepository,
  type PrescriptionHistoryRepository
} from "../repositories/prescription-history.repository.js";
import type { AuthVerifier } from "../services/auth.service.js";
import {
  PRESCRIPTION_FILE_TYPES,
  PRESCRIPTION_STATUSES,
  type PrescriptionDetailResponse,
  type PrescriptionHistoryItem,
  type PrescriptionHistoryPage,
  type PrescriptionHistoryRow
} from "../types/prescriptions.js";

const DEFAULT_LIMIT = 20;
const MAXIMUM_LIMIT = 50;
const MAXIMUM_OFFSET = 1_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidQuery(message: string): AppError {
  return new AppError(400, "INVALID_PRESCRIPTION_QUERY", message);
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
  if (!Number.isSafeInteger(parsed) || parsed > maximum || (name === "limit" && parsed < 1)) {
    throw invalidQuery(
      name === "limit"
        ? `limit must be between 1 and ${MAXIMUM_LIMIT}.`
        : `offset must be between 0 and ${MAXIMUM_OFFSET}.`
    );
  }
  return parsed;
}

function paginationFromRequest(request: Request) {
  const keys = Object.keys(request.query);
  if (keys.some((key) => key !== "limit" && key !== "offset")) {
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

function serializedFileSize(value: number | string | null): string | null {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Prescription history contains an unsafe file size.");
    }
    return String(value);
  }
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error("Prescription history contains an invalid file size.");
  }
  return BigInt(value).toString();
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("Prescription history contains invalid metadata.");
  }
  return value;
}

function publicHistoryItem(
  row: PrescriptionHistoryRow,
  expectedUserId: string
): PrescriptionHistoryItem {
  if (
    row.user_id !== expectedUserId ||
    typeof row.id !== "string" ||
    !PRESCRIPTION_FILE_TYPES.includes(row.file_type) ||
    !PRESCRIPTION_STATUSES.includes(row.status) ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    throw new Error("Prescription history row failed validation.");
  }

  return {
    id: row.id,
    file_type: row.file_type,
    file_size_bytes: serializedFileSize(row.file_size_bytes),
    status: row.status,
    prescription_date: nullableString(row.prescription_date),
    created_at: row.created_at,
    updated_at: row.updated_at,
    processed_at: nullableString(row.processed_at)
  };
}

function requireUserClient(request: Express.Request) {
  if (!request.userSupabase) {
    throw new Error("Authenticated user client is unavailable.");
  }
  return request.userSupabase;
}

function notFound(): AppError {
  return new AppError(404, "PRESCRIPTION_NOT_FOUND", "Prescription not found.");
}

export function createPrescriptionHistoryRouter(
  verifier: AuthVerifier,
  userClientFactory: UserSupabaseClientFactory = createUserSupabaseClient,
  repository: PrescriptionHistoryRepository =
    supabasePrescriptionHistoryRepository
): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(verifier, userClientFactory);

  router.get("/api/v1/prescriptions", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    const pagination = paginationFromRequest(request);
    const rows = await repository.listOwned(
      requireUserClient(request),
      identity.userId,
      pagination
    );
    const hasMore = rows.length > pagination.limit;
    const visibleRows = hasMore ? rows.slice(0, pagination.limit) : rows;
    const items = visibleRows.map((row) => publicHistoryItem(row, identity.userId));
    const body: PrescriptionHistoryPage = {
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
    "/api/v1/prescriptions/:id",
    authenticate,
    async (request, response) => {
      const identity = requireAuthenticatedIdentity(request);
      const prescriptionId = request.params.id;
      if (typeof prescriptionId !== "string" || !UUID_PATTERN.test(prescriptionId)) {
        throw new AppError(
          400,
          "INVALID_PRESCRIPTION_ID",
          "Prescription ID must be a valid UUID."
        );
      }

      const row = await repository.findOwnedDetail(
        requireUserClient(request),
        identity.userId,
        prescriptionId
      );
      if (!row || row.user_id !== identity.userId) throw notFound();

      const body: PrescriptionDetailResponse = {
        prescription: publicHistoryItem(row, identity.userId)
      };
      response.status(200).json(body);
    }
  );

  return router;
}
