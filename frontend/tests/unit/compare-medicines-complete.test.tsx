import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/providers/AppProviders';
import { CompareMedicinesPage } from '../../src/features/catalogue/CompareMedicinesPage';
import { createAuthTestClient, testSession } from './auth-test-client';
import * as catalogueApi from '../../src/features/catalogue/medicine-catalogue-api';
import { ApiError } from '../../src/services/api-client';

const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
const idC = '33333333-3333-4333-8333-333333333333';

const longCombinationName = 'AMOXICILLIN TRIHYDRATE AND POTASSIUM CLAVULANATE 625 MG TABLETS IP WITH EXTENDED RELEASE';

const mockDetailA: catalogueApi.CatalogueMedicineDetail = {
  id: idA,
  canonical_name: longCombinationName,
  generic_name: 'Amoxicillin + Clavulanic Acid',
  brand_name: 'Augmentin 625 Duo',
  dosage_form: 'Tablet',
  strength_value: 625,
  strength_unit: 'mg',
  manufacturer_name: 'GlaxoSmithKline Pharmaceuticals Ltd',
  catalogue_source: 'official_catalogue',
  id_namespace: 'official_catalogue.formulation_id',
  ingredients: [
    { name: 'Amoxicillin Trihydrate', strength_value: 500, strength_unit: 'mg' },
    { name: 'Potassium Clavulanate', strength_value: 125, strength_unit: 'mg' },
  ],
  aliases: ['Augmentin', 'Amoxyclav'],
  sources: ['india_cdsco_approved', 'india_nlem_2022'],
  prices: [{ ceiling_price: 24.5, unit: 'tablet' }],
};

const mockDetailB: catalogueApi.CatalogueMedicineDetail = {
  id: idB,
  canonical_name: 'AZITHROMYCIN 500 MG TABLET IP',
  generic_name: 'Azithromycin',
  brand_name: 'Azee 500',
  dosage_form: 'Tablet',
  strength_value: 500,
  strength_unit: 'mg',
  manufacturer_name: 'Cipla Ltd',
  catalogue_source: 'official_catalogue',
  id_namespace: 'official_catalogue.formulation_id',
  ingredients: [{ name: 'Azithromycin', strength_value: 500, strength_unit: 'mg' }],
  aliases: ['Azee', 'Azithral'],
  sources: ['india_nlem_2022'],
  prices: [], // No verified price available
};

const mockSummaryC: catalogueApi.CatalogueMedicineSummary = {
  id: idC,
  canonical_name: 'PARACETAMOL 650 MG TABLET IP',
  generic_name: 'Paracetamol',
  brand_name: 'Dolo 650',
  dosage_form: 'Tablet',
  strength_value: 650,
  strength_unit: 'mg',
  manufacturer_name: 'Micro Labs Ltd',
  catalogue_source: 'official_catalogue',
  id_namespace: 'official_catalogue.formulation_id',
};

