import { ApiError, requestAuthenticatedJson } from '../../services/api-client';

export type CatalogueSource = 'official_catalogue' | 'legacy';

export interface CatalogueIngredient {
  readonly name: string;
  readonly strength_value: number | string | null;
  readonly strength_unit: string | null;
}

export interface CatalogueFormulationIdentity {
  readonly salt_identity: string;
  readonly administration_route: string;
  readonly release_characteristics: string;
  readonly product_id: string;
  readonly manufacturer_id: string;
  readonly manufacturer_name: string;
  readonly source_record_id: string;
}

export interface CatalogueMedicineSummary {
  readonly id: string;
  readonly canonical_name: string;
  readonly generic_name: string | null;
  readonly brand_name: string | null;
  readonly dosage_form: string | null;
  readonly strength_value: number | string | null;
  readonly strength_unit: string | null;
  readonly manufacturer_name: string | null;
  readonly catalogue_source: CatalogueSource;
  readonly id_namespace: string;
  readonly sources?: readonly string[];
}

export interface CatalogueMedicineDetail extends CatalogueMedicineSummary {
  readonly ingredients: readonly CatalogueIngredient[];
  readonly aliases: readonly string[];
  readonly sources: readonly string[];
  readonly prices: readonly unknown[];
  readonly formulation_identity?: CatalogueFormulationIdentity | null;
}

export interface CataloguePagination {
  readonly limit: number;
  readonly offset: number;
  readonly has_more: boolean;
  readonly total?: number;
}

export interface CatalogueSearchResponse {
  readonly items: readonly CatalogueMedicineSummary[];
  readonly pagination: CataloguePagination;
}

export async function browseMedicineCatalogue(
  accessToken: string,
  offset: number,
  form?: string,
  signal?: AbortSignal,
): Promise<CatalogueSearchResponse & { total: number }> {
  const data = await requestAuthenticatedJson<unknown>('/api/v1/medicines/browse', accessToken, {
    params: { limit: 24, offset, form },
    ...(signal ? { signal } : {}),
  });
  const parsed = parseCatalogueSearchResponse(data, 'official_catalogue');
  if (!parsed || !isObject(data) || !isObject(data.pagination) || !Number.isSafeInteger(data.pagination.total) || (data.pagination.total as number) < 0) {
    throw new ApiError('The medicine catalogue service returned an unexpected response.', 502, 'response');
  }
  return { ...parsed, total: data.pagination.total as number };
}

export interface CatalogueCompareResponse {
  readonly medicines: readonly [CatalogueMedicineDetail, CatalogueMedicineDetail];
  readonly clinical_equivalence: null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEARCH_QUERY_PATTERN = /^[\p{L}\p{N} .+-]{2,80}$/u;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIngredient(value: unknown): CatalogueIngredient | null {
  if (!isObject(value) || typeof value.name !== 'string') return null;
  return {
    name: value.name,
    strength_value: typeof value.strength_value === 'number' || typeof value.strength_value === 'string'
      ? value.strength_value
      : null,
    strength_unit: typeof value.strength_unit === 'string' ? value.strength_unit : null,
  };
}

export function parseCatalogueFormulationIdentity(value: unknown): CatalogueFormulationIdentity | null {
  if (!isObject(value)) return null;
  const field = (name: keyof CatalogueFormulationIdentity): string | null => {
    const raw = value[name];
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  };
  const saltIdentity = field('salt_identity');
  const administrationRoute = field('administration_route');
  const releaseCharacteristics = field('release_characteristics');
  const productId = field('product_id');
  const manufacturerId = field('manufacturer_id');
  const manufacturerName = field('manufacturer_name');
  const sourceRecordId = field('source_record_id');
  if (
    !saltIdentity
    || !administrationRoute
    || !releaseCharacteristics
    || !productId
    || !manufacturerId
    || !manufacturerName
    || !sourceRecordId
  ) return null;
  return {
    salt_identity: saltIdentity,
    administration_route: administrationRoute,
    release_characteristics: releaseCharacteristics,
    product_id: productId,
    manufacturer_id: manufacturerId,
    manufacturer_name: manufacturerName,
    source_record_id: sourceRecordId,
  };
}

export function parseCatalogueMedicineSummary(value: unknown, fallbackSource: CatalogueSource = 'official_catalogue'): CatalogueMedicineSummary | null {
  if (!isObject(value) || typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)) return null;
  if (typeof value.canonical_name !== 'string' || !value.canonical_name.trim()) return null;

  const rawSource = value.catalogue_source;
  const catalogue_source: CatalogueSource = rawSource === 'legacy' ? 'legacy' : (rawSource === 'official_catalogue' ? 'official_catalogue' : fallbackSource);
  const id_namespace = typeof value.id_namespace === 'string'
    ? value.id_namespace
    : (catalogue_source === 'official_catalogue' ? 'official_catalogue.formulation_id' : 'public.medicines.id');

  return {
    id: value.id,
    canonical_name: value.canonical_name,
    generic_name: typeof value.generic_name === 'string' && value.generic_name.trim() ? value.generic_name : null,
    brand_name: typeof value.brand_name === 'string' && value.brand_name.trim() ? value.brand_name : null,
    dosage_form: typeof value.dosage_form === 'string' && value.dosage_form.trim() ? value.dosage_form : null,
    strength_value: typeof value.strength_value === 'number' || typeof value.strength_value === 'string'
      ? value.strength_value
      : null,
    strength_unit: typeof value.strength_unit === 'string' && value.strength_unit.trim() ? value.strength_unit : null,
    manufacturer_name: typeof value.manufacturer_name === 'string' && value.manufacturer_name.trim() ? value.manufacturer_name : null,
    catalogue_source,
    id_namespace,
    sources: Array.isArray(value.sources)
      ? value.sources.filter((source): source is string => typeof source === 'string')
      : [],
  };
}

