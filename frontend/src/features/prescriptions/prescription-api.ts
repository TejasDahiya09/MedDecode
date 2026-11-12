import { ApiError, requestAuthenticatedJson } from '../../services/api-client';

export type PrescriptionStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed';

export type PrescriptionFileType = 'image/jpeg' | 'image/png' | 'application/pdf';

export interface PrescriptionHistoryItem {
  readonly id: string;
  readonly file_type: PrescriptionFileType;
  readonly file_size_bytes: string | null;
  readonly status: PrescriptionStatus;
  readonly prescription_date: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly processed_at: string | null;
}

export interface PrescriptionHistoryPage {
  readonly items: readonly PrescriptionHistoryItem[];
  readonly pagination: {
    readonly limit: number;
    readonly offset: number;
    readonly returned: number;
    readonly has_more: boolean;
    readonly next_offset: number | null;
  };
}

export interface ProcessingJobInfo {
  readonly job_id: string;
  readonly status: 'queued' | 'processing' | 'completed' | 'failed';
  readonly created_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
}

export interface ProcessingStatusResponse {
  readonly prescription_id: string;
  readonly processing: ProcessingJobInfo | null;
}

export interface ProcessingSubmissionResponse {
  readonly prescription_id: string;
  readonly job: {
    readonly id: string;
    readonly status: 'queued' | 'processing';
    readonly created_at: string;
  };
  readonly submission: {
    readonly created: boolean;
  };
}

// Contract v1 Intelligence Result types
export interface ContractV1Strength {
  readonly value: number | null;
  readonly unit: string | null;
}

export interface ContractV1ValueUnit {
  readonly value: number | null;
  readonly unit: string | null;
}

export interface ContractV1Frequency {
  readonly type: 'scheduled' | 'as_needed' | 'unknown';
  readonly morning?: number | null;
  readonly afternoon?: number | null;
  readonly night?: number | null;
  readonly times_per_day?: number | null;
}

export interface ContractV1MedicineExtraction {
  readonly raw_text: string;
  readonly medicine_name?: string | null;
  readonly medicine_name_normalized?: string | null;
  readonly strength?: ContractV1Strength;
  readonly dosage_form?: string | null;
  readonly frequency: ContractV1Frequency;
  readonly timing?: string | null;
  readonly duration?: ContractV1ValueUnit;
  readonly quantity?: ContractV1ValueUnit;
  readonly instructions?: string | null;
}

export interface ContractV1Ingredient {
  readonly name: string;
  readonly strength_value: number | null;
  readonly strength_unit: string | null;
}

export interface ContractV1MedicineMatch {
  readonly status: 'matched' | 'probable_match' | 'ambiguous' | 'unmatched' | 'not_attempted';
  readonly confidence: number | null;
  readonly medicine_external_id?: string | null;
  readonly brand_name?: string | null;
  readonly dosage_form?: string | null;
  readonly ingredients?: readonly ContractV1Ingredient[];
}

export interface ContractV1MedicineItem {
  readonly sequence_number: number;
  readonly extraction: ContractV1MedicineExtraction;
  readonly confidence?: Readonly<Record<string, number | null | undefined>>;
  readonly medicine_match: ContractV1MedicineMatch;
  readonly derived?: {
    readonly units_per_day: number | null;
    readonly estimated_total_units: number | null;
  };
}

export interface ContractV1WarningItem {
  readonly code: string;
  readonly severity: 'info' | 'low' | 'medium' | 'high';
  readonly message: string;
  readonly related_medicine_sequence_number?: number | null;
}

export interface ContractV1DoctorInfo {
  readonly name?: string | null;
  readonly registration_number?: string | null;
}

export interface ContractV1FacilityInfo {
  readonly name?: string | null;
  readonly address?: string | null;
  readonly phone?: string | null;
}

export interface ContractV1PrescriptionMetadata {
  readonly prescription_date?: string | null;
  readonly doctor?: ContractV1DoctorInfo;
  readonly facility?: ContractV1FacilityInfo;
}

