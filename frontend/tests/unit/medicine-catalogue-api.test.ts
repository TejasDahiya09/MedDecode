import { describe, expect, it, vi } from 'vitest';
import {
  parseCatalogueMedicineSummary,
  parseCatalogueMedicineDetail,
  parseCatalogueSearchResponse,
  searchMedicineCatalogue,
  browseMedicineCatalogue,
  fetchMedicineCatalogueDetail,
  compareMedicineCatalogue,
} from '../../src/features/catalogue/medicine-catalogue-api';
import * as apiClient from '../../src/services/api-client';

const validUUID = '11111111-1111-4111-8111-111111111111';
const validUUID2 = '22222222-2222-4222-8222-222222222222';

describe('medicine catalogue API contract and parsers', () => {
  it('parses valid official catalogue summary record', () => {
    const raw = {
      id: validUUID,
      canonical_name: 'PARACETAMOL 500 MG TABLET',
      generic_name: 'Paracetamol',
      brand_name: null,
      dosage_form: 'Tablet',
      strength_value: 500,
      strength_unit: 'mg',
      manufacturer_name: null,
      catalogue_source: 'official_catalogue',
      id_namespace: 'official_catalogue.formulation_id',
    };
    const parsed = parseCatalogueMedicineSummary(raw, 'official_catalogue');
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe(validUUID);
    expect(parsed?.canonical_name).toBe('PARACETAMOL 500 MG TABLET');
    expect(parsed?.strength_value).toBe(500);
    expect(parsed?.catalogue_source).toBe('official_catalogue');
  });

  it('parses combination medicine with null formulation strength but detailed ingredients', () => {
    const raw = {
      id: validUUID,
      canonical_name: 'AMOXICILLIN + CLAVULANIC ACID TABLET',
      generic_name: null,
      brand_name: 'Augmentin',
      dosage_form: 'Tablet',
      strength_value: null,
      strength_unit: null,
      manufacturer_name: null,
      catalogue_source: 'official_catalogue',
      id_namespace: 'official_catalogue.formulation_id',
      ingredients: [
        { name: 'Amoxicillin', strength_value: 500, strength_unit: 'mg' },
        { name: 'Clavulanic Acid', strength_value: 125, strength_unit: 'mg' },
      ],
      aliases: ['Augmentin 625'],
      sources: ['india_cdsco_approved'],
      prices: [],
    };
    const parsed = parseCatalogueMedicineDetail(raw, 'official_catalogue');
    expect(parsed).not.toBeNull();
    expect(parsed?.ingredients).toHaveLength(2);
    expect(parsed?.ingredients[0]?.name).toBe('Amoxicillin');
    expect(parsed?.ingredients[1]?.strength_value).toBe(125);
    expect(parsed?.prices).toEqual([]);
  });

  it('preserves formulation identity only when every required field is present', () => {
    const identity = {
      salt_identity: 'Paracetamol',
      administration_route: 'oral',
      release_characteristics: 'immediate release',
      product_id: 'product-1',
      manufacturer_id: 'manufacturer-1',
      manufacturer_name: 'Manufacturer One',
      source_record_id: 'source-record-1',
    };
    const complete = parseCatalogueMedicineDetail({
      id: validUUID,
      canonical_name: 'Paracetamol 500 mg tablet',
      ingredients: [],
      aliases: [],
      sources: ['mohfw_india_nlem_2022'],
      prices: [],
      formulation_identity: identity,
    });
    const incomplete = parseCatalogueMedicineDetail({
      id: validUUID,
      canonical_name: 'Paracetamol 500 mg tablet',
      ingredients: [],
      aliases: [],
      sources: ['mohfw_india_nlem_2022'],
      prices: [],
      formulation_identity: { ...identity, source_record_id: '' },
    });
    expect(complete?.formulation_identity).toEqual(identity);
    expect(incomplete?.formulation_identity).toBeNull();
  });

  it('rejects invalid UUID in summary parsing', () => {
    expect(parseCatalogueMedicineSummary({ id: 'not-a-uuid', canonical_name: 'Test' })).toBeNull();
  });

  it('rejects empty canonical name', () => {
    expect(parseCatalogueMedicineSummary({ id: validUUID, canonical_name: '   ' })).toBeNull();
  });

  it('parses full search response envelope', () => {
    const raw = {
      items: [
        {
          id: validUUID,
          canonical_name: 'PARACETAMOL 500 MG',
          dosage_form: 'Tablet',
          catalogue_source: 'official_catalogue',
        },
      ],
      pagination: {
        limit: 20,
        offset: 0,
        has_more: false,
      },
    };
    const parsed = parseCatalogueSearchResponse(raw, 'official_catalogue');
    expect(parsed).not.toBeNull();
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.pagination.has_more).toBe(false);
  });

  it('rejects a partial page instead of silently dropping malformed catalogue records', () => {
    const parsed = parseCatalogueSearchResponse({
      items: [
        { id: validUUID, canonical_name: 'PARACETAMOL 500 MG' },
        { id: 'invalid', canonical_name: 'A record the parser must not hide' },
      ],
      pagination: { limit: 20, offset: 0, total: 2, has_more: false },
    }, 'official_catalogue');
    expect(parsed).toBeNull();
  });

  it('searchMedicineCatalogue validates query constraints', async () => {
    await expect(searchMedicineCatalogue('a', {}, 'token')).rejects.toThrow('Search query must be between 2 and 80 alphanumeric characters');
    await expect(searchMedicineCatalogue('!@#$%', {}, 'token')).rejects.toThrow('Search query must be between 2 and 80 alphanumeric characters');
  });

  it('searchMedicineCatalogue calls requestAuthenticatedJson with proper query params', async () => {
    const spy = vi.spyOn(apiClient, 'requestAuthenticatedJson').mockResolvedValueOnce({
      items: [{ id: validUUID, canonical_name: 'Paracetamol 500mg' }],
      pagination: { limit: 20, offset: 0, has_more: false },
    });

    const res = await searchMedicineCatalogue('paracetamol', { source: 'official_catalogue', limit: 10, offset: 0 }, 'test-token');
    expect(spy).toHaveBeenCalledWith(
      '/api/v1/medicines',
      'test-token',
      {
        params: {
          q: 'paracetamol',
          limit: 10,
          offset: 0,
          source: 'official_catalogue',
        },
      },
    );
    expect(res.items).toHaveLength(1);
  });

  it('searchMedicineCatalogue sends supported form filters and allows server pagination', async () => {
    const spy = vi.spyOn(apiClient, 'requestAuthenticatedJson').mockResolvedValueOnce({
      items: [{ id: validUUID, canonical_name: 'Paracetamol 500mg' }],
      pagination: { limit: 24, offset: 48, total: 49, has_more: false },
    });
    const controller = new AbortController();
    const response = await searchMedicineCatalogue(
      'Paracetamol',
      { source: 'official_catalogue', limit: 24, offset: 48, form: 'Tablet', signal: controller.signal },
      'test-token',
    );
    expect(spy).toHaveBeenCalledWith('/api/v1/medicines', 'test-token', {
      params: { q: 'Paracetamol', limit: 24, offset: 48, source: 'official_catalogue', form: 'Tablet' },
      signal: controller.signal,
    });
    expect(response.pagination.total).toBe(49);
  });

  it('browses the official catalogue with bounded pagination and a cancellable request', async () => {
    const spy = vi.spyOn(apiClient, 'requestAuthenticatedJson').mockResolvedValueOnce({
      items: [{ id: validUUID, canonical_name: 'Paracetamol 500mg', sources: ['india_nlem_2022'] }],
      pagination: { limit: 24, offset: 24, total: 25, has_more: false },
    });
    const controller = new AbortController();
    const response = await browseMedicineCatalogue('test-token', 24, 'Tablet', controller.signal);
    expect(spy).toHaveBeenCalledWith('/api/v1/medicines/browse', 'test-token', {
      params: { limit: 24, offset: 24, form: 'Tablet' },
      signal: controller.signal,
    });
    expect(response.total).toBe(25);
    expect(response.items[0]?.sources).toEqual(['india_nlem_2022']);
  });

  it('fetchMedicineCatalogueDetail requires valid UUID and passes source', async () => {
    await expect(fetchMedicineCatalogueDetail('invalid-uuid', 'official_catalogue', 'token')).rejects.toThrow('A valid medicine UUID is required');

    const spy = vi.spyOn(apiClient, 'requestAuthenticatedJson').mockResolvedValueOnce({
      medicine: {
        id: validUUID,
        canonical_name: 'Paracetamol 500mg',
        ingredients: [],
        aliases: [],
        sources: [],
        prices: [],
      },
    });

    const detail = await fetchMedicineCatalogueDetail(validUUID, 'official_catalogue', 'test-token');
    expect(spy).toHaveBeenCalledWith(
      `/api/v1/medicines/${validUUID}`,
      'test-token',
      {
        params: { source: 'official_catalogue' },
      },
    );
    expect(detail.id).toBe(validUUID);
  });

  it('compareMedicineCatalogue rejects duplicate or invalid UUIDs', async () => {
    await expect(compareMedicineCatalogue('bad', validUUID2, 'official_catalogue', 'token')).rejects.toThrow('Two valid medicine UUIDs are required');
    await expect(compareMedicineCatalogue(validUUID, validUUID, 'official_catalogue', 'token')).rejects.toThrow('Two different medicine UUIDs are required');
  });

  it('compareMedicineCatalogue parses comparison response and preserves clinical_equivalence as null', async () => {
    vi.spyOn(apiClient, 'requestAuthenticatedJson').mockResolvedValueOnce({
      medicines: [
        { id: validUUID, canonical_name: 'Paracetamol 500mg', ingredients: [], aliases: [], sources: [], prices: [] },
        { id: validUUID2, canonical_name: 'Ibuprofen 400mg', ingredients: [], aliases: [], sources: [], prices: [] },
      ],
      clinical_equivalence: null,
    });

    const res = await compareMedicineCatalogue(validUUID, validUUID2, 'official_catalogue', 'test-token');
    expect(res.medicines).toHaveLength(2);
    expect(res.clinical_equivalence).toBeNull();
  });
});
