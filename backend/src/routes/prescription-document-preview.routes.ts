import { Router, type Request } from "express";
import { validateUuid } from "../domain/prescription-review/index.js";
import { AppError } from "../middleware/error.middleware.js";
import { createAuthenticateMiddleware, requireAuthenticatedIdentity } from "../middleware/authenticate.middleware.js";
import type { UserSupabaseClientFactory } from "../config/supabase-user.js";
import type { AuthVerifier } from "../services/auth.service.js";
import { PrescriptionDocumentPreviewError, type PrescriptionDocumentPreviewService } from "../services/prescription-document-preview.service.js";

export function createPrescriptionDocumentPreviewRouter(verifier: AuthVerifier, clients: UserSupabaseClientFactory, documents: PrescriptionDocumentPreviewService): Router {
  const router=Router(); const authenticate=createAuthenticateMiddleware(verifier,clients);
  router.get("/api/v1/prescriptions/:prescriptionId/document/preview",authenticate,async(request:Request,response)=>{
    const identity=requireAuthenticatedIdentity(request);
    let id:string; try{id=validateUuid(request.params.prescriptionId,"prescriptionId");}catch{throw new AppError(400,"INVALID_PRESCRIPTION_ID","Prescription ID must be a valid UUID.");}
    if(!request.userSupabase) throw new Error("Authenticated user client is unavailable.");
    try {
      const document=await documents.load(request.userSupabase,identity.userId,id);
      response.set({"Cache-Control":"private, no-store, max-age=0","Pragma":"no-cache","X-Content-Type-Options":"nosniff","Content-Disposition":"inline"});
      response.type(document.contentType).status(200).send(document.bytes);
    } catch(error) {
      if(error instanceof PrescriptionDocumentPreviewError && error.code==="NOT_FOUND") throw new AppError(404,"PRESCRIPTION_NOT_FOUND","Prescription not found.");
      if(error instanceof PrescriptionDocumentPreviewError && error.code==="TOO_LARGE") throw new AppError(413,"DOCUMENT_TOO_LARGE","Prescription document exceeds the preview limit.");
      throw new AppError(503,"DOCUMENT_PREVIEW_UNAVAILABLE","Prescription document preview is unavailable.");
    }
  });
  return router;
}
