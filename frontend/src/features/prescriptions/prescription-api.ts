import { ApiError, requestAuthenticatedJson } from '../../services/api-client';
import {
  parseCatalogueFormulationIdentity,
  type CatalogueFormulationIdentity,
} from '../catalogue/medicine-catalogue-api';

export type PrescriptionStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'
  | 'cancelled';

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
  readonly status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
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

export interface ContractV1Alternative {
  readonly medicine_external_id: string;
  readonly brand_name: string;
  readonly match_basis: {
    readonly ingredient_equivalence: boolean;
    readonly strength_compatibility: boolean;
    readonly dosage_form_compatibility: boolean;
  };
  readonly price?: {
    readonly value?: number | null;
    readonly currency?: string | null;
    readonly unit_description?: string | null;
  };
  readonly confidence: number;
  readonly note?: string | null;
}

export interface ContractV1Recommendation {
  readonly type: string;
  readonly title: string;
  readonly message: string;
  readonly related_medicine_sequence_number: number | null;
  readonly confidence: number | null;
}

export interface ContractV1MedicineMatch {
  readonly status: 'matched' | 'probable_match' | 'ambiguous' | 'unmatched' | 'not_attempted';
  readonly confidence: number | null;
  readonly medicine_external_id?: string | null;
  readonly brand_name?: string | null;
  readonly dosage_form?: string | null;
  readonly ingredients?: readonly ContractV1Ingredient[];
  readonly formulation_identity?: CatalogueFormulationIdentity | null;
}

export interface ContractV1MedicineItem {
  readonly sequence_number: number;
  readonly extraction: ContractV1MedicineExtraction;
  readonly confidence?: Readonly<Record<string, number | null | undefined>>;
  readonly medicine_match: ContractV1MedicineMatch;
  readonly alternatives?: readonly ContractV1Alternative[];
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
  readonly recommendations?: readonly ContractV1Recommendation[];
  readonly warnings: readonly ContractV1WarningItem[];
  readonly processing_metadata: ContractV1ProcessingMetadata;
}

export type AnalysisResultOutcome =
  | { readonly kind: 'available'; readonly result: ContractV1AnalysisResult }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string; readonly retryable: boolean }
  | { readonly kind: 'unauthorized'; readonly reason: string };

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
  'cancelled',
]);

