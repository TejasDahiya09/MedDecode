import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueMedicineDetail } from '../../src/features/catalogue/medicine-catalogue-api';
import * as catalogueApi from '../../src/features/catalogue/medicine-catalogue-api';
import type { ContractV1MedicineItem } from '../../src/features/prescriptions/prescription-api';
import { VerifiedAlternativesSection } from '../../src/features/prescriptions/VerifiedAlternativesSection';

const originalId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';
const originalIdentity = {
  salt_identity: 'Paracetamol',
  administration_route: 'oral',
  release_characteristics: 'immediate release',
  product_id: 'product-a',
  manufacturer_id: 'manufacturer-a',
  manufacturer_name: 'Manufacturer A',
  source_record_id: 'NLEM:2.1.5:f1',
};
const candidateIdentity = {
  ...originalIdentity,
  product_id: 'product-b',
  manufacturer_id: 'manufacturer-b',
  manufacturer_name: 'Manufacturer B',
  source_record_id: 'NLEM:2.1.5:f2',
};

function detail(id: string, name: string, strengthValue = 500): CatalogueMedicineDetail {
  return {
    id,
    canonical_name: name,
    generic_name: 'Paracetamol',
    brand_name: null,
    dosage_form: 'Tablet',
    strength_value: strengthValue,
    strength_unit: 'mg',
    manufacturer_name: null,
    catalogue_source: 'official_catalogue',
    id_namespace: 'official_catalogue.formulation_id',
    ingredients: [{ name: 'Paracetamol', strength_value: strengthValue, strength_unit: 'mg' }],
    aliases: [],
    sources: ['mohfw_india_nlem_2022'],
    prices: [],
    formulation_identity: id === originalId ? originalIdentity : candidateIdentity,
  };
}

function medicine(alternatives: NonNullable<ContractV1MedicineItem['alternatives']>): ContractV1MedicineItem {
  return {
    sequence_number: 1,
    extraction: {
      raw_text: 'Paracetamol 500 mg tablet',
      medicine_name: 'Paracetamol',
      medicine_name_normalized: 'paracetamol',
      strength: { value: 500, unit: 'mg' },
      dosage_form: 'tablet',
      frequency: { type: 'unknown' },
      duration: { value: null, unit: null },
      quantity: { value: null, unit: null },
      instructions: null,
    },
    confidence: {},
    medicine_match: {
      status: 'matched',
      confidence: 1,
      medicine_external_id: `official_catalogue:${originalId}`,
      brand_name: null,
      dosage_form: 'Tablet',
      ingredients: [{ name: 'Paracetamol', strength_value: 500, strength_unit: 'mg' }],
      formulation_identity: originalIdentity,
    },
    alternatives,
    derived: { units_per_day: null, estimated_total_units: null },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VerifiedAlternativesSection', () => {
  it('shows the accurate empty state when the result contains no catalogue candidates', async () => {
    const fetchDetail = vi.spyOn(catalogueApi, 'fetchMedicineCatalogueDetail');
    render(
      <MemoryRouter>
        <VerifiedAlternativesSection medicine={medicine([])} accessToken="token" />
      </MemoryRouter>,
    );

    expect(await screen.findByText('No verified same-formulation alternatives are available in the current medicine catalogue.')).toBeTruthy();
    expect(fetchDetail).not.toHaveBeenCalled();
  });

  it('independently verifies source details before rendering navigation actions', async () => {
    vi.spyOn(catalogueApi, 'fetchMedicineCatalogueDetail').mockImplementation(async (id) => {
      return id === originalId
        ? detail(originalId, 'PARACETAMOL 500 MG TABLET A')
        : detail(candidateId, 'PARACETAMOL 500 MG TABLET B');
    });
    const item = medicine([{
      medicine_external_id: `official_catalogue:${candidateId}`,
      brand_name: 'Ignored candidate-provided brand',
      match_basis: {
        ingredient_equivalence: true,
        strength_compatibility: true,
        dosage_form_compatibility: true,
      },
      confidence: 1,
    }]);

    render(
      <MemoryRouter>
        <VerifiedAlternativesSection medicine={item} accessToken="token" />
      </MemoryRouter>,
    );

    expect(await screen.findByText('PARACETAMOL 500 MG TABLET B')).toBeTruthy();
    expect(screen.getByText('Manufacturer B')).toBeTruthy();
    expect(screen.getByText(/source record NLEM:2\.1\.5:f2/)).toBeTruthy();
    const compareLink = screen.getByRole('link', { name: 'Compare reference fields' });
    expect(compareLink.getAttribute('href')).toBe(
      `/compare-medicines?a=${originalId}&b=${candidateId}&source=official_catalogue`,
    );
    expect(screen.getByRole('link', { name: 'View source details' }).getAttribute('href')).toContain(`detail=${candidateId}`);
    expect(screen.queryByText('Ignored candidate-provided brand')).toBeNull();
  });

  it('withholds conflicting catalogue details', async () => {
    vi.spyOn(catalogueApi, 'fetchMedicineCatalogueDetail').mockImplementation(async (id) => {
      if (id === originalId) return detail(originalId, 'PARACETAMOL 500 MG TABLET A');
      return detail(candidateId, 'PARACETAMOL 650 MG TABLET B', 650);
    });
    render(
      <MemoryRouter>
        <VerifiedAlternativesSection
          medicine={medicine([{
            medicine_external_id: `official_catalogue:${candidateId}`,
            brand_name: 'Untrusted label',
            match_basis: {
              ingredient_equivalence: true,
              strength_compatibility: true,
              dosage_form_compatibility: true,
            },
            confidence: 1,
          }])}
          accessToken="token"
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('The proposed records did not have sufficient matching evidence. No alternative is shown.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Compare reference fields' })).toBeNull();
  });

  it('does not request catalogue details when structured formulation identity is absent', async () => {
    const fetchDetail = vi.spyOn(catalogueApi, 'fetchMedicineCatalogueDetail');
    const item = medicine([{
      medicine_external_id: `official_catalogue:${candidateId}`,
      brand_name: 'Untrusted label',
      match_basis: {
        ingredient_equivalence: true,
        strength_compatibility: true,
        dosage_form_compatibility: true,
      },
      confidence: 1,
    }]);
    render(
      <MemoryRouter>
        <VerifiedAlternativesSection
          medicine={{
            ...item,
            medicine_match: { ...item.medicine_match, formulation_identity: null },
          }}
          accessToken="token"
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Insufficient evidence to assess same-formulation alternatives.')).toBeTruthy();
    expect(fetchDetail).not.toHaveBeenCalled();
  });

  it('surfaces a catalogue failure and retries the original source lookup', async () => {
    const fetchDetail = vi.spyOn(catalogueApi, 'fetchMedicineCatalogueDetail')
      .mockRejectedValue(new Error('catalogue unavailable'));
    render(
      <MemoryRouter>
        <VerifiedAlternativesSection
          medicine={medicine([{
            medicine_external_id: `official_catalogue:${candidateId}`,
            brand_name: 'Untrusted label',
            match_basis: {
              ingredient_equivalence: true,
              strength_compatibility: true,
              dosage_form_compatibility: true,
            },
            confidence: 1,
          }])}
          accessToken="token"
        />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry verification' });
    fireEvent.click(retry);
    await waitFor(() => expect(fetchDetail).toHaveBeenCalledTimes(2));
  });
});
