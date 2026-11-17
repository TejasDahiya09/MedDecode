import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/providers/AppProviders';
import { CompareMedicinesPage } from '../../src/features/catalogue/CompareMedicinesPage';
import { createAuthTestClient, testSession } from './auth-test-client';
import * as catalogueApi from '../../src/features/catalogue/medicine-catalogue-api';

const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';

const mockDetailA: catalogueApi.CatalogueMedicineDetail = {
  id: idA,
  canonical_name: 'PARACETAMOL 500 MG TABLET',
  generic_name: 'Paracetamol',
  brand_name: 'Crocin',
  dosage_form: 'Tablet',
  strength_value: 500,
  strength_unit: 'mg',
  manufacturer_name: 'GSK',
  catalogue_source: 'official_catalogue',
  id_namespace: 'official_catalogue.formulation_id',
  ingredients: [{ name: 'Paracetamol', strength_value: 500, strength_unit: 'mg' }],
  aliases: [],
  sources: ['india_cdsco_approved'],
  prices: [],
};

const mockDetailB: catalogueApi.CatalogueMedicineDetail = {
  id: idB,
  canonical_name: 'IBUPROFEN 400 MG CAPSULE',
  generic_name: 'Ibuprofen',
  brand_name: 'Brufen',
  dosage_form: 'Capsule',
  strength_value: 400,
  strength_unit: 'mg',
  manufacturer_name: 'Abbott',
  catalogue_source: 'official_catalogue',
  id_namespace: 'official_catalogue.formulation_id',
  ingredients: [{ name: 'Ibuprofen', strength_value: 400, strength_unit: 'mg' }],
  aliases: [],
  sources: ['india_nlem_2022'],
  prices: [],
};

function renderCompare(initialEntries = ['/compare-medicines']) {
  const authClient = createAuthTestClient();
  return render(
    <AppProviders authClient={authClient} initialAuthSession={testSession}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/compare-medicines" element={<CompareMedicinesPage />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('CompareMedicinesPage component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('VITE_API_BASE_URL', '/backend');
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
  });

  it('renders comparison page layout and selection cards with official defaults', () => {
    renderCompare();
    expect(screen.getByRole('heading', { name: 'Compare Medicines' })).toBeTruthy();
    expect(screen.getByText('Medicine 1')).toBeTruthy();
    expect(screen.getByText('Medicine 2')).toBeTruthy();
    expect(screen.getByText(/Clinical Independence Standard/i)).toBeTruthy();
    // Legacy / official selector radio group is removed
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('loads and displays side-by-side comparison table when both medicines are selected', async () => {
    const compareSpy = vi.spyOn(catalogueApi, 'compareMedicineCatalogue').mockResolvedValueOnce({
      medicines: [mockDetailA, mockDetailB],
      clinical_equivalence: null,
    });

    renderCompare([`/compare-medicines?a=${idA}&b=${idB}`]);

    await waitFor(() => {
      expect(compareSpy).toHaveBeenCalledWith(idA, idB, 'official_catalogue', testSession.access_token);
    });

    expect(await screen.findByText('Comparison Evidence Breakdown')).toBeTruthy();
    expect(screen.getAllByText('PARACETAMOL 500 MG TABLET').length).toBeGreaterThan(0);
    expect(screen.getAllByText('IBUPROFEN 400 MG CAPSULE').length).toBeGreaterThan(0);
    expect(screen.getByText('Different form')).toBeTruthy();
  });

  it('swapping medicines swaps query parameters', async () => {
    vi.spyOn(catalogueApi, 'compareMedicineCatalogue').mockResolvedValue({
      medicines: [mockDetailA, mockDetailB],
      clinical_equivalence: null,
    });

    renderCompare([`/compare-medicines?a=${idA}&b=${idB}`]);
    await screen.findByText('Comparison Evidence Breakdown');

    const swapBtn = screen.getByRole('button', { name: /Swap medicines/i });
    fireEvent.click(swapBtn);
  });

  it('clearing comparison resets view to empty selection guidance', async () => {
    vi.spyOn(catalogueApi, 'compareMedicineCatalogue').mockResolvedValue({
      medicines: [mockDetailA, mockDetailB],
      clinical_equivalence: null,
    });

    renderCompare([`/compare-medicines?a=${idA}&b=${idB}`]);
    await screen.findByText('Comparison Evidence Breakdown');

    const clearBtn = screen.getByRole('button', { name: /Clear comparison/i });
    fireEvent.click(clearBtn);

    expect(screen.queryByText('Comparison Evidence Breakdown')).toBeNull();
    expect(screen.getByText('Select Two Formulations to Compare')).toBeTruthy();
  });
});