export function parsePrescriptionHistoryItem(value: unknown): PrescriptionHistoryItem | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || !uuidPattern.test(value.id)) return null;
  const rawType = String(value.file_type).toLowerCase();
  const fileType = rawType === 'image/jpg' ? 'image/jpeg' : rawType;
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(fileType)) return null;
  if (!validStatuses.has(value.status as PrescriptionStatus)) return null;
  if (typeof value.created_at !== 'string' || typeof value.updated_at !== 'string') return null;

  return {
    id: value.id,
    file_type: fileType as PrescriptionFileType,
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
  if (!['queued', 'processing', 'completed', 'failed', 'cancelled'].includes(String(proc.status))) return null;
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

function parseNumeric(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const num = Number(val);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function parseConfidence(val: unknown): number | null | undefined {
  if (val === null) return null;
  const parsed = parseNumeric(val);
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : undefined;
}

function parseValueUnit(value: unknown): ContractV1ValueUnit | null {
  if (!isObject(value)) return null;
  const parsedValue = value.value === null ? null : parseNumeric(value.value);
  if (parsedValue === null && value.value !== null) return null;
  if (value.unit !== null && typeof value.unit !== 'string') return null;
  return { value: parsedValue, unit: value.unit as string | null };
}

export function parseContractV1AnalysisResult(value: unknown): ContractV1AnalysisResult | null {
  if (!isObject(value)) return null;
  if (value.schema_version !== '1.0') return null;
  if (typeof value.job_id !== 'string' || !uuidPattern.test(value.job_id)) return null;
  if (typeof value.prescription_id !== 'string' || !uuidPattern.test(value.prescription_id)) return null;
  if (value.status !== 'completed' && value.status !== 'completed_with_warnings') return null;
  if (
    (value.prescription !== undefined && !isObject(value.prescription))
    || (value.patient !== undefined && !isObject(value.patient))
    || !Array.isArray(value.medicines)
    || (value.recommendations !== undefined && !Array.isArray(value.recommendations))
    || !Array.isArray(value.warnings)
    || !isObject(value.processing_metadata)
  ) return null;
  const overallConfidence = parseConfidence(value.processing_metadata.overall_confidence);
  if (overallConfidence === undefined) return null;

  const medicines: ContractV1MedicineItem[] = [];
  for (const item of value.medicines) {
    if (!isObject(item)) return null;
    const seq = parseNumeric(item.sequence_number);
    if (seq === null || !Number.isInteger(seq) || seq < 1) return null;
    if (!isObject(item.extraction) || typeof item.extraction.raw_text !== 'string') return null;
    if (!isObject(item.medicine_match)) return null;

    const ext = item.extraction;
    const match = item.medicine_match;
    if (!isObject(ext.frequency) || !isObject(item.confidence) || !isObject(item.derived)) return null;
    const freq = ext.frequency;
    if (!['scheduled', 'as_needed', 'unknown'].includes(String(freq.type))) return null;
    const duration = parseValueUnit(ext.duration);
    const quantity = parseValueUnit(ext.quantity);
    if (!duration || !quantity) return null;
    const matchConfidence = parseConfidence(match.confidence);
    if (matchConfidence === undefined) return null;
    if (!['matched', 'probable_match', 'ambiguous', 'unmatched', 'not_attempted'].includes(String(match.status))) return null;
    if (
      (typeof match.medicine_external_id !== 'string' && match.medicine_external_id !== null)
      || (typeof match.brand_name !== 'string' && match.brand_name !== null)
      || (typeof match.dosage_form !== 'string' && match.dosage_form !== null)
      || !Array.isArray(match.ingredients)
      || !Array.isArray(item.alternatives)
    ) return null;
    const formulationIdentity = match.formulation_identity === undefined
      ? undefined
      : parseCatalogueFormulationIdentity(match.formulation_identity);

    const confidence: Record<string, number | null> = {};
    for (const [key, rawConfidence] of Object.entries(item.confidence)) {
      const parsed = parseConfidence(rawConfidence);
      if (parsed === undefined) return null;
      confidence[key] = parsed;
    }

    const ingredients: ContractV1Ingredient[] = [];
    for (const ingredient of match.ingredients) {
      if (!isObject(ingredient) || typeof ingredient.name !== 'string') return null;
      const strengthValue = parseNumeric(ingredient.strength_value);
      if (strengthValue === null || typeof ingredient.strength_unit !== 'string') return null;
      ingredients.push({
        name: ingredient.name,
        strength_value: strengthValue,
        strength_unit: ingredient.strength_unit,
      });
    }

    const alternatives: ContractV1Alternative[] = [];
    for (const alternative of item.alternatives) {
      if (
        !isObject(alternative)
        || typeof alternative.medicine_external_id !== 'string'
        || typeof alternative.brand_name !== 'string'
        || !isObject(alternative.match_basis)
      ) return null;
      const basis = alternative.match_basis;
      if (
        typeof basis.ingredient_equivalence !== 'boolean'
        || typeof basis.strength_compatibility !== 'boolean'
        || typeof basis.dosage_form_compatibility !== 'boolean'
      ) return null;
      const alternativeConfidence = parseConfidence(alternative.confidence);
      if (alternativeConfidence === null || alternativeConfidence === undefined) return null;
      let price: ContractV1Alternative['price'];
      if (alternative.price !== undefined) {
        if (!isObject(alternative.price)) return null;
        const priceValue = alternative.price.value === undefined
          ? undefined
          : alternative.price.value === null
            ? null
            : parseNumeric(alternative.price.value);
        if (
          priceValue === undefined && alternative.price.value !== undefined
          || (alternative.price.value !== undefined && alternative.price.value !== null && priceValue === null)
          || (alternative.price.currency !== undefined && alternative.price.currency !== null && typeof alternative.price.currency !== 'string')
          || (alternative.price.unit_description !== undefined && alternative.price.unit_description !== null && typeof alternative.price.unit_description !== 'string')
        ) return null;
        price = {
          ...(alternative.price.value !== undefined ? { value: priceValue } : {}),
          ...(alternative.price.currency !== undefined ? { currency: alternative.price.currency as string | null } : {}),
          ...(alternative.price.unit_description !== undefined ? { unit_description: alternative.price.unit_description as string | null } : {}),
        };
      }
      if (alternative.note !== undefined && alternative.note !== null && typeof alternative.note !== 'string') return null;
      alternatives.push({
        medicine_external_id: alternative.medicine_external_id,
        brand_name: alternative.brand_name,
        match_basis: {
          ingredient_equivalence: basis.ingredient_equivalence,
          strength_compatibility: basis.strength_compatibility,
          dosage_form_compatibility: basis.dosage_form_compatibility,
        },
        ...(price ? { price } : {}),
        confidence: alternativeConfidence,
        ...(alternative.note !== undefined ? { note: alternative.note } : {}),
      });
    }

    const unitsPerDay = item.derived.units_per_day === null
      ? null
      : parseNumeric(item.derived.units_per_day);
    const estimatedTotalUnits = item.derived.estimated_total_units === null
      ? null
      : parseNumeric(item.derived.estimated_total_units);
    if (
      (unitsPerDay === null && item.derived.units_per_day !== null)
      || (estimatedTotalUnits === null && item.derived.estimated_total_units !== null)
    ) return null;

    medicines.push({
      sequence_number: seq,
      extraction: {
        raw_text: ext.raw_text as string,
        medicine_name: typeof ext.medicine_name === 'string' || ext.medicine_name === null ? ext.medicine_name : null,
        medicine_name_normalized: typeof ext.medicine_name_normalized === 'string' || ext.medicine_name_normalized === null ? ext.medicine_name_normalized : null,
        strength: isObject(ext.strength)
          ? {
              value: parseNumeric(ext.strength.value),
              unit: typeof ext.strength.unit === 'string' || ext.strength.unit === null ? ext.strength.unit : null,
            }
          : undefined,
        dosage_form: typeof ext.dosage_form === 'string' || ext.dosage_form === null ? ext.dosage_form : null,
        frequency: {
          type: freq.type as ContractV1Frequency['type'],
          ...(freq.morning !== undefined ? { morning: parseNumeric(freq.morning) } : {}),
          ...(freq.afternoon !== undefined ? { afternoon: parseNumeric(freq.afternoon) } : {}),
          ...(freq.night !== undefined ? { night: parseNumeric(freq.night) } : {}),
          ...(freq.times_per_day !== undefined ? { times_per_day: parseNumeric(freq.times_per_day) } : {}),
        },
        timing: typeof ext.timing === 'string' || ext.timing === null ? ext.timing : null,
        duration,
        quantity,
        instructions: typeof ext.instructions === 'string' || ext.instructions === null ? ext.instructions : null,
      },
      confidence,
      medicine_match: {
        status: match.status as ContractV1MedicineMatch['status'],
        confidence: matchConfidence,
        ...(match.medicine_external_id !== undefined ? { medicine_external_id: typeof match.medicine_external_id === 'string' || match.medicine_external_id === null ? match.medicine_external_id : undefined } : {}),
        ...(match.brand_name !== undefined ? { brand_name: typeof match.brand_name === 'string' || match.brand_name === null ? match.brand_name : undefined } : {}),
        ...(match.dosage_form !== undefined ? { dosage_form: typeof match.dosage_form === 'string' || match.dosage_form === null ? match.dosage_form : undefined } : {}),
        ingredients,
        ...(match.formulation_identity !== undefined ? { formulation_identity: formulationIdentity } : {}),
      },
      alternatives,
      derived: {
        units_per_day: unitsPerDay,
        estimated_total_units: estimatedTotalUnits,
      },
    });
  }

  let recommendations: ContractV1Recommendation[] | undefined;
  if (Array.isArray(value.recommendations)) {
    recommendations = [];
    for (const recommendation of value.recommendations) {
      if (!isObject(recommendation) || typeof recommendation.type !== 'string' || typeof recommendation.title !== 'string' || typeof recommendation.message !== 'string') return null;
      const related = recommendation.related_medicine_sequence_number;
      const relatedSequence = related === null ? null : parseNumeric(related);
      if (related !== null && (relatedSequence === null || !Number.isInteger(relatedSequence) || relatedSequence < 1)) return null;
      const recommendationConfidence = parseConfidence(recommendation.confidence);
      if (recommendationConfidence === undefined) return null;
      recommendations.push({
        type: recommendation.type,
        title: recommendation.title,
        message: recommendation.message,
        related_medicine_sequence_number: relatedSequence,
        confidence: recommendationConfidence,
      });
    }
  }

  const warnings: ContractV1WarningItem[] = [];
  for (const item of value.warnings) {
    if (!isObject(item)) return null;
    if (typeof item.code !== 'string' || typeof item.message !== 'string') return null;
    if (!['info', 'low', 'medium', 'high'].includes(String(item.severity))) return null;
    const related = item.related_medicine_sequence_number;
    const relatedSequence = related === null ? null : parseNumeric(related);
    if (related !== null && (relatedSequence === null || !Number.isInteger(relatedSequence) || relatedSequence < 1)) return null;

    warnings.push({
      code: item.code,
      message: item.message,
      severity: item.severity as ContractV1WarningItem['severity'],
      related_medicine_sequence_number: relatedSequence,
    });
  }

  const meta = value.processing_metadata;
  const processing_metadata: ContractV1ProcessingMetadata = {
    overall_confidence: overallConfidence,
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
            ...(fac.name !== undefined ? { name: typeof fac.name === 'string' || fac.name === null ? fac.name : undefined } : {}),
            ...(fac.address !== undefined ? { address: typeof fac.address === 'string' || fac.address === null ? fac.address : undefined } : {}),
            ...(fac.phone !== undefined ? { phone: typeof fac.phone === 'string' || fac.phone === null ? fac.phone : undefined } : {}),
          }
        : undefined,
    };
  }

  let patient: ContractV1PatientMetadata | undefined;
  if (isObject(value.patient)) {
    const pat = value.patient;
    patient = {
      name: typeof pat.name === 'string' || pat.name === null ? pat.name : null,
      age: parseNumeric(pat.age),
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
    recommendations,
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
  const path = '/api/v1/prescriptions';
  const init = pagination ? { params: { limit: pagination.limit ?? 20, offset: pagination.offset ?? 0 } } : {};
  const data = await requestAuthenticatedJson<Record<string, unknown>>(path, accessToken, init);
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

// Authenticated results route. A missing stored result never produces synthetic output.
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
    if (parsed && parsed.prescription_id === prescriptionId) {
      return { kind: 'available', result: parsed };
    }
    if (data === undefined || data === null) {
      return { kind: 'unavailable', reason: 'No analysis result is available yet.' };
    }
    return { kind: 'error', reason: 'The analysis result could not be validated.', retryable: false };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) {
        return {
          kind: 'unavailable',
          reason: 'No completed analysis result is available for this prescription yet.',
        };
      }
      if (error.status === 409) {
        return {
          kind: 'unavailable',
          reason: 'Analysis is still being completed. Refresh in a moment to check for results.',
        };
      }
      if (error.status === 401 || error.status === 403) {
        return { kind: 'unauthorized', reason: 'Sign in again to view this prescription result.' };
      }
      if (error.kind === 'network') {
        return { kind: 'error', reason: 'Could not reach the results service. Check your connection and retry.', retryable: true };
      }
      if (error.status !== null && error.status >= 500) {
        return { kind: 'error', reason: 'The results service could not load this analysis. Please retry.', retryable: true };
      }
      return { kind: 'error', reason: 'The results service could not load this analysis.', retryable: false };
    }
    return { kind: 'error', reason: 'The results service could not load this analysis.', retryable: false };
  }
}
