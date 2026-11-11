import type { IntelligenceRequestV1 } from "../types/intelligence-contract-v1.js";
import type { OwnedProcessablePrescription } from "../types/intelligence-jobs.js";

export type IntelligenceDocumentReference = IntelligenceRequestV1["document"] & {
  readonly access_type: "authorized_url";
  readonly file_url: string;
};

export interface DocumentReferenceProvider {
  createReference(
    prescription: OwnedProcessablePrescription,
  ): Promise<IntelligenceDocumentReference>;
}

/**
 * Offline-only provider. The reserved .invalid host is inert and is never
 * dereferenced by orchestration tests. Production S3 authorization is outside
 * Phase 5.5a.
 */
export const syntheticDocumentReferenceProvider: DocumentReferenceProvider = {
  async createReference(prescription) {
    if (!prescription.storageBucket.trim() || !prescription.objectKey.trim()) {
      throw new Error("Trusted prescription storage metadata is incomplete.");
    }
    return Object.freeze({
      access_type: "authorized_url",
      file_url: `https://contract.invalid/prescriptions/${encodeURIComponent(prescription.id)}`,
      file_type: prescription.fileType,
    });
  },
};
