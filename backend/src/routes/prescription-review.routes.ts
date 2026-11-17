import { Router, type Request } from "express";

import {
  REVIEW_EDITABLE_FIELDS,
  validateMedicineFields,
  validateUuid,
  type ReviewEditableField,
} from "../domain/prescription-review/index.js";
import { createAuthenticateMiddleware, requireAuthenticatedIdentity } from "../middleware/authenticate.middleware.js";
import { AppError } from "../middleware/error.middleware.js";
import type { PrescriptionReviewRepositoryFactory } from "../repositories/prescription-review.repository.js";
import type { AuthVerifier } from "../services/auth.service.js";
import { PrescriptionReviewService, type ReviewDraftOperation } from "../services/prescription-review.service.js";
import type { UserSupabaseClientFactory } from "../config/supabase-user.js";

function invalid(message: string): never {
  throw new AppError(400, "INVALID_REVIEW_REQUEST", message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid(`${path} contains unsupported fields.`);
}

function integer(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) invalid(`${path} must be a non-negative integer.`);
  return value as number;
}

function text(value: unknown, path: string, max = 128): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) invalid(`${path} is invalid.`);
  return value.trim();
}

function prescriptionId(request: Request): string {
  try { return validateUuid(request.params.prescriptionId, "prescriptionId"); }
  catch { throw new AppError(400, "INVALID_PRESCRIPTION_ID", "Prescription ID must be a valid UUID."); }
}

function concurrency(root: Record<string, unknown>) {
  return {
    expectedRevisionNumber: integer(root.expectedRevisionNumber, "expectedRevisionNumber"),
    expectedLockVersion: integer(root.expectedLockVersion, "expectedLockVersion"),
  };
}

function parseOperation(value: unknown): ReviewDraftOperation {
  const operation = object(value, "operation");
  const type = operation.type;
  if (type === "edit_fields") {
    exactKeys(operation, ["type", "medicineId", "updates"], "operation");
    const updates = object(operation.updates, "operation.updates");
    if (!Object.keys(updates).length || Object.keys(updates).some((key) => !REVIEW_EDITABLE_FIELDS.includes(key as ReviewEditableField))) invalid("operation.updates contains invalid fields.");
    for (const value of Object.values(updates)) if (value !== null && typeof value !== "string") invalid("Review field values must be strings or null.");
    return { type, medicineId: validateUuid(operation.medicineId, "operation.medicineId"), updates: updates as Partial<Record<ReviewEditableField, string | null>> };
  }
  if (type === "add_medicine") {
    exactKeys(operation, ["type", "commandId", "medicineId", "fields", "position"], "operation");
    const position = operation.position === undefined ? undefined : integer(operation.position, "operation.position");
    return {
      type, commandId: text(operation.commandId, "operation.commandId"),
      medicineId: validateUuid(operation.medicineId, "operation.medicineId"),
      fields: validateMedicineFields(operation.fields, "operation.fields"),
      ...(position === undefined ? {} : { position }),
    };
  }
  if (["remove_medicine", "restore_medicine", "restore_original"].includes(type as string)) {
    exactKeys(operation, ["type", "medicineId"], "operation");
    return { type: type as "remove_medicine" | "restore_medicine" | "restore_original", medicineId: validateUuid(operation.medicineId, "operation.medicineId") };
  }
  if (type === "reorder_medicines") {
    exactKeys(operation, ["type", "orderedMedicineIds"], "operation");
    if (!Array.isArray(operation.orderedMedicineIds)) invalid("operation.orderedMedicineIds must be an array.");
    return { type, orderedMedicineIds: operation.orderedMedicineIds.map((id, index) => validateUuid(id, `operation.orderedMedicineIds[${index}]`)) };
  }
  if (type === "save_draft") {
    exactKeys(operation, ["type"], "operation");
    return { type };
  }
  return invalid("operation.type is invalid.");
}

export function createPrescriptionReviewRouter(
  verifier: AuthVerifier,
  userClientFactory: UserSupabaseClientFactory,
  repositoryFactory: PrescriptionReviewRepositoryFactory,
  autoDispatchConfirmed = false,
): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(verifier, userClientFactory);
  const service = (request: Request) => {
    if (!request.userSupabase) throw new Error("Authenticated user client is unavailable.");
    return new PrescriptionReviewService(repositoryFactory(request.userSupabase), autoDispatchConfirmed);
  };

  router.get("/api/v1/prescriptions/:prescriptionId/review", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    response.status(200).json(await service(request).getReview(identity.userId, prescriptionId(request)));
  });
  router.get("/api/v1/prescriptions/:prescriptionId/review/revisions", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    response.status(200).json(await service(request).listRevisions(identity.userId, prescriptionId(request)));
  });
  router.get("/api/v1/prescriptions/:prescriptionId/evidence", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    response.status(200).json(await service(request).getEvidence(identity.userId, prescriptionId(request)));
  });
  router.patch("/api/v1/prescriptions/:prescriptionId/review/draft", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    const body = object(request.body, "request");
    exactKeys(body, ["expectedRevisionNumber", "expectedLockVersion", "operation"], "request");
    response.status(200).json(await service(request).applyDraft(identity.userId, prescriptionId(request), {
      ...concurrency(body), operation: parseOperation(body.operation), now: new Date().toISOString(),
    }));
  });
  router.post("/api/v1/prescriptions/:prescriptionId/review/confirm", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    const body = object(request.body, "request");
    exactKeys(body, ["expectedRevisionNumber", "expectedLockVersion", "idempotencyKey"], "request");
    response.status(200).json(await service(request).confirm(identity.userId, prescriptionId(request), {
      ...concurrency(body), idempotencyKey: text(body.idempotencyKey, "idempotencyKey"), now: new Date().toISOString(),
    }));
  });
  router.post("/api/v1/prescriptions/:prescriptionId/review/reopen", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    const body = object(request.body, "request");
    exactKeys(body, ["expectedRevisionNumber", "expectedLockVersion"], "request");
    response.status(201).json(await service(request).reopen(identity.userId, prescriptionId(request), { ...concurrency(body), now: new Date().toISOString() }));
  });
  return router;
}