export interface ContractV1PatientMetadata {
  readonly name?: string | null;
  readonly age?: number | null;
  readonly gender?: string | null;
}

export interface ContractV1ProcessingMetadata {
  readonly overall_confidence: number | null;
  readonly dataset_version?: string;
  readonly model_version?: string;
}

export interface ContractV1AnalysisResult {
  readonly schema_version: '1.0';
  readonly job_id: string;
  readonly prescription_id: string;
  readonly status: 'completed' | 'completed_with_warnings';
  readonly prescription?: ContractV1PrescriptionMetadata;
  readonly patient?: ContractV1PatientMetadata;
  readonly medicines: readonly ContractV1MedicineItem[];
  readonly warnings: readonly ContractV1WarningItem[];
  readonly processing_metadata: ContractV1ProcessingMetadata;
}

export type AnalysisResultOutcome =
  | { readonly kind: 'available'; readonly result: ContractV1AnalysisResult }
  | { readonly kind: 'unavailable'; readonly reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validStatuses = new Set<PrescriptionStatus>([
  'uploaded',
  'queued',
  'processing',
  'completed',
  'completed_with_warnings',
  'failed',
]);

export function parsePrescriptionHistoryItem(value: unknown): PrescriptionHistoryItem | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || !uuidPattern.test(value.id)) return null;
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(String(value.file_type))) return null;
  if (!validStatuses.has(value.status as PrescriptionStatus)) return null;
  if (typeof value.created_at !== 'string' || typeof value.updated_at !== 'string') return null;

  return {
    id: value.id,
    file_type: value.file_type as PrescriptionFileType,
    file_size_bytes: value.file_size_bytes === null ? null : String(value.file_size_bytes),
    status: value.status as PrescriptionStatus,
    prescription_date: value.prescription_date === null || typeof value.prescription_date === 'string' ? value.prescription_date : null,
    created_at: value.created_at,
    updated_at: value.updated_at,
    processed_at: value.processed_at === null || typeof value.processed_at === 'string' ? value.processed_at : null,
  };
}

export function parseProcessingStatusResponse(value: unknown): ProcessingStatusResponse | null {
  if (!isObject(value)) return null;
  if (typeof value.prescription_id !== 'string' || !uuidPattern.test(value.prescription_id)) return null;

  if (value.processing === null) {
    return { prescription_id: value.prescription_id, processing: null };
  }

  if (!isObject(value.processing)) return null;
  const proc = value.processing;
  if (typeof proc.job_id !== 'string' || !uuidPattern.test(proc.job_id)) return null;
  if (!['queued', 'processing', 'completed', 'failed'].includes(String(proc.status))) return null;
  if (typeof proc.created_at !== 'string') return null;

  return {
    prescription_id: value.prescription_id,
    processing: {
      job_id: proc.job_id,
      status: proc.status as ProcessingJobInfo['status'],
      created_at: proc.created_at,
      started_at: typeof proc.started_at === 'string' || proc.started_at === null ? proc.started_at : null,
      completed_at: typeof proc.completed_at === 'string' || proc.completed_at === null ? proc.completed_at : null,
    },
  };
}

export function parseProcessingSubmissionResponse(value: unknown): ProcessingSubmissionResponse | null {
  if (!isObject(value)) return null;
  if (typeof value.prescription_id !== 'string' || !uuidPattern.test(value.prescription_id)) return null;
  if (!isObject(value.job) || !isObject(value.submission)) return null;

  const job = value.job;
  if (typeof job.id !== 'string' || !uuidPattern.test(job.id)) return null;
  if (!['queued', 'processing'].includes(String(job.status))) return null;
  if (typeof job.created_at !== 'string') return null;
  if (typeof value.submission.created !== 'boolean') return null;

  return {
    prescription_id: value.prescription_id,
    job: {
      id: job.id,
      status: job.status as 'queued' | 'processing',
      created_at: job.created_at,
    },
    submission: {
      created: value.submission.created,
    },
  };
}

