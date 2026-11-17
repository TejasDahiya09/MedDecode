import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPrescriptionAnalysisResult,
  fetchPrescriptionDetail,
  fetchPrescriptionHistory,
  fetchProcessingStatus,
  parseContractV1AnalysisResult,
  parsePrescriptionHistoryItem,
  parseProcessingStatusResponse,
  parseProcessingSubmissionResponse,
  submitPrescriptionProcessing,
  type ContractV1AnalysisResult,
} from '../../src/features/prescriptions/prescription-api';
import { testSession } from './auth-test-client';

const validUUID = '10000000-0000-4000-8000-000000000001';
const validJobId = '20000000-0000-4000-8000-000000000002';

const validContractResult: ContractV1AnalysisResult = {
  schema_version: '1.0',
  job_id: validJobId,
  prescription_id: validUUID,
  status: 'completed_with_warnings',
  prescription: {
    prescription_date: '2026-11-10',
    doctor: { name: 'Dr. Sarah Smith', registration_number: 'MED-12345' },
    facility: { name: 'City Hospital', phone: '+1-555-0100' },
  },
  patient: { name: 'John Doe', age: 45, gender: 'Male' },
  medicines: [
    {
      sequence_number: 1,
      extraction: {
        raw_text: 'Amoxicillin 500mg capsules',
        medicine_name: 'Amoxicillin',
        medicine_name_normalized: 'amoxicillin',
        strength: { value: 500, unit: 'mg' },
        dosage_form: 'capsule',
        frequency: { type: 'scheduled', times_per_day: 3 },
        timing: 'after meals',
        duration: { value: 7, unit: 'days' },
        quantity: { value: 21, unit: 'capsules' },
        instructions: 'Complete full course',
      },
      confidence: { extraction: 0.95, medicine_name: 0.98 },
      medicine_match: {
        status: 'matched',
        confidence: 0.97,
        medicine_external_id: 'catalog-123',
        brand_name: 'Amoxil',
        dosage_form: 'capsule',
        ingredients: [{ name: 'amoxicillin', strength_value: 500, strength_unit: 'mg' }],
      },
      alternatives: [],
      derived: { units_per_day: 3, estimated_total_units: 21 },
    },
  ],
  recommendations: [],
  warnings: [
    {
      code: 'LOW_OCR_CONFIDENCE',
      severity: 'medium',
      message: 'Partial handwriting ambiguity on line 1.',
      related_medicine_sequence_number: 1,
    },
  ],
  processing_metadata: {
    overall_confidence: 0.78,
    dataset_version: '2026.11',
    model_version: 'meddecode-ocr-1.0',
  },
};

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/backend');
});

