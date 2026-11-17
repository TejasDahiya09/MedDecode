import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/providers/AppProviders';
import { MedicineInsightsPage } from '../../src/features/catalogue/MedicineInsightsPage';
import { createAuthTestClient, testSession } from './auth-test-client';
import * as catalogueApi from '../../src/features/catalogue/medicine-catalogue-api';
import { ApiError } from '../../src/services/api-client';
import { Icon } from '../../src/components/Icon';
import { formatSourceOrganization } from '../../src/features/catalogue/catalogue-sources';

const formulationId = '33333333-3333-4333-8333-333333333333';
const legacyId = '44444444-4444-4444-8444-444444444444';

const mockSummaryItem: catalogueApi.CatalogueMedicineSummary = {
  id: formulationId,
  canonical_name: 'PARACETAMOL 500 MG TABLET',
  generic_name: 'Paracetamol',
  brand_name: 'Crocin',
  dosage_form: 'Tablet',
  strength_value: 500,
  strength_unit: 'mg',
  manufacturer_name: 'GSK',
  catalogue_source: 'official_catalogue',
  id_namespace: 'official_catalogue.formulation_id',
};

const mockLegacyItem: catalogueApi.CatalogueMedicineSummary = {
  id: legacyId,
  canonical_name: 'AMOXICILLIN 250 MG CAPSULE',
  generic_name: 'Amoxicillin',
  brand_name: 'Amoxil',
  dosage_form: 'Capsule',
  strength_value: 250,
  strength_unit: 'mg',
  manufacturer_name: 'Beecham',
  catalogue_source: 'legacy',
  id_namespace: 'public.medicines.id',
};

const mockDetailItem: catalogueApi.CatalogueMedicineDetail = {
  ...mockSummaryItem,
  ingredients: [
    { name: 'Paracetamol', strength_value: 500, strength_unit: 'mg' },
  ],
  aliases: ['Crocin 500'],
  sources: ['india_cdsco_approved', 'india_nlem_2022'],
  prices: [],
};

