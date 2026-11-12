import type {
  IntelligenceRequestV1,
  IntelligenceResponseV1,
} from "../types/intelligence-contract-v1.js";

export interface IntelligenceClient {
  analyze(request: IntelligenceRequestV1): Promise<IntelligenceResponseV1>;
}
