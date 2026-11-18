import { Router, type Request } from "express";
import { randomUUID } from "node:crypto";
import { validateUuid } from "../domain/prescription-review/index.js";
import { AppError } from "../middleware/error.middleware.js";
import { createAuthenticateMiddleware, requireAuthenticatedIdentity } from "../middleware/authenticate.middleware.js";
import type { UserSupabaseClientFactory } from "../config/supabase-user.js";
import type { AuthVerifier } from "../services/auth.service.js";
import { PrescriptionDocumentPreviewError, type PrescriptionDocumentPreviewService } from "../services/prescription-document-preview.service.js";

export interface PrescriptionDocumentPreviewLogger {
  warn(event: Readonly<{
    event: "prescription_preview_failed";
    correlationId: string;
    stage: string;
    category: string;
    providerStatusClass?: "4xx" | "5xx";
  }>): void;
}

const defaultLogger: PrescriptionDocumentPreviewLogger = {
  warn(event) { console.warn(JSON.stringify({ level: "warn", ...event })); },
};

export function createPrescriptionDocumentPreviewRouter(
  verifier: AuthVerifier,
  clients: UserSupabaseClientFactory,
  documents: PrescriptionDocumentPreviewService,
  logger: PrescriptionDocumentPreviewLogger = defaultLogger,
): Router {
  const router=Router(); const authenticate=createAuthenticateMiddleware(verifier,clients);
  router.get("/api/v1/prescriptions/:prescriptionId/document/preview",authenticate,async(request:Request,response)=>{
    const identity=requireAuthenticatedIdentity(request);
    let id:string; try{id=validateUuid(request.params.prescriptionId,"prescriptionId");}catch{throw new AppError(400,"INVALID_PRESCRIPTION_ID","Prescription ID must be a valid UUID.");}
    if(!request.userSupabase) throw new Error("Authenticated user client is unavailable.");
    const correlationId=randomUUID();
    response.setHeader("X-Request-ID",correlationId);
    const controller=new AbortController();
    const abort=()=>controller.abort();
    request.once("aborted",abort);
    response.once("close",abort);
    try {
      const document=await documents.load(request.userSupabase,identity.userId,id,controller.signal);
      response.set({"Cache-Control":"private, no-store, max-age=0","Pragma":"no-cache","X-Content-Type-Options":"nosniff","Content-Disposition":"inline"});
      response.type(document.contentType).status(200).send(document.bytes);
    } catch(error) {
      if(error instanceof PrescriptionDocumentPreviewError && error.code==="NOT_FOUND") throw new AppError(404,"PRESCRIPTION_NOT_FOUND","Prescription not found.");
      if(error instanceof PrescriptionDocumentPreviewError && error.code==="TOO_LARGE") throw new AppError(413,"DOCUMENT_TOO_LARGE","Prescription document exceeds the preview limit.");
      if(error instanceof PrescriptionDocumentPreviewError) logger.warn({
        event:"prescription_preview_failed",correlationId,stage:error.stage,category:error.category,
        ...(error.providerStatusClass===undefined?{}:{providerStatusClass:error.providerStatusClass}),
      });
      throw new AppError(503,"DOCUMENT_PREVIEW_UNAVAILABLE","Prescription document preview is unavailable.");
    } finally {
      request.removeListener("aborted",abort);
      response.removeListener("close",abort);
    }
  });
  return router;
}
