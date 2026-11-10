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
  FamilyMemberRepositoryError,
  supabaseFamilyMemberRepository,
  type FamilyMemberRepository
} from "../repositories/family-member.repository.js";
import type { AuthVerifier } from "../services/auth.service.js";
import type {
  FamilyMemberInput,
  FamilyMemberItem,
  FamilyMemberPage,
  FamilyMemberRow,
  FamilyMemberUpdate
} from "../types/family-members.js";

const DEFAULT_LIMIT = 20;
const MAXIMUM_LIMIT = 50;
const MAXIMUM_OFFSET = 1_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidInput(message: string): AppError {
  return new AppError(400, "INVALID_FAMILY_MEMBER_INPUT", message);
}

function invalidQuery(message: string): AppError {
  return new AppError(400, "INVALID_FAMILY_MEMBER_QUERY", message);
}

function notFound(): AppError {
  return new AppError(404, "FAMILY_MEMBER_NOT_FOUND", "Family member not found.");
}

function requireUserClient(request: Express.Request) {
  if (!request.userSupabase) throw new Error("Authenticated user client is unavailable.");
  return request.userSupabase;
}

function parseUnsigned(
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
    throw invalidQuery(name === "limit"
      ? `limit must be between 1 and ${MAXIMUM_LIMIT}.`
      : `offset must be between 0 and ${MAXIMUM_OFFSET}.`);
  }
  return parsed;
}

function pagination(request: Request) {
  if (Object.keys(request.query).some((key) => key !== "limit" && key !== "offset")) {
    throw invalidQuery("Query contains an unexpected parameter.");
  }
  return {
    limit: parseUnsigned(request.query.limit, "limit", DEFAULT_LIMIT, MAXIMUM_LIMIT),
    offset: parseUnsigned(request.query.offset, "offset", 0, MAXIMUM_OFFSET)
  } as const;
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalidInput("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function normalizedRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string") throw invalidInput(`${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 100) {
    throw invalidInput(`${field} must contain 1 to 100 characters.`);
  }
  return normalized;
}

function normalizedRelationship(value: unknown): string | null {
  if (value === null) return null;
  return normalizedRequiredText(value, "relationship");
}

function createInput(body: unknown): FamilyMemberInput {
  const record = objectBody(body);
  const keys = Object.keys(record);
  if (!Object.hasOwn(record, "name") || keys.some(
    (key) => key !== "name" && key !== "relationship"
  )) {
    throw invalidInput("Only name and relationship may be supplied.");
  }
  return {
    name: normalizedRequiredText(record.name, "name"),
    relationship: Object.hasOwn(record, "relationship")
      ? normalizedRelationship(record.relationship)
      : null
  };
}

function updateInput(body: unknown): FamilyMemberUpdate {
  const record = objectBody(body);
  const keys = Object.keys(record);
  if (keys.length === 0 || keys.some(
    (key) => key !== "name" && key !== "relationship"
  )) {
    throw invalidInput("A patch must contain only name or relationship.");
  }
  return {
    ...(Object.hasOwn(record, "name")
      ? { name: normalizedRequiredText(record.name, "name") }
      : {}),
    ...(Object.hasOwn(record, "relationship")
      ? { relationship: normalizedRelationship(record.relationship) }
      : {})
  };
}

function memberId(request: Request): string {
  const id = request.params.id;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    throw new AppError(
      400,
      "INVALID_FAMILY_MEMBER_ID",
      "Family member ID must be a valid UUID."
    );
  }
  return id;
}

function publicItem(row: FamilyMemberRow, expectedUserId: string): FamilyMemberItem {
  const validStoredText = (value: unknown): value is string =>
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 100;
  const validTimestamp = (value: unknown): value is string =>
    typeof value === "string" &&
    value === value.trim() &&
    Number.isFinite(Date.parse(value));

  if (
    row.user_id !== expectedUserId ||
    typeof row.id !== "string" || !UUID_PATTERN.test(row.id) ||
    !validStoredText(row.name) ||
    !(row.relationship === null || validStoredText(row.relationship)) ||
    !validTimestamp(row.created_at) || !validTimestamp(row.updated_at)
  ) {
    throw new Error("Family member row failed validation.");
  }
  return {
    id: row.id,
    name: row.name,
    relationship: row.relationship,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function handleRepositoryError(error: unknown): never {
  if (error instanceof FamilyMemberRepositoryError &&
    error.code === "MISSING_APPLICATION_PROFILE") {
    throw new AppError(
      409,
      "APPLICATION_PROFILE_REQUIRED",
      "Application profile is required before creating a family member."
    );
  }
  throw error;
}

export function createFamilyMemberRouter(
  verifier: AuthVerifier,
  userClientFactory: UserSupabaseClientFactory = createUserSupabaseClient,
  repository: FamilyMemberRepository = supabaseFamilyMemberRepository
): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(verifier, userClientFactory);

  router.get("/api/v1/family-members", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    const page = pagination(request);
    const rows = await repository.listOwned(requireUserClient(request), identity.userId, page);
    const hasMore = rows.length > page.limit;
    const items = (hasMore ? rows.slice(0, page.limit) : rows).map((row) =>
      publicItem(row, identity.userId)
    );
    const body: FamilyMemberPage = {
      items,
      pagination: {
        ...page,
        returned: items.length,
        has_more: hasMore,
        next_offset: hasMore ? page.offset + page.limit : null
      }
    };
    response.status(200).json(body);
  });

  router.get("/api/v1/family-members/:id", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    const row = await repository.findOwned(
      requireUserClient(request), identity.userId, memberId(request)
    );
    if (!row || row.user_id !== identity.userId) throw notFound();
    response.status(200).json({ member: publicItem(row, identity.userId) });
  });

  router.post("/api/v1/family-members", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    let row: FamilyMemberRow;
    try {
      row = await repository.createOwned(
        requireUserClient(request), identity.userId, createInput(request.body)
      );
    } catch (error) {
      handleRepositoryError(error);
    }
    response.status(201).json({ member: publicItem(row, identity.userId) });
  });

  router.patch("/api/v1/family-members/:id", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    const row = await repository.updateOwned(
      requireUserClient(request),
      identity.userId,
      memberId(request),
      updateInput(request.body)
    );
    if (!row || row.user_id !== identity.userId) throw notFound();
    response.status(200).json({ member: publicItem(row, identity.userId) });
  });

  router.delete("/api/v1/family-members/:id", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    const row = await repository.deleteOwned(
      requireUserClient(request), identity.userId, memberId(request)
    );
    if (!row || row.user_id !== identity.userId) throw notFound();
    response.status(204).send();
  });

  return router;
}