export function parseContractV1AnalysisResult(value: unknown): ContractV1AnalysisResult | null {
  if (!isObject(value)) return null;
  if (value.schema_version !== '1.0') return null;
  if (typeof value.job_id !== 'string' || typeof value.prescription_id !== 'string') return null;
  if (value.status !== 'completed' && value.status !== 'completed_with_warnings') return null;
  if (!Array.isArray(value.medicines) || !Array.isArray(value.warnings)) return null;
  if (!isObject(value.processing_metadata)) return null;

  const medicines: ContractV1MedicineItem[] = [];
  for (const item of value.medicines) {
    if (!isObject(item)) return null;
    if (!Number.isInteger(item.sequence_number) || (item.sequence_number as number) < 1) return null;
    if (!isObject(item.extraction) || typeof item.extraction.raw_text !== 'string') return null;
    if (!isObject(item.medicine_match)) return null;

    const ext = item.extraction;
    const match = item.medicine_match;
    const freq = isObject(ext.frequency) ? ext.frequency : { type: 'unknown' };

    medicines.push({
      sequence_number: item.sequence_number as number,
      extraction: {
        raw_text: ext.raw_text as string,
        medicine_name: typeof ext.medicine_name === 'string' || ext.medicine_name === null ? ext.medicine_name : null,
        medicine_name_normalized: typeof ext.medicine_name_normalized === 'string' || ext.medicine_name_normalized === null ? ext.medicine_name_normalized : null,
        strength: isObject(ext.strength)
          ? {
              value: typeof ext.strength.value === 'number' || ext.strength.value === null ? ext.strength.value : null,
              unit: typeof ext.strength.unit === 'string' || ext.strength.unit === null ? ext.strength.unit : null,
            }
          : undefined,
        dosage_form: typeof ext.dosage_form === 'string' || ext.dosage_form === null ? ext.dosage_form : null,
        frequency: {
          type: ['scheduled', 'as_needed', 'unknown'].includes(String(freq.type))
            ? (freq.type as ContractV1Frequency['type'])
            : 'unknown',
          morning: typeof freq.morning === 'number' || freq.morning === null ? freq.morning : undefined,
          afternoon: typeof freq.afternoon === 'number' || freq.afternoon === null ? freq.afternoon : undefined,
          night: typeof freq.night === 'number' || freq.night === null ? freq.night : undefined,
          times_per_day: typeof freq.times_per_day === 'number' || freq.times_per_day === null ? freq.times_per_day : undefined,
        },
        timing: typeof ext.timing === 'string' || ext.timing === null ? ext.timing : null,
        duration: isObject(ext.duration)
          ? {
              value: typeof ext.duration.value === 'number' || ext.duration.value === null ? ext.duration.value : null,
              unit: typeof ext.duration.unit === 'string' || ext.duration.unit === null ? ext.duration.unit : null,
            }
          : undefined,
        quantity: isObject(ext.quantity)
          ? {
              value: typeof ext.quantity.value === 'number' || ext.quantity.value === null ? ext.quantity.value : null,
              unit: typeof ext.quantity.unit === 'string' || ext.quantity.unit === null ? ext.quantity.unit : null,
            }
          : undefined,
        instructions: typeof ext.instructions === 'string' || ext.instructions === null ? ext.instructions : null,
      },
      confidence: isObject(item.confidence) ? (item.confidence as Record<string, number | null>) : undefined,
      medicine_match: {
        status: ['matched', 'probable_match', 'ambiguous', 'unmatched', 'not_attempted'].includes(String(match.status))
          ? (match.status as ContractV1MedicineMatch['status'])
          : 'not_attempted',
        confidence: typeof match.confidence === 'number' || match.confidence === null ? match.confidence : null,
        medicine_external_id: typeof match.medicine_external_id === 'string' || match.medicine_external_id === null ? match.medicine_external_id : undefined,
        brand_name: typeof match.brand_name === 'string' || match.brand_name === null ? match.brand_name : undefined,
        dosage_form: typeof match.dosage_form === 'string' || match.dosage_form === null ? match.dosage_form : undefined,
        ingredients: Array.isArray(match.ingredients)
          ? match.ingredients
              .filter(isObject)
              .map((ing) => ({
                name: String(ing.name ?? ''),
                strength_value: typeof ing.strength_value === 'number' || ing.strength_value === null ? ing.strength_value : null,
                strength_unit: typeof ing.strength_unit === 'string' || ing.strength_unit === null ? ing.strength_unit : null,
              }))
          : undefined,
      },
      derived: isObject(item.derived)
        ? {
            units_per_day: typeof item.derived.units_per_day === 'number' || item.derived.units_per_day === null ? item.derived.units_per_day : null,
            estimated_total_units: typeof item.derived.estimated_total_units === 'number' || item.derived.estimated_total_units === null ? item.derived.estimated_total_units : null,
          }
        : undefined,
    });
  }

  const warnings: ContractV1WarningItem[] = [];
  for (const item of value.warnings) {
    if (!isObject(item)) return null;
    if (typeof item.code !== 'string' || typeof item.message !== 'string') return null;
    if (!['info', 'low', 'medium', 'high'].includes(String(item.severity))) return null;

    warnings.push({
      code: item.code,
      message: item.message,
      severity: item.severity as ContractV1WarningItem['severity'],
      related_medicine_sequence_number:
        typeof item.related_medicine_sequence_number === 'number' || item.related_medicine_sequence_number === null
          ? item.related_medicine_sequence_number
          : null,
    });
  }

  const meta = value.processing_metadata;
  const processing_metadata: ContractV1ProcessingMetadata = {
    overall_confidence: typeof meta.overall_confidence === 'number' || meta.overall_confidence === null ? meta.overall_confidence : null,
    dataset_version: typeof meta.dataset_version === 'string' ? meta.dataset_version : undefined,
    model_version: typeof meta.model_version === 'string' ? meta.model_version : undefined,
  };

  let prescription: ContractV1PrescriptionMetadata | undefined;
  if (isObject(value.prescription)) {
    const rx = value.prescription;
    const doc = isObject(rx.doctor) ? rx.doctor : undefined;
    const fac = isObject(rx.facility) ? rx.facility : undefined;
    prescription = {
      prescription_date: typeof rx.prescription_date === 'string' || rx.prescription_date === null ? rx.prescription_date : null,
      doctor: doc
        ? {
            name: typeof doc.name === 'string' || doc.name === null ? doc.name : null,
            registration_number: typeof doc.registration_number === 'string' || doc.registration_number === null ? doc.registration_number : null,
          }
        : undefined,
      facility: fac
        ? {
            name: typeof fac.name === 'string' || fac.name === null ? fac.name : undefined,
            address: typeof fac.address === 'string' || fac.address === null ? fac.address : undefined,
            phone: typeof fac.phone === 'string' || fac.phone === null ? fac.phone : undefined,
          }
        : undefined,
    };
  }

  let patient: ContractV1PatientMetadata | undefined;
  if (isObject(value.patient)) {
    const pat = value.patient;
    patient = {
      name: typeof pat.name === 'string' || pat.name === null ? pat.name : null,
      age: typeof pat.age === 'number' || pat.age === null ? pat.age : null,
      gender: typeof pat.gender === 'string' || pat.gender === null ? pat.gender : null,
    };
  }

  return {
    schema_version: '1.0',
    job_id: value.job_id,
    prescription_id: value.prescription_id,
    status: value.status,
    prescription,
    patient,
    medicines,
    warnings,
    processing_metadata,
  };
}

