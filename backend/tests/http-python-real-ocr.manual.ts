// Opt-in real OCR against only the local test service and the fictional fixture.
import { HttpPythonIntelligenceClient } from "../src/services/http-python-intelligence.client.js";
import type { IntelligenceRequestV1 } from "../src/types/intelligence-contract-v1.js";

async function main(): Promise<void> {
  if (process.env.MEDDECODE_LOCAL_OCR_TEST !== "1") throw new Error("Explicit local OCR test opt-in required.");
  const token = process.env.MEDDECODE_INTERNAL_TOKEN ?? "";
  const input: IntelligenceRequestV1 = { schema_version: "1.0", job_id: "10000000-0000-4000-8000-000000000001",
    prescription_id: "20000000-0000-4000-8000-000000000001", document: { access_type: "authorized_url", file_url: "https://worker.invalid/authorized-document", file_type: "application/pdf" },
    requested_analysis: { extract_prescription: true, match_medicines: true, find_alternatives: false, generate_recommendations: true } };
  for (const fixture of [
    { name: "synthetic-prescription-002.pdf", type: "application/pdf" },
    { name: "synthetic-prescription-001.jpg", type: "image/jpeg" },
    { name: "synthetic-prescription-001.png", type: "image/png" },
  ] as const) {
    const client = new HttpPythonIntelligenceClient(`C:\\Users\\dahiy\\MedDecode-Test-Fixtures\\${fixture.name}`, "http://127.0.0.1:18000", token);
    const result = await client.analyze({ ...input, document: { ...input.document, file_type: fixture.type } });
    if (result.status === "failed") { console.log(`REAL_OCR_${fixture.type}=failed`); process.exitCode = 1; return; }
    console.log(`REAL_OCR_${fixture.type}=${result.status};MEDICINES=${result.medicines.map(item => (item.extraction as Record<string, unknown>).medicine_name).join(",")}`);
  }
  console.log("TYPESCRIPT_CONTRACT_VALIDATION_OK");
}
main().catch(() => { console.error("REAL_LOCAL_HTTP_OCR_TEST_FAILED"); process.exitCode = 1; });
