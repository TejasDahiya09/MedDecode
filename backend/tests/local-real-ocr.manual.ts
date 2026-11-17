// Explicitly invoked local smoke check; never part of the default test suite.
import { createRealLocalPdfIntelligenceClientFactory } from '../src/services/local-python-intelligence.client.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const client = createRealLocalPdfIntelligenceClientFactory({
  pythonExecutable: required('MEDDECODE_PYTHON'),
  intelligenceDirectory: required('MEDDECODE_INTELLIGENCE_DIR'),
  easyOcrModelDirectory: required('MEDDECODE_EASYOCR_MODELS'),
  catalogueEnvironment: { MEDDECODE_CATALOGUE_ENV: 'local' },
  timeoutMs: 120_000,
})(required('MEDDECODE_TEST_PDF'));
const started = Date.now();
async function main() {
const result = await client.analyze({
  schema_version: '1.0', job_id: '11111111-1111-4111-8111-111111111111',
  prescription_id: '22222222-2222-4222-8222-222222222222',
  document: { access_type: 'authorized_url', file_url: 'https://worker.invalid/document', file_type: 'application/pdf' },
  requested_analysis: { extract_prescription: true, match_medicines: true, find_alternatives: false, generate_recommendations: false },
});
if (result.status === 'failed') {
  console.log(JSON.stringify({ status: result.status, code: result.error.code, elapsedMs: Date.now() - started }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: result.status, elapsedMs: Date.now() - started,
    medicineCount: result.medicines.length,
    warnings: result.warnings.map(w => w.code) }));
}
}
void main().catch(() => { console.error('Local OCR check failed safely.'); process.exitCode = 1; });
