import type { IntelligenceResponseV1 } from "../types/intelligence-contract-v1.js";
import type { IntelligenceJobRecord, StoredIntelligenceResult } from "../types/intelligence-jobs.js";

export class IntelligenceResultPersistenceError extends Error {
  constructor(readonly code: "CORRELATION_MISMATCH" | "CONFLICTING_REPLAY" | "PERSISTENCE_FAILED") {
    super("Validated intelligence result persistence failed safely.");
    this.name = "IntelligenceResultPersistenceError";
  }
}

export interface IntelligenceResultPersistence {
  persistValidated(
    job: IntelligenceJobRecord,
    response: IntelligenceResponseV1,
  ): Promise<StoredIntelligenceResult>;
  findByJobId(jobId: string): Promise<StoredIntelligenceResult | null>;
}