export function parseCatalogueMedicineDetail(value: unknown, fallbackSource: CatalogueSource = 'official_catalogue'): CatalogueMedicineDetail | null {
  const summary = parseCatalogueMedicineSummary(value, fallbackSource);
  if (!summary || !isObject(value)) return null;

  const rawIngredients = Array.isArray(value.ingredients) ? value.ingredients : [];
  const ingredients: CatalogueIngredient[] = [];
  for (const item of rawIngredients) {
    const parsed = parseIngredient(item);
    if (parsed) ingredients.push(parsed);
  }

  const aliases = Array.isArray(value.aliases)
    ? value.aliases.filter((a): a is string => typeof a === 'string')
    : [];

  const sources = Array.isArray(value.sources)
    ? value.sources.filter((s): s is string => typeof s === 'string')
    : [];

  const prices = Array.isArray(value.prices) ? value.prices : [];

  return {
    ...summary,
    ingredients,
    aliases,
    sources,
    prices,
    formulation_identity: parseCatalogueFormulationIdentity(value.formulation_identity),
  };
}

export function parseCatalogueSearchResponse(value: unknown, source: CatalogueSource): CatalogueSearchResponse | null {
  if (!isObject(value) || !Array.isArray(value.items) || !isObject(value.pagination)) return null;
  const items: CatalogueMedicineSummary[] = [];
  for (const raw of value.items) {
    const parsed = parseCatalogueMedicineSummary(raw, source);
    if (!parsed) return null;
    items.push(parsed);
  }
  const pag = value.pagination;
  if (
    typeof pag.limit !== 'number' ||
    typeof pag.offset !== 'number' ||
    typeof pag.has_more !== 'boolean' ||
    (pag.total !== undefined && (!Number.isSafeInteger(pag.total) || (pag.total as number) < 0))
  ) {
    return null;
  }
  return {
    items,
    pagination: {
      limit: pag.limit,
      offset: pag.offset,
      has_more: pag.has_more,
      ...(typeof pag.total === 'number' ? { total: pag.total } : {}),
    },
  };
}

export interface SearchMedicineCatalogueOptions {
  readonly source?: CatalogueSource;
  readonly limit?: number;
  readonly offset?: number;
  readonly form?: string;
  readonly signal?: AbortSignal;
}

export async function searchMedicineCatalogue(
  query: string,
  options: SearchMedicineCatalogueOptions = {},
  accessToken: string,
): Promise<CatalogueSearchResponse> {
  const trimmed = query.trim();
  if (!SEARCH_QUERY_PATTERN.test(trimmed)) {
    throw new ApiError('Search query must be between 2 and 80 alphanumeric characters.', 400, 'http');
  }

  const source = options.source ?? 'official_catalogue';
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) {
    throw new ApiError('Search offset is outside the supported range.', 400, 'http');
  }

  const data = await requestAuthenticatedJson<unknown>(
    '/api/v1/medicines',
    accessToken,
    {
      params: {
        q: trimmed,
        limit,
        offset,
        source,
        ...(source === 'official_catalogue' && options.form ? { form: options.form } : {}),
      },
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );

  const response = parseCatalogueSearchResponse(data, source);
  if (!response) {
    throw new ApiError('The medicine catalogue service returned an unexpected response.', 502, 'response');
  }
  return response;
}

export async function fetchMedicineCatalogueDetail(
  id: string,
  source: CatalogueSource = 'official_catalogue',
  accessToken: string,
): Promise<CatalogueMedicineDetail> {
  if (!UUID_PATTERN.test(id)) {
    throw new ApiError('A valid medicine UUID is required.', 400, 'http');
  }

  const data = await requestAuthenticatedJson<{ medicine?: unknown }>(
    `/api/v1/medicines/${id}`,
    accessToken,
    {
      params: { source },
    },
  );

  if (!isObject(data) || !('medicine' in data)) {
    throw new ApiError('The medicine catalogue detail service returned an unexpected response.', 502, 'response');
  }

  const detail = parseCatalogueMedicineDetail(data.medicine, source);
  if (!detail) {
    throw new ApiError('The medicine record structure is invalid.', 502, 'response');
  }
  return detail;
}

export async function compareMedicineCatalogue(
  idA: string,
  idB: string,
  source: CatalogueSource = 'official_catalogue',
  accessToken: string,
): Promise<CatalogueCompareResponse> {
  if (!UUID_PATTERN.test(idA) || !UUID_PATTERN.test(idB)) {
    throw new ApiError('Two valid medicine UUIDs are required for comparison.', 400, 'http');
  }
  if (idA.toLowerCase() === idB.toLowerCase()) {
    throw new ApiError('Two different medicine UUIDs are required for comparison.', 400, 'http');
  }

  const data = await requestAuthenticatedJson<{ medicines?: unknown; clinical_equivalence?: unknown }>(
    '/api/v1/medicines/compare',
    accessToken,
    {
      params: {
        a: idA,
        b: idB,
        source,
      },
    },
  );

  if (!isObject(data) || !Array.isArray(data.medicines) || data.medicines.length !== 2) {
    throw new ApiError('The medicine comparison service returned an unexpected response.', 502, 'response');
  }

  const first = parseCatalogueMedicineDetail(data.medicines[0], source);
  const second = parseCatalogueMedicineDetail(data.medicines[1], source);

  if (!first || !second) {
    throw new ApiError('One or more comparison records failed validation.', 502, 'response');
  }

  return {
    medicines: [first, second],
    clinical_equivalence: null,
  };
}