describe('prescription API contracts and parsing', () => {
  it('parses valid prescription history items and rejects malformed items', () => {
    const valid = {
      id: validUUID,
      file_type: 'application/pdf',
      file_size_bytes: '1024',
      status: 'uploaded',
      prescription_date: '2026-11-10',
      created_at: '2026-11-10T10:00:00Z',
      updated_at: '2026-11-10T10:00:00Z',
      processed_at: null,
    };
    expect(parsePrescriptionHistoryItem(valid)).toEqual(valid);
    expect(parsePrescriptionHistoryItem({ ...valid, id: 'invalid-id' })).toBeNull();
    expect(parsePrescriptionHistoryItem({ ...valid, status: 'unknown-status' })).toBeNull();
    expect(parsePrescriptionHistoryItem(null)).toBeNull();
  });

  it('parses processing status response across lifecycle states', () => {
    const noneJob = { prescription_id: validUUID, processing: null };
    expect(parseProcessingStatusResponse(noneJob)).toEqual(noneJob);

    for (const status of ['queued', 'processing', 'completed', 'failed', 'cancelled'] as const) {
      const activeJob = {
        prescription_id: validUUID,
        processing: {
          job_id: validJobId,
          status,
          created_at: '2026-11-10T10:00:00Z',
          started_at: status === 'queued' || status === 'cancelled' ? null : '2026-11-10T10:01:00Z',
          completed_at: status === 'completed' || status === 'failed' || status === 'cancelled' ? '2026-11-10T10:02:00Z' : null,
        },
      };
      expect(parseProcessingStatusResponse(activeJob)).toEqual(activeJob);
    }

    expect(parseProcessingStatusResponse({ prescription_id: validUUID, processing: { job_id: 'bad' } })).toBeNull();
  });

  it('parses processing submission responses', () => {
    const submission = {
      prescription_id: validUUID,
      job: { id: validJobId, status: 'queued', created_at: '2026-11-10T10:00:00Z' },
      submission: { created: true },
    };
    expect(parseProcessingSubmissionResponse(submission)).toEqual(submission);
    expect(parseProcessingSubmissionResponse({ ...submission, job: { ...submission.job, status: 'failed' } })).toBeNull();
  });

  it('validates Contract v1 analysis result and rejects invalid schemas', () => {
    expect(parseContractV1AnalysisResult(validContractResult)).toEqual(validContractResult);

    expect(parseContractV1AnalysisResult({ ...validContractResult, schema_version: '2.0' })).toBeNull();
    expect(parseContractV1AnalysisResult({ ...validContractResult, medicines: 'not-an-array' })).toBeNull();
    expect(parseContractV1AnalysisResult({ ...validContractResult, status: 'failed' })).toBeNull();
  });

  it('preserves complete structured formulation identity and fails closed on partial identity', () => {
    const identity = {
      salt_identity: 'Amoxicillin trihydrate',
      administration_route: 'oral',
      release_characteristics: 'immediate release',
      product_id: 'product-1',
      manufacturer_id: 'manufacturer-1',
      manufacturer_name: 'Manufacturer One',
      source_record_id: 'source-record-1',
    };
    const withCompleteIdentity: ContractV1AnalysisResult = {
      ...validContractResult,
      medicines: validContractResult.medicines.map((item) => ({
        ...item,
        medicine_match: { ...item.medicine_match, formulation_identity: identity },
      })),
    };
    expect(parseContractV1AnalysisResult(withCompleteIdentity)).toEqual(withCompleteIdentity);

    const withPartialIdentity = {
      ...withCompleteIdentity,
      medicines: withCompleteIdentity.medicines.map((item) => ({
        ...item,
        medicine_match: {
          ...item.medicine_match,
          formulation_identity: { ...identity, source_record_id: '' },
        },
      })),
    };
    expect(parseContractV1AnalysisResult(withPartialIdentity)?.medicines[0]?.medicine_match.formulation_identity).toBeNull();
  });
});