function renderPage(initialEntries = ['/medicine-library']) {
  const authClient = createAuthTestClient();
  return render(
    <AppProviders authClient={authClient} initialAuthSession={testSession}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/medicine-library" element={<MedicineInsightsPage />} />
          <Route path="/medicine-insights" element={<MedicineInsightsPage />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('MedicineInsightsPage component (Medicine Library)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
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

  it('renders Medicine Library heading, evidence summary, and clean search bar', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Medicine Library' })).toBeTruthy();
    expect(screen.getByText('Explore official Indian medicine formulations.')).toBeTruthy();
    expect(screen.getByPlaceholderText(/Search by formulation name/i)).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('opens a source detail modal from a preserved catalogue URL', async () => {
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockResolvedValue({
      items: [],
      pagination: { limit: 24, offset: 0, has_more: false },
    });
    const fetchDetail = vi.spyOn(catalogueApi, 'fetchMedicineCatalogueDetail').mockResolvedValue(mockDetailItem);
    renderPage([`/medicine-library?q=Paracetamol&source=official_catalogue&detail=${formulationId}`]);

    expect(await screen.findByText('Technical Provenance & Identifiers')).toBeTruthy();
    expect(fetchDetail).toHaveBeenCalledWith(formulationId, 'official_catalogue', testSession.access_token);
    expect(screen.getByText('PARACETAMOL 500 MG TABLET')).toBeTruthy();
  });

  it('browses bounded pages with server-provided totals', async () => {
    const browse = vi.spyOn(catalogueApi, 'browseMedicineCatalogue')
      .mockResolvedValueOnce({ items: [mockSummaryItem], total: 25, pagination: { limit: 24, offset: 0, has_more: true } })
      .mockResolvedValueOnce({ items: [{ ...mockSummaryItem, id: legacyId, canonical_name: 'SECOND RECORD' }], total: 25, pagination: { limit: 24, offset: 24, has_more: false } });
    renderPage();
    expect(await screen.findByText('25 formulations · Page 1')).toBeTruthy();
    expect(screen.getByText('Price not available')).toBeTruthy();
    const browseCompare = screen.getByRole('link', { name: /Compare PARACETAMOL 500 MG TABLET/i });
    expect(browseCompare.getAttribute('href')).toContain(`a=${encodeURIComponent(formulationId)}`);
    expect(browseCompare.getAttribute('href')).toContain('source=official_catalogue');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('SECOND RECORD')).toBeTruthy();
    expect(browse).toHaveBeenLastCalledWith(testSession.access_token, 24, undefined, expect.any(AbortSignal));
  });

  it('distinguishes an empty browse result from an unavailable catalogue', async () => {
    vi.spyOn(catalogueApi, 'browseMedicineCatalogue').mockResolvedValueOnce({
      items: [],
      total: 0,
      pagination: { limit: 24, offset: 0, has_more: false },
    });
    renderPage();
    expect(await screen.findByText('No formulation records are available for this filter.')).toBeTruthy();
    expect(screen.getByText('0 formulations · Page 1')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a real browse error and retries the initial catalogue request', async () => {
    const browse = vi.spyOn(catalogueApi, 'browseMedicineCatalogue')
      .mockRejectedValueOnce(new ApiError('Catalogue unavailable', 503, 'http'))
      .mockResolvedValueOnce({
        items: [mockSummaryItem],
        total: 1,
        pagination: { limit: 24, offset: 0, has_more: false },
      });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry catalogue browsing' }));
    expect(await screen.findByText('PARACETAMOL 500 MG TABLET')).toBeTruthy();
    expect(browse).toHaveBeenCalledTimes(2);
  });

  it('searches and paginates filtered catalogue results through the server', async () => {
    const searchSpy = vi.spyOn(catalogueApi, 'searchMedicineCatalogue')
      .mockResolvedValueOnce({
        items: [mockSummaryItem],
        pagination: { limit: 24, offset: 24, total: 49, has_more: true },
      })
      .mockResolvedValueOnce({
        items: [{ ...mockSummaryItem, id: legacyId, canonical_name: 'NEXT TABLET' }],
        pagination: { limit: 24, offset: 48, total: 49, has_more: false },
      });

    renderPage(['/medicine-library?q=Paracetamol&form=Tablet&page=2']);
    expect(await screen.findByText('PARACETAMOL 500 MG TABLET')).toBeTruthy();
    expect(searchSpy).toHaveBeenCalledWith(
      'Paracetamol',
      expect.objectContaining({ source: 'official_catalogue', limit: 24, offset: 24, form: 'Tablet' }),
      testSession.access_token,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('NEXT TABLET')).toBeTruthy();
    expect(searchSpy).toHaveBeenCalledWith(
      'Paracetamol',
      expect.objectContaining({ source: 'official_catalogue', offset: 48, form: 'Tablet' }),
      testSession.access_token,
    );
  });

  it('searches official catalogue by default and displays results', async () => {
    const searchSpy = vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockResolvedValueOnce({
      items: [mockSummaryItem],
      pagination: { limit: 30, offset: 0, has_more: false },
    });

    renderPage();
    const input = screen.getByPlaceholderText(/Search by formulation name/i);
    fireEvent.change(input, { target: { value: 'Paracetamol' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(searchSpy).toHaveBeenCalledWith(
        'Paracetamol',
        expect.objectContaining({ source: 'official_catalogue' }),
        testSession.access_token,
      );
    });

    expect(await screen.findByText('PARACETAMOL 500 MG TABLET')).toBeTruthy();
    expect(screen.getByText('Crocin')).toBeTruthy();
    expect(screen.getByText('Official')).toBeTruthy();
    expect(screen.getByText('Price not available')).toBeTruthy();
  });

  it('safely falls back to legacy catalogue when official catalogue yields 0 matches', async () => {
    const searchSpy = vi.spyOn(catalogueApi, 'searchMedicineCatalogue')
      .mockResolvedValueOnce({ items: [], pagination: { limit: 50, offset: 0, has_more: false } })
      .mockResolvedValueOnce({ items: [mockLegacyItem], pagination: { limit: 50, offset: 0, has_more: false } });

    renderPage(['/medicine-library?q=Amoxicillin']);

    await waitFor(() => {
      expect(searchSpy).toHaveBeenCalledWith('Amoxicillin', expect.objectContaining({ source: 'official_catalogue' }), testSession.access_token);
      expect(searchSpy).toHaveBeenCalledWith('Amoxicillin', expect.objectContaining({ source: 'legacy' }), testSession.access_token);
    });

    expect(await screen.findByText('AMOXICILLIN 250 MG CAPSULE')).toBeTruthy();
    expect(screen.getByText(/Supplemental Reference Library Results/i)).toBeTruthy();
    expect(screen.getAllByText('Supplemental Legacy').length).toBeGreaterThanOrEqual(1);
  });

  it('renders mutually exclusive error state with Retry button on API failure without showing empty results', async () => {
    let searchCount = 0;
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockImplementation(async (_query, options) => {
      // Disregard predictive autocomplete suggestions request in this test
      if (options?.limit === 6) {
        return { items: [], pagination: { limit: 6, offset: 0, has_more: false } };
      }
      searchCount++;
      if (searchCount === 1) {
        throw new ApiError('Unable to connect to the medicine catalogue service.', null, 'network');
      }
      return { items: [mockSummaryItem], pagination: { limit: 50, offset: 0, has_more: false } };
    });

    renderPage(['/medicine-library?q=Paracetamol']);

    // Error card must appear
    const errorHeading = await screen.findByRole('heading', { name: 'Catalogue Service Unavailable' });
    expect(errorHeading).toBeTruthy();
    expect(screen.getByText(/Unable to connect to the medicine catalogue service/i)).toBeTruthy();

    // MUST NOT display "No formulations found" simultaneously
    expect(screen.queryByText('No formulations found')).toBeNull();

    // Working Retry button
    const retryBtn = screen.getByRole('button', { name: /Retry search/i });
    expect(retryBtn).toBeTruthy();
    fireEvent.click(retryBtn);

    // After retry succeeds, results appear
    expect(await screen.findByText('PARACETAMOL 500 MG TABLET')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Catalogue Service Unavailable' })).toBeNull();
  });

  it('displays genuine empty state when search completes with zero formulations', async () => {
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue')
      .mockResolvedValueOnce({ items: [], pagination: { limit: 50, offset: 0, has_more: false } })
      .mockResolvedValueOnce({ items: [], pagination: { limit: 50, offset: 0, has_more: false } });

    renderPage(['/medicine-library?q=UnknownMed']);
    expect(await screen.findByText('No formulations found')).toBeTruthy();
    // No error card
    expect(screen.queryByRole('heading', { name: 'Catalogue Service Unavailable' })).toBeNull();
  });

  it('provides real predictive suggestions as user types', async () => {
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockResolvedValueOnce({
      items: [mockSummaryItem],
      pagination: { limit: 6, offset: 0, has_more: false },
    });

    renderPage();
    const input = screen.getByPlaceholderText(/Search by formulation name/i);
    fireEvent.change(input, { target: { value: 'para' } });

    // Wait for debounced predictive autocomplete
    await waitFor(() => {
      expect(screen.getByText(/Official Catalogue Matches/i)).toBeTruthy();
    }, { timeout: 2000 });

    // Highlighted text inside match
    const highlighted = document.querySelector('.md-autocomplete-highlight');
    expect(highlighted?.textContent?.toLowerCase()).toBe('para');
  });

  it('supports keyboard navigation for predictive suggestions', async () => {
    const searchSpy = vi.spyOn(catalogueApi, 'searchMedicineCatalogue')
      .mockResolvedValueOnce({
        items: [mockSummaryItem],
        pagination: { limit: 6, offset: 0, has_more: false },
      })
      .mockResolvedValueOnce({
        items: [mockSummaryItem],
        pagination: { limit: 50, offset: 0, has_more: false },
      });

    const detailSpy = vi.spyOn(catalogueApi, 'fetchMedicineCatalogueDetail').mockResolvedValue(mockDetailItem);
    renderPage();
    const input = screen.getByPlaceholderText(/Search by formulation name/i);
    fireEvent.change(input, { target: { value: 'para' } });

    await waitFor(() => {
      expect(screen.getByText(/Official Catalogue Matches/i)).toBeTruthy();
    }, { timeout: 2000 });

    // Arrow down highlights option
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const option = screen.getByRole('option', { selected: true });
    expect(option).toBeTruthy();

    // Enter opens the selected source-aware identity without a second search.
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(detailSpy).toHaveBeenCalledWith(formulationId, 'official_catalogue', testSession.access_token));
    expect(searchSpy).toHaveBeenCalledTimes(1);
  });

  it('opens a long suggestion by identity and never searches its full title', async () => {
    const longName = 'Paracetamol combination '.repeat(6);
    const searchSpy = vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockResolvedValue({
      items: [{ ...mockSummaryItem, canonical_name: longName }],
      pagination: { limit: 6, offset: 0, has_more: false },
    });
    const detailSpy = vi.spyOn(catalogueApi, 'fetchMedicineCatalogueDetail').mockResolvedValue({ ...mockDetailItem, canonical_name: longName });
    renderPage();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'para' } });
    const option = await screen.findByRole('option');
    fireEvent.mouseDown(option);
    await waitFor(() => expect(detailSpy).toHaveBeenCalledWith(formulationId, 'official_catalogue', testSession.access_token));
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect((input as HTMLInputElement).value).toBe('para');
    expect(screen.queryByRole('heading', { name: 'Catalogue Service Unavailable' })).toBeNull();
  });

  it('shows validation errors without presenting a service outage or retry', async () => {
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockRejectedValue(new ApiError('Invalid query', 400, 'http'));
    renderPage(['/medicine-library?q=x']);
    expect(await screen.findByRole('heading', { name: 'Check your search' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Catalogue Service Unavailable' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry search/i })).toBeNull();
  });

  it('closes suggestions on Escape and outside click', async () => {
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockResolvedValue({
      items: [mockSummaryItem], pagination: { limit: 6, offset: 0, has_more: false },
    });
    renderPage();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'para' } });
    await screen.findByRole('option');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not label a CDSCO restriction as an approval', () => {
    expect(formatSourceOrganization('india_cdsco_prohibition_notice').shortName).toBe('CDSCO Restriction');
    expect(formatSourceOrganization('unknown_source').role).toBe('Source identifier supplied by the catalogue.');
  });

  it('stores and displays recent searches locally', async () => {
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockResolvedValue({
      items: [mockSummaryItem],
      pagination: { limit: 50, offset: 0, has_more: false },
    });

    renderPage();
    const input = screen.getByPlaceholderText(/Search by formulation name/i);

    // Perform a search
    fireEvent.change(input, { target: { value: 'Ibuprofen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    // Clear search and focus input
    const clearBtn = await screen.findByRole('button', { name: 'Clear search' });
    fireEvent.click(clearBtn);
    fireEvent.focus(input);

    // Recent searches listbox appears
    await waitFor(() => {
      const listbox = screen.getByRole('listbox', { name: 'Search suggestions' });
      expect(listbox).toBeTruthy();
      expect(screen.getByText('Recent Searches')).toBeTruthy();
      expect(within(listbox).getByText('Ibuprofen')).toBeTruthy();
    });
  });

  it('opens detail modal and displays ingredients, truthful price disclaimer, and accurate sources', async () => {
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockResolvedValueOnce({
      items: [mockSummaryItem],
      pagination: { limit: 30, offset: 0, has_more: false },
    });
    const detailSpy = vi.spyOn(catalogueApi, 'fetchMedicineCatalogueDetail').mockResolvedValueOnce(mockDetailItem);

    renderPage(['/medicine-library?q=Paracetamol']);
    await screen.findByText('PARACETAMOL 500 MG TABLET');

    const detailBtn = screen.getByRole('button', { name: /View details for PARACETAMOL/i });
    fireEvent.click(detailBtn);

    await waitFor(() => {
      expect(detailSpy).toHaveBeenCalledWith(formulationId, 'official_catalogue', testSession.access_token);
    });

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Active Ingredients (1)')).toBeTruthy();
    expect(screen.getByText(/Price not available\. No verified source-linked price is available for this formulation/i)).toBeTruthy();
    expect(screen.getByText(/Central Drugs Standard Control Organisation \(CDSCO\)/i)).toBeTruthy();
    expect(screen.getByText(/National List of Essential Medicines \(NLEM 2022, MoHFW Publication\)/i)).toBeTruthy();
  });

  it('displays a price only with official source, basis, currency, and package evidence', async () => {
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockResolvedValueOnce({
      items: [mockSummaryItem],
      pagination: { limit: 30, offset: 0, has_more: false },
    });
    vi.spyOn(catalogueApi, 'fetchMedicineCatalogueDetail').mockResolvedValueOnce({
      ...mockDetailItem,
      prices: [{
        price: 16.25,
        currency: 'INR',
        price_basis: 'pmbi_listed_mrp',
        source_key: 'india_pmbi',
        package_description: '10 tablets',
        package_unit: 'per strip',
        effective_on: '2026-03-10',
      }],
    });

    renderPage(['/medicine-library?q=Paracetamol']);
    await screen.findByText('PARACETAMOL 500 MG TABLET');
    fireEvent.click(screen.getByRole('button', { name: /View details for PARACETAMOL/i }));

    expect(await screen.findByText('PMBI listed MRP')).toBeTruthy();
    expect(screen.getByText('₹16.25')).toBeTruthy();
    expect(screen.getByText('Package: 10 tablets')).toBeTruthy();
    expect(screen.getByText('Unit: per strip')).toBeTruthy();
    expect(screen.getByText('Source: PMBI Jan Aushadhi')).toBeTruthy();
    expect(screen.getByText('Effective date: 2026-03-10')).toBeTruthy();
    expect(screen.getByText('Pricing reference only; not prescribing guidance.')).toBeTruthy();
  });

  it('does not display an amount without verified price provenance and package scope', async () => {
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockResolvedValueOnce({
      items: [mockSummaryItem],
      pagination: { limit: 30, offset: 0, has_more: false },
    });
    vi.spyOn(catalogueApi, 'fetchMedicineCatalogueDetail').mockResolvedValueOnce({
      ...mockDetailItem,
      prices: [{ amount: 16.25, currency: 'INR', price_type: 'MRP' }],
    });

    renderPage(['/medicine-library?q=Paracetamol']);
    await screen.findByText('PARACETAMOL 500 MG TABLET');
    fireEvent.click(screen.getByRole('button', { name: /View details for PARACETAMOL/i }));

    expect(await screen.findByText(/Price not available\. No verified source-linked price is available for this formulation/i)).toBeTruthy();
    expect(screen.queryByText('₹16.25')).toBeNull();
  });

  it('preserves a verified zero-value official MRP as source data', async () => {
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockResolvedValueOnce({
      items: [mockSummaryItem],
      pagination: { limit: 30, offset: 0, has_more: false },
    });
    vi.spyOn(catalogueApi, 'fetchMedicineCatalogueDetail').mockResolvedValueOnce({
      ...mockDetailItem,
      prices: [{
        price: 0,
        currency: 'INR',
        price_basis: 'pmbi_listed_mrp',
        source_key: 'india_pmbi',
        package_description: '10 tablets',
      }],
    });

    renderPage(['/medicine-library?q=Paracetamol']);
    await screen.findByText('PARACETAMOL 500 MG TABLET');
    fireEvent.click(screen.getByRole('button', { name: /View details for PARACETAMOL/i }));

    expect(await screen.findByText('₹0.00')).toBeTruthy();
    expect(screen.getByText('PMBI listed MRP')).toBeTruthy();
  });

  it('preserves source-specific routing for medicine comparison links', async () => {
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockResolvedValueOnce({
      items: [mockSummaryItem],
      pagination: { limit: 30, offset: 0, has_more: false },
    });

    renderPage(['/medicine-library?q=Paracetamol']);
    await screen.findByText('PARACETAMOL 500 MG TABLET');

    const compareLink = screen.getByRole('link', { name: /Compare PARACETAMOL/i });
    expect(compareLink.getAttribute('href')).toContain(`source=official_catalogue`);
    expect(compareLink.getAttribute('href')).toContain(`a=${encodeURIComponent(formulationId)}`);
  });

  it('handles HTTP 503 service unavailable error without crashing and shows retry action', async () => {
    vi.spyOn(catalogueApi, 'searchMedicineCatalogue').mockImplementation(async () => {
      throw new ApiError('The service is temporarily unavailable.', 503, 'http');
    });

    renderPage(['/medicine-library?q=Paracetamol']);

    const errorHeading = await screen.findByRole('heading', { name: 'Catalogue Service Unavailable' });
    expect(errorHeading).toBeTruthy();
    expect(screen.getByText(/The medicine catalogue service encountered an error \(503\)/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry search/i })).toBeTruthy();
    expect(screen.queryByText('No formulations found')).toBeNull();
  });

  it('safely handles missing or unknown icon names without throwing runtime errors', () => {
    // Testing unsupported icon name does not crash Icon component
    const { container } = render(<Icon name={'non-existent-icon' as never} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.querySelectorAll('path')).toHaveLength(0);

    // Testing newly supported icons
    const { container: clockContainer } = render(<Icon name="clock" />);
    expect(clockContainer.querySelector('path')).toBeTruthy();

    const { container: refreshContainer } = render(<Icon name="refresh" />);
    expect(refreshContainer.querySelector('path')).toBeTruthy();

    const { container: infoContainer } = render(<Icon name="info" />);
    expect(infoContainer.querySelector('path')).toBeTruthy();
  });
});