function renderCompare(initialEntries = ['/compare-medicines']) {
  const authClient = createAuthTestClient(testSession);
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

describe('CompareMedicinesPage Complete UX & Functionality', () => {
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

  it('renders initial empty guidance when no medicines are selected with single browse link', () => {
    renderCompare();
    expect(screen.getByRole('heading', { level: 1, name: 'Compare Medicines' })).toBeTruthy();
    expect(screen.getByText('Select Two Formulations to Compare')).toBeTruthy();
    expect(screen.getByText('Clinical Independence Standard', { exact: false })).toBeTruthy();
    expect(screen.getByText('Medicine 1')).toBeTruthy();
    expect(screen.getByText('Medicine 2')).toBeTruthy();

    // Verify exactly ONE Browse Medicine Library link exists on the page
    const browseLinks = screen.getAllByRole('link', { name: /Browse Medicine Library/i });
    expect(browseLinks).toHaveLength(1);
    // Duplicate "Browse medicines" link is removed
    expect(screen.queryByRole('link', { name: 'Browse medicines' })).toBeNull();
  });

  it('handles long formulation names and displays official source references', async () => {
    vi.spyOn(catalogueApi, 'compareMedicineCatalogue').mockResolvedValueOnce({
      medicines: [mockDetailA, mockDetailB],
      clinical_equivalence: null,
    });

    renderCompare([`/compare-medicines?a=${idA}&b=${idB}`]);

    expect(await screen.findByText('Comparison Evidence Breakdown')).toBeTruthy();
    expect(screen.getAllByText(longCombinationName).length).toBeGreaterThan(0);
    expect(screen.getAllByText('AZITHROMYCIN 500 MG TABLET IP').length).toBeGreaterThan(0);

    // Official namespace and ID check
    expect(screen.getAllByText(/official_catalogue\.formulation_id/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(new RegExp(idA)).length).toBeGreaterThanOrEqual(1);

    // Verified Price check: Medicine 1 has ₹24.50 per tablet, Medicine 2 has Not available
    expect(screen.getByText('₹24.50 per tablet')).toBeTruthy();
    expect(screen.getByText('Not available')).toBeTruthy();
  });

  it('supports opening picker dialog with human-friendly title, suggestions, and single clear button', async () => {
    const searchSpy = vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockResolvedValue({
      items: [mockSummaryC],
      pagination: { limit: 20, offset: 0, has_more: false },
    });

    renderCompare();

    // Click "Select medicine" on Medicine 1
    const selectButtons = screen.getAllByRole('button', { name: /Select medicine/i });
    fireEvent.click(selectButtons[0]!);

    // Dialog opens with human-friendly title (no "Formulation Profile" or "Slot A")
    expect(screen.getByRole('heading', { name: 'Select first medicine' })).toBeTruthy();
    expect(screen.queryByText('Formulation Profile')).toBeNull();
    expect(screen.getByText('Choose an official formulation to compare details.')).toBeTruthy();

    // Check popular search suggestions chips exist
    expect(screen.getByText('Paracetamol')).toBeTruthy();
    expect(screen.getByText('Amoxicillin')).toBeTruthy();

    // Click Paracetamol chip
    fireEvent.click(screen.getByText('Paracetamol'));

    await waitFor(() => {
      expect(searchSpy).toHaveBeenCalledWith('Paracetamol', { source: 'official_catalogue', limit: 20 }, testSession.access_token);
    });

    // Results appear
    expect(await screen.findByText('PARACETAMOL 650 MG TABLET IP')).toBeTruthy();
    expect(screen.getByText('Brand: Dolo 650')).toBeTruthy();

    // Exactly one clear button appears in the search input
    const clearButtons = screen.getAllByRole('button', { name: 'Clear search input' });
    expect(clearButtons).toHaveLength(1);

    // Close button on the modal header is separate
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeTruthy();
  });

  it('prevents duplicate medicine selection in the other medicine card', async () => {
    vi.spyOn(catalogueApi, 'fetchMedicineCatalogueDetail').mockResolvedValue(mockDetailB);
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockResolvedValue({
      items: [mockDetailB, mockSummaryC],
      pagination: { limit: 20, offset: 0, has_more: false },
    });

    // Medicine 2 already has idB
    renderCompare([`/compare-medicines?b=${idB}`]);

    // Medicine 2 is populated, Medicine 1 is empty
    expect(await screen.findByText('AZITHROMYCIN 500 MG TABLET IP')).toBeTruthy();

    // Open Medicine 1 picker
    const chooseA = screen.getByRole('button', { name: /Select Medicine 1/i });
    fireEvent.click(chooseA);

    // Type 'Azee' to search
    const searchInput = screen.getByPlaceholderText(/Search formulations/);
    fireEvent.change(searchInput, { target: { value: 'Azee' } });

    // In the results list, idB is disabled because it is already selected in Medicine 2
    expect(await screen.findByText('Selected as Medicine 2')).toBeTruthy();
    const disabledItem = screen.getByText('Selected as Medicine 2').closest('button');
    expect(disabledItem?.disabled).toBe(true);

    // But Paracetamol is selectable
    const enabledItem = screen.getByText('PARACETAMOL 650 MG TABLET IP').closest('button');
    expect(enabledItem?.disabled).toBe(false);
  });

  it('displays honest 503 error with working retry in picker and never false empty state', async () => {
    let searchAttempts = 0;
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockImplementation(async () => {
      searchAttempts += 1;
      if (searchAttempts === 1) {
        throw new ApiError('Service Unavailable', 503, 'http');
      }
      return {
        items: [mockSummaryC],
        pagination: { limit: 20, offset: 0, has_more: false },
      };
    });

    renderCompare();

    // Open Medicine 1 picker
    const selectBtn = screen.getAllByRole('button', { name: /Select medicine/i })[0]!;
    fireEvent.click(selectBtn);

    // Type query
    const searchInput = screen.getByPlaceholderText(/Search formulations/);
    fireEvent.change(searchInput, { target: { value: 'Paracetamol' } });

    // When 503 occurs:
    // It MUST display "Medicine catalogue temporarily unavailable" with Retry button
    const errorElements = await screen.findAllByText('Medicine catalogue temporarily unavailable');
    expect(errorElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();

    // It MUST NOT show "No formulations found" or "0 formulations available"
    expect(screen.queryByText('No formulations found')).toBeNull();
    expect(screen.queryByText(/0 formulations available/i)).toBeNull();

    // Click Retry
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    // Recovered state: items appear
    expect(await screen.findByText('PARACETAMOL 650 MG TABLET IP')).toBeTruthy();
    expect(searchAttempts).toBe(2);
  });

  it('handles comparison API error with working inline retry button', async () => {
    let callCount = 0;
    vi.spyOn(catalogueApi, 'compareMedicineCatalogue').mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new ApiError('503 Service Unavailable', 503, 'http');
      }
      return { medicines: [mockDetailA, mockDetailB], clinical_equivalence: null };
    });

    renderCompare([`/compare-medicines?a=${idA}&b=${idB}`]);

    // Error alert is rendered
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Medicine catalogue temporarily unavailable/)).toBeTruthy();

    // Click Retry comparison button
    const retryBtn = screen.getByRole('button', { name: /Retry comparison/ });
    fireEvent.click(retryBtn);

    // Recovered state
    expect(await screen.findByText('Comparison Evidence Breakdown')).toBeTruthy();
    expect(callCount).toBe(2);
  });

  it('allows single medicine removal and swapping', async () => {
    vi.spyOn(catalogueApi, 'compareMedicineCatalogue').mockResolvedValue({
      medicines: [mockDetailA, mockDetailB],
      clinical_equivalence: null,
    });

    renderCompare([`/compare-medicines?a=${idA}&b=${idB}`]);
    await screen.findByText('Comparison Evidence Breakdown');

    // Remove Medicine 1
    const removeBtnA = screen.getByRole('button', { name: new RegExp(`Remove.*from Medicine 1`) });
    fireEvent.click(removeBtnA);

    // Medicine 1 is now empty, table is replaced with guidance box
    expect(screen.queryByText('Comparison Evidence Breakdown')).toBeNull();
    expect(screen.getByText('Select Two Formulations to Compare')).toBeTruthy();
    expect(screen.getByText('Select Medicine 1')).toBeTruthy();
  });
});