// Authenticated Read API 1: GET /api/v1/prescriptions/:id
export async function fetchPrescriptionDetail(
  prescriptionId: string,
  accessToken: string,
): Promise<PrescriptionHistoryItem> {
  const data = await requestAuthenticatedJson<{ prescription?: unknown }>(
    `/api/v1/prescriptions/${prescriptionId}`,
    accessToken,
  );
  if (!isObject(data) || !('prescription' in data)) {
    throw new ApiError('The prescription detail service returned an unexpected response.', 502, 'response');
  }
  const item = parsePrescriptionHistoryItem(data.prescription);
  if (!item) {
    throw new ApiError('The prescription record contains invalid fields.', 502, 'response');
  }
  return item;
}

// Authenticated Read API 2: GET /api/v1/prescriptions
export async function fetchPrescriptionHistory(
  accessToken: string,
  pagination?: { limit?: number; offset?: number },
): Promise<PrescriptionHistoryPage> {
  // api-client forbids query strings, but default endpoint /api/v1/prescriptions works
  const path = '/api/v1/prescriptions';
  const data = await requestAuthenticatedJson<Record<string, unknown>>(path, accessToken);
  if (!isObject(data) || !Array.isArray(data.items) || !isObject(data.pagination)) {
    throw new ApiError('The prescription history service returned an unexpected response.', 502, 'response');
  }
  const items: PrescriptionHistoryItem[] = [];
  for (const raw of data.items) {
    const item = parsePrescriptionHistoryItem(raw);
    if (!item) throw new ApiError('Prescription history contains an invalid item.', 502, 'response');
    items.push(item);
  }
  const pag = data.pagination;
  return {
    items,
    pagination: {
      limit: Number(pag.limit ?? pagination?.limit ?? 20),
      offset: Number(pag.offset ?? pagination?.offset ?? 0),
      returned: Number(pag.returned ?? items.length),
      has_more: Boolean(pag.has_more),
      next_offset: typeof pag.next_offset === 'number' || pag.next_offset === null ? pag.next_offset : null,
    },
  };
}

