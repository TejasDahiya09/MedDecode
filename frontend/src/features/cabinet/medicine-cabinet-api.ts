import { ApiError, requestAuthenticatedJson } from '../../services/api-client';

export interface MedicineCabinetItem {
  readonly id: string;
  readonly medicine_id: string;
  readonly family_member_id?: string | null;
  readonly quantity: string | null;
  readonly purchase_date: string | null;
  readonly expiry_date: string | null;
  readonly refill_date: string | null;
  readonly usage_information: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MedicineCabinetPage {
  readonly items: readonly MedicineCabinetItem[];
  readonly pagination: {
    readonly limit: number;
    readonly offset: number;
    readonly returned: number;
    readonly has_more: boolean;
    readonly next_offset: number | null;
  };
}

type AuthenticatedTransport = (
  path: string,
  accessToken: string,
  init?: RequestInit,
) => Promise<unknown | undefined>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const decimalPattern = /^(0|[1-9]\d*)(\.\d+)?$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function parseItem(value: unknown): MedicineCabinetItem | null {
  if (!isObject(value)) return null;
  if (
    typeof value.id !== 'string' ||
    !uuidPattern.test(value.id) ||
    typeof value.medicine_id !== 'string' ||
    !uuidPattern.test(value.medicine_id) ||
    !(value.quantity === null || (typeof value.quantity === 'string' && decimalPattern.test(value.quantity))) ||
    !nullableString(value.purchase_date) ||
    !nullableString(value.expiry_date) ||
    !nullableString(value.refill_date) ||
    !nullableString(value.usage_information) ||
    typeof value.created_at !== 'string' ||
    typeof value.updated_at !== 'string'
  ) {
    return null;
  }
  const familyMemberId = 'family_member_id' in value && nullableString(value.family_member_id)
    ? value.family_member_id
    : null;
  return {
    id: value.id,
    medicine_id: value.medicine_id,
    family_member_id: familyMemberId,
    quantity: value.quantity,
    purchase_date: value.purchase_date,
    expiry_date: value.expiry_date,
    refill_date: value.refill_date,
    usage_information: value.usage_information,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function parsePage(value: unknown): MedicineCabinetPage | null {
  if (!isObject(value) || !Array.isArray(value.items) || !isObject(value.pagination)) return null;
  const items = value.items.map(parseItem);
  if (items.some((item) => item === null)) return null;
  const pagination = value.pagination;
  if (
    !Number.isSafeInteger(pagination.limit) ||
    !Number.isSafeInteger(pagination.offset) ||
    !Number.isSafeInteger(pagination.returned) ||
    pagination.returned !== items.length ||
    typeof pagination.has_more !== 'boolean' ||
    !(pagination.next_offset === null || Number.isSafeInteger(pagination.next_offset))
  ) {
    return null;
  }
  return {
    items: items as MedicineCabinetItem[],
    pagination: {
      limit: pagination.limit as number,
      offset: pagination.offset as number,
      returned: pagination.returned as number,
      has_more: pagination.has_more,
      next_offset: pagination.next_offset as number | null,
    },
  };
}

export async function fetchMedicineCabinet(
  accessToken: string,
  transport: AuthenticatedTransport = requestAuthenticatedJson,
): Promise<MedicineCabinetPage> {
  const data = await transport('/api/v1/medicine-cabinet', accessToken);
  const page = parsePage(data);
  if (!page) {
    throw new ApiError('The medicine cabinet service returned an unexpected response.', 502, 'response');
  }
  return page;
}

export interface CabinetFields {
  quantity: string | null;
  purchase_date: string | null;
  expiry_date: string | null;
  refill_date: string | null;
  usage_information: string | null;
}

async function writeEntry(path: string, method: 'POST' | 'PATCH', value: object, token: string): Promise<MedicineCabinetItem> {
  const data = await requestAuthenticatedJson<unknown>(path, token, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  const parsed = isObject(data) ? parseItem(data.entry) : null;
  if (!parsed) throw new ApiError('The medicine cabinet service returned an unexpected response.', 502, 'response');
  return parsed;
}

export function addMedicineCabinetEntry(medicineId: string, fields: CabinetFields, token: string): Promise<MedicineCabinetItem> {
  if (!uuidPattern.test(medicineId)) throw new ApiError('Choose a valid medicine.', 400);
  return writeEntry('/api/v1/medicine-cabinet', 'POST', { medicine_id: medicineId, ...fields }, token);
}

export function updateMedicineCabinetEntry(id: string, fields: CabinetFields, token: string): Promise<MedicineCabinetItem> {
  if (!uuidPattern.test(id)) throw new ApiError('Invalid cabinet entry.', 400);
  return writeEntry(`/api/v1/medicine-cabinet/${id}`, 'PATCH', fields, token);
}

export async function removeMedicineCabinetEntry(id: string, token: string): Promise<void> {
  if (!uuidPattern.test(id)) throw new ApiError('Invalid cabinet entry.', 400);
  await requestAuthenticatedJson(`/api/v1/medicine-cabinet/${id}`, token, { method: 'DELETE' });
}