describe('prescription API transport and results endpoint', () => {
  it('fetchPrescriptionDetail calls /api/v1/prescriptions/:id with bearer auth', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          prescription: {
            id: validUUID,
            file_type: 'application/pdf',
            file_size_bytes: '2048',
            status: 'queued',
            prescription_date: null,
            created_at: '2026-11-10T10:00:00Z',
            updated_at: '2026-11-10T10:00:00Z',
            processed_at: null,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPrescriptionDetail(validUUID, testSession.access_token);
    expect(result.id).toBe(validUUID);
    expect(result.status).toBe('queued');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${window.location.origin}/api/v1/prescriptions/${validUUID}`);
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${testSession.access_token}`);
  });

  it('fetchProcessingStatus calls /api/v1/prescriptions/:id/processing-status', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          prescription_id: validUUID,
          processing: {
            job_id: validJobId,
            status: 'processing',
            created_at: '2026-11-10T10:00:00Z',
            started_at: '2026-11-10T10:01:00Z',
            completed_at: null,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchProcessingStatus(validUUID, testSession.access_token);
    expect(result.processing?.status).toBe('processing');
    expect(result.processing?.job_id).toBe(validJobId);
  });

  it('submitPrescriptionProcessing sends empty JSON body to /process', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          prescription_id: validUUID,
          job: { id: validJobId, status: 'queued', created_at: '2026-11-10T10:00:00Z' },
          submission: { created: true },
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitPrescriptionProcessing(validUUID, testSession.access_token);
    expect(result.job.id).toBe(validJobId);
    expect(result.submission.created).toBe(true);

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
  });

  it('fetchPrescriptionHistory calls /api/v1/prescriptions with bearer auth', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: validUUID,
              file_type: 'application/pdf',
              file_size_bytes: '1024',
              status: 'uploaded',
              prescription_date: null,
              created_at: '2026-11-10T10:00:00Z',
              updated_at: '2026-11-10T10:00:00Z',
              processed_at: null,
            },
          ],
          pagination: { limit: 20, offset: 0, returned: 1, has_more: false, next_offset: null },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const page = await fetchPrescriptionHistory(testSession.access_token);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(validUUID);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${window.location.origin}/api/v1/prescriptions`);
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${testSession.access_token}`);
  });

  it('fetchPrescriptionAnalysisResult returns unavailable on 404 without fabricating data', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: 'Endpoint not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await fetchPrescriptionAnalysisResult(validUUID, testSession.access_token);
    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind === 'unavailable') {
      expect(outcome.reason).toContain('No completed analysis result');
    }
  });

  it('fetchPrescriptionAnalysisResult returns verified Contract v1 result when available', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(validContractResult), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await fetchPrescriptionAnalysisResult(validUUID, testSession.access_token);
    expect(outcome.kind).toBe('available');
    if (outcome.kind === 'available') {
      expect(outcome.result.status).toBe('completed_with_warnings');
      expect(outcome.result.medicines).toHaveLength(1);
      expect(outcome.result.medicines[0]?.extraction.medicine_name).toBe('Amoxicillin');
    }
  });

  it('fetchPrescriptionAnalysisResult identifies an expired session', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await fetchPrescriptionAnalysisResult(validUUID, testSession.access_token);
    expect(outcome).toEqual({
      kind: 'unauthorized',
      reason: 'Sign in again to view this prescription result.',
    });
  });

  it('returns a retryable result error for service failures', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPrescriptionAnalysisResult(validUUID, testSession.access_token)).resolves.toEqual({
      kind: 'error',
      reason: 'The results service could not load this analysis. Please retry.',
      retryable: true,
    });
  });

  it('rejects a result correlated to a different prescription', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        ...validContractResult,
        prescription_id: '10000000-0000-4000-8000-000000000099',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPrescriptionAnalysisResult(validUUID, testSession.access_token)).resolves.toMatchObject({
      kind: 'error',
      retryable: false,
    });
  });

  it('correctly handles genuine Contract v1 outputs with stringified numbers and normalizes image/jpg', () => {
    const stringifiedContract = {
      ...validContractResult,
      patient: { name: 'Priya Sharma', age: '34', gender: 'Female' },
      medicines: [
        {
          ...validContractResult.medicines[0],
          sequence_number: '1',
          extraction: {
            ...validContractResult.medicines[0]!.extraction,
            strength: { value: '625', unit: 'mg' },
            frequency: { type: 'scheduled', times_per_day: '2' },
          },
          medicine_match: {
            ...validContractResult.medicines[0]!.medicine_match,
            confidence: '0.96',
          },
        },
      ],
      processing_metadata: {
        ...validContractResult.processing_metadata,
        overall_confidence: '0.94',
      },
    };

    const parsed = parseContractV1AnalysisResult(stringifiedContract);
    expect(parsed).not.toBeNull();
    expect(parsed?.patient?.age).toBe(34);
    expect(parsed?.medicines[0]?.sequence_number).toBe(1);
    expect(parsed?.medicines[0]?.extraction.strength?.value).toBe(625);
    expect(parsed?.medicines[0]?.extraction.frequency.times_per_day).toBe(2);
    expect(parsed?.medicines[0]?.medicine_match.confidence).toBe(0.96);
    expect(parsed?.processing_metadata.overall_confidence).toBe(0.94);

    const historyItem = parsePrescriptionHistoryItem({
      id: validUUID,
      file_type: 'image/jpg',
      file_size_bytes: '124000',
      status: 'completed',
      prescription_date: '2026-11-12',
      created_at: '2026-11-12T10:00:00Z',
      updated_at: '2026-11-12T10:00:00Z',
      processed_at: '2026-11-12T10:01:00Z',
    });
    expect(historyItem).not.toBeNull();
    expect(historyItem?.file_type).toBe('image/jpeg');
  });
});