// Authenticated Read API 3: GET /api/v1/prescriptions/:id/processing-status
export async function fetchProcessingStatus(
  prescriptionId: string,
  accessToken: string,
): Promise<ProcessingStatusResponse> {
  const data = await requestAuthenticatedJson<unknown>(
    `/api/v1/prescriptions/${prescriptionId}/processing-status`,
    accessToken,
  );
  const response = parseProcessingStatusResponse(data);
  if (!response) {
    throw new ApiError('The processing status service returned an unexpected response.', 502, 'response');
  }
  return response;
}

// Authenticated Write API: POST /api/v1/prescriptions/:id/process
export async function submitPrescriptionProcessing(
  prescriptionId: string,
  accessToken: string,
): Promise<ProcessingSubmissionResponse> {
  const data = await requestAuthenticatedJson<unknown>(
    `/api/v1/prescriptions/${prescriptionId}/process`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
  const response = parseProcessingSubmissionResponse(data);
  if (!response) {
    throw new ApiError('The processing submission service returned an unexpected response.', 502, 'response');
  }
  return response;
}

// Isolated data adapter for Prescription Analysis Results:
// If the dedicated endpoint is available on the server, it loads and verifies Contract v1 data.
// If the endpoint is not yet exposed (404/501), it safely returns unavailable without fabricating results.
export async function fetchPrescriptionAnalysisResult(
  prescriptionId: string,
  accessToken: string,
): Promise<AnalysisResultOutcome> {
  try {
    const data = await requestAuthenticatedJson<unknown>(
      `/api/v1/prescriptions/${prescriptionId}/results`,
      accessToken,
    );
    const parsed = parseContractV1AnalysisResult(data);
    if (parsed) {
      return { kind: 'available', result: parsed };
    }
    return {
      kind: 'unavailable',
      reason: 'The server response did not match the Contract v1 analysis schema.',
    };
  } catch (error) {
    if (error instanceof ApiError) {
      // 404 Not Found or 501 Not Implemented indicates the results read endpoint is not yet mounted on the backend
      if (error.status === 404 || error.status === 501) {
        return {
          kind: 'unavailable',
          reason: 'Prescription analysis results read endpoint (/api/v1/prescriptions/:id/results) is not yet available on this server.',
        };
      }
      // Bubble up authentication or severe network errors so caller can handle auth/offline states
      if (error.status === 401 || error.kind === 'network') {
        throw error;
      }
    }
    return {
      kind: 'unavailable',
      reason: 'Prescription analysis results are not currently accessible from the backend.',
    };
  }
}
