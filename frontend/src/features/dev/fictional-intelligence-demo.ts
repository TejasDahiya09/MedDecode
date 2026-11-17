import { ApiError, requestAuthenticatedJson } from '../../services/api-client';

export type FictionalIntelligenceResult = Readonly<{
  status: 'completed' | 'completed_with_warnings';
  medicines: ReadonlyArray<Readonly<{
    sequence_number: number;
    extraction: Readonly<{ medicine_name?: string | null; raw_text: string; strength?: Readonly<{ value: number | null; unit: string | null }>; instructions?: string | null }>;
    medicine_match: Readonly<{ status: string; brand_name: string | null; dosage_form: string | null }>;
  }>>;
  warnings: ReadonlyArray<Readonly<{ code: string; severity: 'info' | 'low' | 'medium' | 'high'; message: string }>>;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseFictionalIntelligenceResult(value: unknown): FictionalIntelligenceResult | null {
  const root = record(value);
  if (!root || root.schema_version !== '1.0' || !['completed', 'completed_with_warnings'].includes(String(root.status)) || !Array.isArray(root.medicines) || !Array.isArray(root.warnings)) return null;
  const medicines = root.medicines.map(item => {
    const medicine = record(item); const extraction = medicine && record(medicine.extraction); const match = medicine && record(medicine.medicine_match); const strength = extraction && extraction.strength === undefined ? undefined : extraction && record(extraction.strength);
    if (!medicine || !extraction || !match || !Number.isInteger(medicine.sequence_number) || typeof extraction.raw_text !== 'string' || (extraction.medicine_name !== undefined && extraction.medicine_name !== null && typeof extraction.medicine_name !== 'string') || typeof match.status !== 'string' || (strength && (typeof strength.value !== 'number' && strength.value !== null || typeof strength.unit !== 'string' && strength.unit !== null))) return null;
    return { sequence_number: medicine.sequence_number as number, extraction: { raw_text: extraction.raw_text, ...(typeof extraction.medicine_name === 'string' || extraction.medicine_name === null ? { medicine_name: extraction.medicine_name } : {}), ...(strength ? { strength: { value: strength.value as number | null, unit: strength.unit as string | null } } : {}), ...(typeof extraction.instructions === 'string' || extraction.instructions === null ? { instructions: extraction.instructions } : {}) }, medicine_match: { status: match.status, brand_name: typeof match.brand_name === 'string' || match.brand_name === null ? match.brand_name : null, dosage_form: typeof match.dosage_form === 'string' || match.dosage_form === null ? match.dosage_form : null } };
  });
  if (medicines.some(item => item === null)) return null;
  const warnings = root.warnings.map(item => {
    const warning = record(item);
    return warning && typeof warning.code === 'string' && typeof warning.message === 'string' && ['info', 'low', 'medium', 'high'].includes(String(warning.severity)) ? { code: warning.code, message: warning.message, severity: warning.severity as FictionalIntelligenceResult['warnings'][number]['severity'] } : null;
  });
  if (warnings.some(item => item === null) || !warnings.some(item => item?.code === 'DEVELOPMENT_FIXTURE_INJECTED_OCR')) return null;
  return { status: root.status as FictionalIntelligenceResult['status'], medicines: medicines as FictionalIntelligenceResult['medicines'], warnings: warnings as FictionalIntelligenceResult['warnings'] };
}

export async function runFictionalIntelligenceDemo(accessToken: string): Promise<FictionalIntelligenceResult> {
  const value = await requestAuthenticatedJson('/api/v1/development/fictional-intelligence-result', accessToken, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const result = parseFictionalIntelligenceResult(value);
  if (!result) throw new ApiError('The development intelligence endpoint returned an invalid response.', 502, 'response');
  return result;
}
