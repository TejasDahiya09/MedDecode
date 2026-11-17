import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, EmptyState, Skeleton } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { MedicineCatalogDialog } from '../demo/MedicineCatalogDialog';
import { formatSourceOrganization } from './catalogue-sources';
import {
  browseMedicineCatalogue,
  fetchMedicineCatalogueDetail,
  searchMedicineCatalogue,
  type CatalogueMedicineDetail,
  type CatalogueMedicineSummary,
  type CatalogueSource,
} from './medicine-catalogue-api';
import { ApiError } from '../../services/api-client';
import { useAuth } from '../auth/AuthProvider';
import './medicine-insights-premium.css';

interface PriceScheduleItem {
  readonly price_basis: 'ceiling_price_excluding_taxes' | 'special_feature_ceiling_price' | 'revised_mrp' | 'pmbi_listed_mrp';
  readonly amount: number;
  readonly effective_on: string | null;
  readonly package_description: string | null;
  readonly package_unit: string | null;
  readonly source_key: 'india_nppa_prices' | 'india_pmbi';
}

const PRICE_BASIS_LABELS = {
  ceiling_price_excluding_taxes: 'Ceiling price (excluding taxes)',
  special_feature_ceiling_price: 'Special-feature ceiling price',
  revised_mrp: 'Revised MRP',
  pmbi_listed_mrp: 'PMBI listed MRP',
} as const;

function parsePriceScheduleItem(price: unknown): PriceScheduleItem | null {
  if (typeof price !== 'object' || price === null) return null;
  const p = price as Record<string, unknown>;
  const price_basis = typeof p.price_basis === 'string'
    && Object.prototype.hasOwnProperty.call(PRICE_BASIS_LABELS, p.price_basis)
    ? p.price_basis as keyof typeof PRICE_BASIS_LABELS
    : null;
  const source_key = p.source_key === 'india_nppa_prices' || p.source_key === 'india_pmbi'
    ? p.source_key
    : null;
  const expectedSource = price_basis === 'pmbi_listed_mrp' ? 'india_pmbi' : 'india_nppa_prices';
  const amount = p.price;
  const package_description = typeof p.package_description === 'string' ? p.package_description.trim() : '';
  const package_unit = typeof p.package_unit === 'string' ? p.package_unit.trim() : '';
  const effectiveOn = typeof p.effective_on === 'string' ? p.effective_on : null;
  const hasValidEffectiveDate = effectiveOn !== null
    && /^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)
    && !Number.isNaN(Date.parse(`${effectiveOn}T00:00:00.000Z`))
    && new Date(`${effectiveOn}T00:00:00.000Z`).toISOString().slice(0, 10) === effectiveOn;

  if (
    price_basis === null
    || source_key !== expectedSource
    || typeof amount !== 'number'
    || !Number.isFinite(amount)
    || amount < 0
    || typeof p.currency !== 'string'
    || p.currency.toUpperCase() !== 'INR'
    || (!package_description && !package_unit)
  ) return null;

  return {
    price_basis,
    amount,
    effective_on: hasValidEffectiveDate ? effectiveOn : null,
    package_description: package_description || null,
    package_unit: package_unit || null,
    source_key,
  };
}

const DOSAGE_FORM_CATEGORIES = [
  { id: 'All', name: 'All dosage forms', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z' },
  { id: 'Tablet', name: 'Tablets', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM6 18 18 6' },
  { id: 'Capsule', name: 'Capsules', icon: 'm8 4 12 12M7 3a5 5 0 0 1 7 0l7 7a5 5 0 0 1-7 7l-7-7a5 5 0 0 1 0-7Z' },
  { id: 'Syrup', name: 'Syrups & Liquids', icon: 'M9 2h6v5l3 3v12H6V10l3-3ZM6 13h12M9 17h6' },
  { id: 'Injection', name: 'Injections', icon: 'M8 2h8v4H8ZM6 6h12v16H6ZM9 14h6m-3-3v6' },
  { id: 'Ointment', name: 'Creams & Ointments', icon: 'M5 3h14l-2 14H7ZM9 17v5h6v-5M8 7h8' },
  { id: 'Drops', name: 'Drops & Sprays', icon: 'M12 2s8 9 8 13a8 8 0 0 1-16 0c0-4 8-13 8-13Z' },
] as const;

function matchesDosageCategory(dosageForm: string | null, category: string): boolean {
  const form = (dosageForm ?? '').toLowerCase();
  switch (category) {
    case 'Tablet': return /(tablet|caplet)/.test(form);
    case 'Capsule': return /capsule/.test(form);
    case 'Syrup': return /(syrup|suspension|liquid|elixir|oral solution)/.test(form);
    case 'Injection': return /(inject|infusion|vial)/.test(form);
    case 'Ointment': return /(cream|ointment|gel|lotion|topical)/.test(form);
    case 'Drops': return /(drop|spray|nasal|ophthalmic|otic)/.test(form);
    default: return true;
  }
}

const RECENT_SEARCHES_KEY = 'meddecode_recent_medicine_searches';
type BrowseState =
  | { readonly key: string; readonly data: Awaited<ReturnType<typeof browseMedicineCatalogue>>; readonly error: false }
  | { readonly key: string; readonly data: null; readonly error: true };

function getStoredRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, 5);
    }
  } catch {
    // Ignore localStorage errors
  }
  return [];
}

function saveStoredRecentSearch(query: string): string[] {
  const clean = query.trim();
  if (!clean || clean.length < 2) return getStoredRecentSearches();
  try {
    const current = getStoredRecentSearches();
    const updated = [clean, ...current.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 5);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return getStoredRecentSearches();
  }
}

function clearStoredRecentSearches(): void {
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Highlights the matching portion of text matching query case-insensitively.
 */
function highlightMatch(text: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return text;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    regex.test(part) ? (
      <mark key={index} className="md-autocomplete-highlight">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function MedicineInsightsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAuth();
  const searchId = useId();
  const comboboxListId = useId();

  const queryFromUrl = searchParams.get('q') ?? '';
  const requestedForm = searchParams.get('form') ?? 'All';
  const formFromUrl = DOSAGE_FORM_CATEGORIES.some((category) => category.id === requestedForm) ? requestedForm : 'All';
  const requestedSource = searchParams.get('source');
  const sourceFromUrl: CatalogueSource = requestedSource === 'legacy' ? 'legacy' : 'official_catalogue';
  const requestedDetailId = searchParams.get('detail');
  const requestedPage = Number(searchParams.get('page') ?? '1');
  const pageFromUrl = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const [inputQuery, setInputQuery] = useState(queryFromUrl);
  const [previousQueryFromUrl, setPreviousQueryFromUrl] = useState(queryFromUrl);
  if (queryFromUrl !== previousQueryFromUrl) {
    setPreviousQueryFromUrl(queryFromUrl);
    setInputQuery(queryFromUrl);
  }
  const [activeFormFilter, setActiveFormFilter] = useState(formFromUrl);
  const [previousFormFromUrl, setPreviousFormFromUrl] = useState(formFromUrl);
  if (formFromUrl !== previousFormFromUrl) {
    setPreviousFormFromUrl(formFromUrl);
    setActiveFormFilter(formFromUrl);
  }
  const [sortBy, setSortBy] = useState<'name_asc' | 'name_desc'>('name_asc');

  // Search Results & Mutually Exclusive State Machine
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<CatalogueMedicineSummary[]>([]);
  const [moreResultsAvailable, setMoreResultsAvailable] = useState(false);
  const [searchTotal, setSearchTotal] = useState<number | null>(null);
  const [hasSearched, setHasSearched] = useState(Boolean(queryFromUrl.trim()));
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchErrorKind, setSearchErrorKind] = useState<'input' | 'auth' | 'service'>('service');
  const [isFallback, setIsFallback] = useState(false);

  // Pagination
  const pageSize = 24;

  // Predictive Autocomplete State
  const [suggestions, setSuggestions] = useState<CatalogueMedicineSummary[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsFailed, setSuggestionsFailed] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>(getStoredRecentSearches);

  // Selected Detail Modal State
  const [selectedDetailId, setSelectedDetailId] = useState<string | null>(null);
  const [selectedDetailSource, setSelectedDetailSource] = useState<CatalogueSource>('official_catalogue');
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<CatalogueMedicineDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [browseRetry, setBrowseRetry] = useState(0);
  const [browseState, setBrowseState] = useState<BrowseState | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchCardRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const autocompleteSeqRef = useRef(0);
  const detailSeqRef = useRef(0);
  const requestedDetailHandledRef = useRef<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const browseAbortRef = useRef<AbortController | null>(null);

  const browseRequestKey = `${pageFromUrl}:${activeFormFilter}:${browseRetry}`;
  const currentBrowseState = browseState?.key === browseRequestKey ? browseState : null;
  const browseData = currentBrowseState?.error === false ? currentBrowseState.data : null;
  const browseError = currentBrowseState?.error === true;
  const browseLoading = !queryFromUrl.trim() && currentBrowseState === null;

  useEffect(() => {
    if (queryFromUrl.trim()) return;
    const controller = new AbortController();
    browseAbortRef.current?.abort();
    browseAbortRef.current = controller;
    void browseMedicineCatalogue(
      auth.getAccessToken() ?? '',
      (pageFromUrl - 1) * pageSize,
      activeFormFilter === 'All' ? undefined : activeFormFilter,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setBrowseState({ key: browseRequestKey, data, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setBrowseState({ key: browseRequestKey, data: null, error: true });
      });
    return () => controller.abort();
  }, [auth, pageFromUrl, activeFormFilter, queryFromUrl, browseRequestKey]);

  // Official results remain paginated by the catalogue API; legacy is only a bounded fallback.
  const executeSearch = useCallback(
    async (queryToRun: string, sourceOverride?: CatalogueSource) => {
      const q = queryToRun.trim();
      searchAbortRef.current?.abort();
      if (!q) {
        setSearchResults([]);
        setMoreResultsAvailable(false);
        setSearchTotal(null);
        setHasSearched(false);
        setSearchError(null);
        setSearchLoading(false);
        setIsFallback(false);
        return;
      }

      const controller = new AbortController();
      searchAbortRef.current = controller;
      setSearchLoading(true);
      setSearchError(null);

      try {
        const token = auth.getAccessToken() ?? '';
        const offset = (pageFromUrl - 1) * pageSize;
        const commonOptions = { limit: pageSize, offset, signal: controller.signal };

        // If the URL explicitly requests legacy catalogue, query legacy directly
        if (sourceOverride === 'legacy' || sourceFromUrl === 'legacy') {
          const response = await searchMedicineCatalogue(q, { ...commonOptions, source: 'legacy' }, token);
          setSearchResults([...response.items]);
          setMoreResultsAvailable(response.pagination.has_more);
          setSearchTotal(response.pagination.total ?? null);
          setIsFallback(true);
          setHasSearched(true);
          return;
        }

        const officialResponse = await searchMedicineCatalogue(q, {
          ...commonOptions,
          source: 'official_catalogue',
          form: activeFormFilter === 'All' ? undefined : activeFormFilter,
        }, token);
        if (controller.signal.aborted) return;
        setMoreResultsAvailable(officialResponse.pagination.has_more);
        setSearchTotal(officialResponse.pagination.total ?? null);
        if (officialResponse.items.length > 0) {
          setSearchResults([...officialResponse.items]);
          setIsFallback(false);
          setHasSearched(true);
        } else if (offset === 0) {
          const legacyResponse = await searchMedicineCatalogue(q, { ...commonOptions, source: 'legacy' }, token);
          if (controller.signal.aborted) return;
          setMoreResultsAvailable(legacyResponse.pagination.has_more);
          setSearchTotal(legacyResponse.pagination.total ?? null);
          if (legacyResponse.items.length > 0) {
            setSearchResults([...legacyResponse.items]);
            setIsFallback(true);
          } else {
            setSearchResults([]);
            setIsFallback(false);
          }
          setHasSearched(true);
        } else {
          setSearchResults([]);
          setIsFallback(false);
          setHasSearched(true);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        let msg = 'Unable to connect to the medicine catalogue service. Please verify that the local service is running and try again.';
        if (err instanceof ApiError) {
          if (err.status === 401 || err.status === 403) {
            setSearchErrorKind('auth');
            msg = 'An authenticated session is required to search the official medicine catalogue. Please sign in or refresh your session.';
          } else if (err.status === 400 || err.status === 422) {
            setSearchErrorKind('input');
            msg = 'Search query must be between 2 and 80 alphanumeric characters.';
          } else if (err.kind === 'network' || !err.status) {
            setSearchErrorKind('service');
            msg = 'Unable to connect to the medicine catalogue service. Check your connection or try again.';
          } else {
            setSearchErrorKind('service');
            msg = `The medicine catalogue service encountered an error (${err.status}). Please try again.`;
          }
        } else {
          setSearchErrorKind('service');
        }
        setSearchError(msg);
        setSearchResults([]);
        setSearchTotal(null);
        setHasSearched(true);
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    },
    [activeFormFilter, auth, pageFromUrl, sourceFromUrl],
  );

  // Trigger searches when query, filter, or URL page changes.
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return executeSearch(queryFromUrl);
      return undefined;
    });
    return () => {
      active = false;
      searchAbortRef.current?.abort();
    };
  }, [queryFromUrl, pageFromUrl, executeSearch]);

  useEffect(() => () => {
    searchAbortRef.current?.abort();
    browseAbortRef.current?.abort();
  }, []);

  // Predictive Autocomplete Effect (Debounced ~300ms, >= 2 characters)
  useEffect(() => {
    const trimmed = inputQuery.trim();
    const seqId = ++autocompleteSeqRef.current;
    if (trimmed.length < 2) return;

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setSuggestionsLoading(true);
      setSuggestionsFailed(false);
      try {
        const token = auth.getAccessToken() ?? '';
        const response = await searchMedicineCatalogue(trimmed, { source: 'official_catalogue', limit: 6, signal: controller.signal }, token);
        if (seqId === autocompleteSeqRef.current) {
          setSuggestions([...response.items]);
          setHighlightedIndex(-1);
        }
      } catch {
        if (!controller.signal.aborted && seqId === autocompleteSeqRef.current) {
          setSuggestions([]);
          setSuggestionsFailed(true);
        }
      } finally {
        if (!controller.signal.aborted && seqId === autocompleteSeqRef.current) {
          setSuggestionsLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [inputQuery, auth]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchCardRef.current && !searchCardRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSearchSubmit(e?: FormEvent) {
    if (e) e.preventDefault();
    const clean = inputQuery.trim();
    if (!clean) return;
    setShowDropdown(false);
    const updatedRecents = saveStoredRecentSearch(clean);
    setRecentSearches(updatedRecents);
    const params: Record<string, string> = { q: clean };
    if (activeFormFilter !== 'All') params.form = activeFormFilter;
    setSearchParams(params);
  }

  function handleQuickSearch(term: string) {
    setInputQuery(term);
    setShowDropdown(false);
    const updatedRecents = saveStoredRecentSearch(term);
    setRecentSearches(updatedRecents);
    const params: Record<string, string> = { q: term };
    if (activeFormFilter !== 'All') params.form = activeFormFilter;
    setSearchParams(params);
  }

  function handleSelectSuggestion(item: CatalogueMedicineSummary) {
    setShowDropdown(false);
    setHighlightedIndex(-1);
    void handleViewDetail(item.id, item.catalogue_source);
  }

  function clearSearch() {
    setInputQuery('');
    setSuggestions([]);
    setShowDropdown(false);
    setSearchError(null);
    setSearchResults([]);
    setSearchTotal(null);
    setHasSearched(false);
    const params: Record<string, string> = {};
    if (activeFormFilter !== 'All') params.form = activeFormFilter;
    setSearchParams(params);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function clearAllFilters() {
    setInputQuery('');
    setActiveFormFilter('All');
    setSortBy('name_asc');
    setSuggestions([]);
    setShowDropdown(false);
    setSearchError(null);
    setSearchResults([]);
    setSearchTotal(null);
    setHasSearched(false);
    setSearchParams({});
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function handleFilterChange(formId: string) {
    setActiveFormFilter(formId);
    const params: Record<string, string> = {};
    if (queryFromUrl) params.q = queryFromUrl;
    if (formId !== 'All') params.form = formId;
    setSearchParams(params);
  }

  function navigateToPage(nextPage: number) {
    const params: Record<string, string> = {};
    if (queryFromUrl) params.q = queryFromUrl;
    if (activeFormFilter !== 'All') params.form = activeFormFilter;
    if (queryFromUrl && (isFallback || sourceFromUrl === 'legacy')) params.source = 'legacy';
    if (nextPage > 1) params.page = String(nextPage);
    setSearchParams(params);
  }

  function handleRetry() {
    void executeSearch(queryFromUrl || inputQuery);
  }

  function handleBrowseRetry() {
    setBrowseRetry((value) => value + 1);
  }

  // Keyboard navigation for combobox suggestions
  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const trimmed = inputQuery.trim();
    const isShowingSuggestions = showDropdown && suggestions.length > 0;
    const isShowingRecents = showDropdown && trimmed.length === 0 && recentSearches.length > 0;
    const itemsCount = isShowingSuggestions ? suggestions.length : isShowingRecents ? recentSearches.length : 0;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showDropdown) {
        setShowDropdown(true);
        return;
      }
      if (itemsCount > 0) {
        setHighlightedIndex((prev) => (prev + 1 >= itemsCount ? 0 : prev + 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (itemsCount > 0) {
        setHighlightedIndex((prev) => (prev - 1 < 0 ? itemsCount - 1 : prev - 1));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showDropdown && highlightedIndex >= 0) {
        if (isShowingSuggestions && suggestions[highlightedIndex]) {
          handleSelectSuggestion(suggestions[highlightedIndex]);
        } else if (isShowingRecents && recentSearches[highlightedIndex]) {
          handleQuickSearch(recentSearches[highlightedIndex]);
        }
      } else {
        handleSearchSubmit();
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setHighlightedIndex(-1);
    }
  }

  // Filtered & Sorted Results
  const filteredResults = useMemo(() => {
    let list = searchResults;
    if (activeFormFilter !== 'All' && isFallback) {
      list = list.filter((item) => matchesDosageCategory(item.dosage_form, activeFormFilter));
    }
    return [...list].sort((a, b) => {
      const nameA = a.canonical_name.toLowerCase();
      const nameB = b.canonical_name.toLowerCase();
      return sortBy === 'name_asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    });
  }, [searchResults, activeFormFilter, isFallback, sortBy]);

  const totalPages = searchTotal === null ? null : Math.max(1, Math.ceil(searchTotal / pageSize));
  const currentPage = pageFromUrl;
  const displayedItems = filteredResults;
  const catalogueSuggestions = useMemo(() => {
    const names = (browseData?.items ?? [])
      .map((item) => item.generic_name?.trim() || item.canonical_name.trim())
      .filter((name) => name.length >= 2 && name.length <= 80);
    return [...new Set(names)].slice(0, 8);
  }, [browseData]);

  // Load detail on modal open with explicit source awareness
  const handleViewDetail = useCallback(async (formulationId: string, itemSource?: CatalogueSource) => {
    const sequence = ++detailSeqRef.current;
    const sourceToQuery = itemSource ?? sourceFromUrl;
    setSelectedDetailId(formulationId);
    setSelectedDetailSource(sourceToQuery);
    setSelectedDetail(null);
    setDetailError(null);
    setDetailLoading(true);

    try {
      const token = auth.getAccessToken() ?? '';
      const response = await fetchMedicineCatalogueDetail(formulationId, sourceToQuery, token);
      if (sequence === detailSeqRef.current) setSelectedDetail(response);
    } catch {
      if (sequence === detailSeqRef.current) setDetailError('Unable to load full formulation details. Please try again.');
    } finally {
      if (sequence === detailSeqRef.current) setDetailLoading(false);
    }
  }, [auth, sourceFromUrl]);

  useEffect(() => {
    if (!requestedDetailId) {
      requestedDetailHandledRef.current = null;
      return;
    }
    const requestKey = `${sourceFromUrl}:${requestedDetailId}`;
    if (requestedDetailHandledRef.current === requestKey) return;
    requestedDetailHandledRef.current = requestKey;
    void handleViewDetail(requestedDetailId, sourceFromUrl);
  }, [handleViewDetail, requestedDetailId, sourceFromUrl]);

  function closeDetailModal() {
    detailSeqRef.current++;
    setSelectedDetailId(null);
    setSelectedDetail(null);
    setDetailError(null);
    if (searchParams.has('detail')) {
      const next = new URLSearchParams(searchParams);
      next.delete('detail');
      setSearchParams(next, { replace: true });
    }
  }

  // Determine current mutually exclusive content view state
  type ViewState = 'loading' | 'error' | 'results' | 'empty' | 'initial';
  let viewState: ViewState;
  if (searchLoading) {
    viewState = 'loading';
  } else if (searchError !== null) {
    viewState = 'error';
  } else if (hasSearched && filteredResults.length > 0) {
    viewState = 'results';
  } else if (hasSearched && filteredResults.length === 0) {
    viewState = 'empty';
  } else {
    viewState = 'initial';
  }
  const verifiedPrices = (selectedDetail?.prices ?? [])
    .map(parsePriceScheduleItem)
    .filter((price): price is PriceScheduleItem => price !== null);

  return (
    <div className="md-page md-catalog md-insights-premium">
      {/* ====================================================================
          A. COMPACT PAGE INTRODUCTION
          ==================================================================== */}
      <section className="md-insights-hero" aria-label="Medicine Library Overview">
        <div className="md-insights-hero-content">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase bg-[var(--cc-primary-soft)] text-[var(--cc-primary)] border border-[var(--cc-primary)]/20">
              Indian Medicine Reference
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--cc-text)]">
            Medicine Library
          </h1>
          <p className="text-sm font-medium text-[var(--cc-primary)] mt-0.5">
            Explore official Indian medicine formulations.
          </p>

          <p className="md-catalog-disclaimer text-xs text-[var(--cc-muted)] mt-2 max-w-3xl leading-relaxed">
            Source information is shown where available for each record. For informational reference only.
          </p>
        </div>

        {/* Hero Visual Accent Motif */}
        <div className="md-insights-hero-accent" aria-hidden="true">
          <svg viewBox="0 0 48 48" className="size-8" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M24 6v36M6 24h36" />
            <circle cx="24" cy="24" r="18" strokeDasharray="4 4" />
          </svg>
        </div>
      </section>

      {/* ====================================================================
          B. PROMINENT INTELLIGENT SEARCH WITH REAL PREDICTIVE AUTOCOMPLETE
          ==================================================================== */}
      <section className="md-search-card" ref={searchCardRef} aria-label="Medicine formulation search">
        <form
          className="md-search-form"
          role="search"
          aria-label="Official medicine search"
          onSubmit={handleSearchSubmit}
        >
          <label className="sr-only" htmlFor={searchId}>
            Search medicines
          </label>
          <Icon name="search" className="md-search-icon" />

          <input
            id={searchId}
            ref={searchInputRef}
            type="search"
            role="combobox"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={showDropdown && (suggestions.length > 0 || (inputQuery.trim().length === 0 && recentSearches.length > 0))}
            aria-controls={comboboxListId}
            aria-invalid={searchErrorKind === 'input' && searchError !== null}
            aria-describedby={searchErrorKind === 'input' && searchError ? `${searchId}-error` : undefined}
            aria-activedescendant={highlightedIndex >= 0 ? `suggestion-item-${highlightedIndex}` : undefined}
            maxLength={80}
            className="md-search-input"
            placeholder="Search by formulation name, ingredient, brand, strength, or dosage form..."
            value={inputQuery}
            onChange={(e) => {
              const value = e.target.value;
              setInputQuery(value);
              setShowDropdown(true);
              if (value.trim().length < 2) {
                setSuggestions([]);
                setSuggestionsLoading(false);
                setSuggestionsFailed(false);
                setHighlightedIndex(-1);
              }
            }}
            onFocus={() => setShowDropdown(true)}
            onKeyDown={handleInputKeyDown}
          />

          {suggestionsLoading && inputQuery.trim().length >= 2 && (
            <div className="md-search-spinner" aria-label="Searching suggestions">
              <svg className="animate-spin size-4 text-[var(--cc-primary)]" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </div>
          )}

          {inputQuery !== '' && (
            <button
              type="button"
              aria-label="Clear search"
              className="md-search-clear"
              onClick={clearSearch}
            >
              <Icon name="close" className="size-4" />
            </button>
          )}

          <Button type="submit" loading={searchLoading} className="shrink-0 font-semibold px-4">
            Search
          </Button>
        </form>
        {searchErrorKind === 'input' && searchError && <p id={`${searchId}-error`} role="alert" className="mt-2 text-sm text-[var(--cc-danger)]">{searchError}</p>}

        {/* Predictive Suggestions / Recent Searches Dropdown */}
        {showDropdown && (
          <div
            id={comboboxListId}
            role="listbox"
            className="md-autocomplete-dropdown"
            aria-label="Search suggestions"
          >
            {inputQuery.trim().length >= 2 ? (
              /* Autocomplete Suggestions from Real Catalogue Results */
              suggestions.length > 0 ? (
                <>
                  <div className="md-autocomplete-header">
                    <span>Official Catalogue Matches</span>
                    <small>Arrow keys to navigate · Enter to select</small>
                  </div>
                  <div className="md-autocomplete-list">
                    {suggestions.map((item, index) => {
                      const isHighlighted = index === highlightedIndex;
                      return (
                        <div
                          key={item.id}
                          id={`suggestion-item-${index}`}
                          role="option"
                          aria-selected={isHighlighted}
                          className={`md-autocomplete-item ${isHighlighted ? 'is-highlighted' : ''}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleSelectSuggestion(item);
                          }}
                          onMouseEnter={() => setHighlightedIndex(index)}
                        >
                          <div className="md-autocomplete-item-icon">
                            <Icon name="search" className="size-4 text-[var(--cc-primary)]" />
                          </div>
                          <div className="md-autocomplete-item-text">
                            <strong className="md-autocomplete-item-name">
                              {highlightMatch(item.canonical_name, inputQuery)}
                            </strong>
                            <div className="md-autocomplete-item-meta">
                              {item.generic_name && (
                                <span className="md-autocomplete-generic">
                                  {item.generic_name}
                                </span>
                              )}
                              {item.dosage_form && (
                                <span className="md-autocomplete-form">
                                  · {item.dosage_form}
                                </span>
                              )}
                              {item.strength_value && (
                                <span className="md-autocomplete-strength">
                                  · {item.strength_value} {item.strength_unit ?? ''}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="md-autocomplete-item-badge">
                            <Badge tone="info">Official catalogue</Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : !suggestionsLoading && !suggestionsFailed ? (
                <div className="md-autocomplete-empty">
                  <span>No exact catalogue matches for &quot;{inputQuery.trim()}&quot;</span>
                  <small>Press Enter to perform full keyword search</small>
                </div>
              ) : null
            ) : recentSearches.length > 0 ? (
              /* Recent Searches State (When query is empty and focused) */
              <>
                <div className="md-autocomplete-header">
                  <div className="flex items-center gap-1.5 text-xs text-[var(--cc-muted)] font-medium">
                    <svg className="size-3.5 text-[var(--cc-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span>Recent Searches</span>
                  </div>
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[var(--cc-primary)] hover:underline"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      clearStoredRecentSearches();
                      setRecentSearches([]);
                    }}
                  >
                    Clear history
                  </button>
                </div>
                <div className="md-autocomplete-list">
                  {recentSearches.map((term, index) => {
                    const isHighlighted = index === highlightedIndex;
                    return (
                      <div
                        key={term}
                        id={`suggestion-item-${index}`}
                        role="option"
                        aria-selected={isHighlighted}
                        className={`md-autocomplete-item ${isHighlighted ? 'is-highlighted' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleQuickSearch(term);
                        }}
                        onMouseEnter={() => setHighlightedIndex(index)}
                      >
                        <div className="md-autocomplete-item-icon">
                          <svg className="size-4 text-[var(--cc-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                        </div>
                        <div className="md-autocomplete-item-text">
                          <strong className="md-autocomplete-item-name">{term}</strong>
                        </div>
                        <span className="text-[11px] text-[var(--cc-muted)] font-medium">
                          Search
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        )}
      </section>

      {/* ====================================================================
          C. COMPACT FILTER TOOLBAR (Dosage Form Navigation)
          ==================================================================== */}
      <nav className="md-dosage-strip" aria-label="Dosage form categories">
        {DOSAGE_FORM_CATEGORIES.map((cat) => {
          const isSelected = activeFormFilter === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => handleFilterChange(cat.id)}
              className={`md-dosage-pill ${isSelected ? 'active' : ''}`}
            >
              <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={cat.icon} />
              </svg>
              <span>{cat.name}</span>
            </button>
          );
        })}
      </nav>

      {/* ====================================================================
          D. MAIN CONTENT AREA (Strictly Mutually Exclusive States)
          ==================================================================== */}
      <div className="md-library-content">
      <section className="md-library-results" ref={resultsRef} tabIndex={-1} aria-label="Medicine Catalogue Results" aria-busy={viewState === 'loading' || browseLoading}>
        {viewState === 'loading' && (
          /* State 1: Loading Skeleton Grid */
          <div className="md-medicine-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="md-medicine-card p-4 space-y-3">
                <Skeleton className="h-28 w-full rounded-xl" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
        )}

        {viewState === 'error' && (
          /* State 2: Dedicated Network / Service Error Card with Retry (Mutually exclusive from Empty Results) */
          <div className="md-error-card" role="alert">
            <div className="md-error-card-header">
              <div className="md-error-card-icon">
                <Icon name="warning" className="size-6 text-[var(--cc-danger)]" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[var(--cc-text)]">
                  {searchErrorKind === 'input' ? 'Check your search' : searchErrorKind === 'auth' ? 'Authentication required' : 'Catalogue Service Unavailable'}
                </h2>
                <p className="text-xs text-[var(--cc-muted)] mt-0.5">
                  {searchErrorKind === 'input' ? 'Update the search text and try again.' : searchErrorKind === 'auth' ? 'Please check your session.' : 'The medicine catalogue could not be queried at this time.'}
                </p>
              </div>
            </div>

            <div className="md-error-card-body">
              <p className="text-sm text-[var(--cc-text-soft)] leading-relaxed">
                {searchError}
              </p>
            </div>

            <div className="md-error-card-actions">
              {searchErrorKind === 'service' && <Button
                variant="primary"
                onClick={handleRetry}
                loading={searchLoading}
                className="font-semibold"
              >
                <Icon name="arrow" className="size-4" />
                <span>Retry search</span>
              </Button>}
              <Button
                variant="secondary"
                onClick={clearAllFilters}
                className="font-semibold"
              >
                Reset search
              </Button>
            </div>
          </div>
        )}

        {viewState === 'results' && (
          /* State 3: Successful Results Grid & Toolbar */
          <>
            {/* Safe Fallback Notice if Legacy Library is displaying */}
            {isFallback && (
              <div
                className="p-4 mb-4 rounded-xl border border-[var(--cc-border)] bg-[var(--cc-panel-muted)] flex items-start gap-3 text-xs"
                role="status"
              >
                <Icon name="bookmark" className="size-4 text-[var(--cc-primary)] shrink-0 mt-0.5" />
                <div>
                  <strong className="text-[var(--cc-text)] block font-semibold">
                    Supplemental Reference Library Results
                  </strong>
                  <span className="text-[var(--cc-text-soft)]">
                    No direct matches were found in the official catalogue for &quot;{queryFromUrl}&quot;. Showing {filteredResults.length} records from the supplemental legacy medicine database.
                  </span>
                  <button
                    type="button"
                    className="block mt-1.5 text-xs font-semibold text-[var(--cc-primary)] hover:underline"
                    onClick={() => {
                      const params: Record<string, string> = { q: queryFromUrl, source: 'official_catalogue' };
                      if (activeFormFilter !== 'All') params.form = activeFormFilter;
                      setSearchParams(params);
                    }}
                  >
                    Retry primary official catalogue
                  </button>
                </div>
              </div>
            )}

            <div className="md-results-toolbar">
              <div className="md-results-count" role="status" aria-live="polite" aria-atomic="true">
                {searchTotal !== null
                  ? `${searchTotal} formulation${searchTotal === 1 ? '' : 's'}`
                  : `${filteredResults.length} formulation${filteredResults.length === 1 ? '' : 's'} on this page`}
                {moreResultsAvailable && searchTotal === null && <span> · More matches available</span>}
                <span> · Page {currentPage}{totalPages !== null ? ` of ${totalPages}` : ''}</span>
                {isFallback ? (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--cc-warning-soft)] text-[var(--cc-warning)]">
                    Supplemental Legacy
                  </span>
                ) : (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--cc-primary-soft)] text-[var(--cc-primary)]">
                    Official catalogue
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {(activeFormFilter !== 'All' || queryFromUrl) && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-[var(--cc-primary)] hover:underline"
                    onClick={clearAllFilters}
                  >
                    Clear filters
                  </button>
                )}
                <label className="flex items-center gap-1.5 text-xs text-[var(--cc-muted)] font-medium">
                  Sort loaded results:
                  <select
                    className="md-sort-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'name_asc' | 'name_desc')}
                  >
                    <option value="name_asc">Name: A to Z</option>
                    <option value="name_desc">Name: Z to A</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Polished 3-Column Medicine Card Grid */}
            <div className="md-medicine-grid">
              {displayedItems.map((item) => {
                return (
                  <article className="md-medicine-card" key={item.id}>
                    {/* Top Status Bar */}
                    <div className="md-card-top-bar">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--cc-muted)]">
                        {item.dosage_form || 'Formulation'}
                      </span>
                      <Badge tone={item.catalogue_source === 'official_catalogue' ? 'info' : 'neutral'}>
                        {item.catalogue_source === 'official_catalogue' ? 'Official' : 'Supplemental Legacy'}
                      </Badge>
                    </div>

                    {/* Card Body */}
                    <div className="md-card-body">
                      <h3 className="md-card-title" title={item.canonical_name}>
                        {item.canonical_name}
                      </h3>

                      {item.brand_name ? (
                        <span className="md-card-brand-badge">
                          Brand: <span>{item.brand_name}</span>
                        </span>
                      ) : null}

                      <p className="md-card-ingredient md-catalog-ingredient">
                        <strong>Ingredient: </strong>
                        {item.generic_name || 'Not available'}
                      </p>

                      <div className="md-card-meta-row">
                        <span>{item.dosage_form || 'Formulation'}</span>
                        {item.strength_value ? (
                          <span>· Strength: {item.strength_value} {item.strength_unit ?? ''}</span>
                        ) : null}
                        {item.manufacturer_name ? (
                          <span className="truncate">· Mfr: {item.manufacturer_name}</span>
                        ) : null}
                      </div>

                      <p className="text-xs text-[var(--cc-muted)] mt-1.5">Price not available</p>
                      <span className="md-catalog-reference-status text-[11px] text-[var(--cc-muted)] mt-1.5">
                        {item.catalogue_source === 'official_catalogue' ? 'Official catalogue record' : 'Supplemental legacy record'}
                      </span>
                    </div>

                    {/* Card Actions */}
                    <div className="md-card-actions">
                      <button
                        type="button"
                        className="md-card-btn-view md-catalog-open"
                        aria-label={`View details for ${item.canonical_name}`}
                        onClick={() => handleViewDetail(item.id, item.catalogue_source)}
                      >
                        <span>View Details</span>
                        <Icon name="arrow" className="size-4" />
                      </button>
                      <Link
                        className="md-card-btn-compare"
                        to={`/compare-medicines?a=${encodeURIComponent(item.id)}&source=${item.catalogue_source}`}
                        aria-label={`Compare ${item.canonical_name}`}
                        title={`Compare ${item.canonical_name}`}
                      >
                        <Icon name="copy" className="size-4" />
                        <span>Compare</span>
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Pagination Controls */}
            {(currentPage > 1 || moreResultsAvailable) && (
              <nav className="flex items-center justify-center gap-4 mt-8 pt-4 border-t border-[var(--cc-border)]" aria-label="Medicine catalog pages">
                <Button
                  variant="secondary"
                  disabled={currentPage === 1}
                  onClick={() => navigateToPage(Math.max(1, currentPage - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs font-medium text-[var(--cc-text-soft)]">
                  Page {currentPage}{totalPages !== null ? ` of ${totalPages}` : ''}
                </span>
                <Button
                  variant="secondary"
                  disabled={!moreResultsAvailable || (totalPages !== null && currentPage >= totalPages)}
                  onClick={() => navigateToPage(currentPage + 1)}
                >
                  Next
                </Button>
              </nav>
            )}
          </>
        )}

        {viewState === 'empty' && (
          /* State 4: Genuine Empty Search Results (Only shown when API succeeds with 0 items) */
          <div className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-panel)] p-8">
            <EmptyState
              icon="search"
              title="No formulations found"
              description={`No catalogue entries matched "${queryFromUrl}" in the official catalogue or supplemental legacy library. Try searching by generic active ingredient (e.g. Paracetamol, Amoxicillin).`}
              action={<Button onClick={clearAllFilters}>Clear all filters</Button>}
            />
          </div>
        )}

        {viewState === 'initial' && (
          /* State 5: Initial Exploration & Discovery Showcase (Clean, non-redundant) */
          <div className="md-discovery-container">
            <h2>Official catalogue</h2>
            <p>Browse available records or search by formulation, active ingredient, brand, strength, or dosage form.</p>
            {browseLoading && <>
              <p role="status">Loading formulations…</p>
              <div className="md-medicine-grid">
                {Array.from({ length: 6 }).map((_, index) => <div key={index} className="md-medicine-card p-4 space-y-3">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-full" />
                </div>)}
              </div>
            </>}
            {browseError && <div role="alert">
              <p>Catalogue browsing is temporarily unavailable. Search remains available.</p>
              <Button variant="secondary" onClick={handleBrowseRetry}>Retry catalogue browsing</Button>
            </div>}
            {browseData && !browseLoading && <>
              <p>{browseData.total} formulations · Page {pageFromUrl}</p>
              {browseData.items.length === 0
                ? <p role="status">No formulation records are available for this filter.</p>
                : <div className="md-medicine-grid">{browseData.items.map(item => <article key={item.id} className="md-medicine-card p-4">
                  <div className="md-card-top-bar">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--cc-muted)]">{item.dosage_form ?? 'Formulation'}</span>
                    <Badge tone="info">Official</Badge>
                  </div>
                  <h3 className="md-card-title">{item.canonical_name}</h3>
                  <p className="text-sm">Ingredient: {item.generic_name ?? 'Not available'}</p>
                  <p className="text-sm">Strength: {item.strength_value !== null ? `${item.strength_value} ${item.strength_unit ?? ''}` : 'Not available'}</p>
                  <p className="text-xs text-[var(--cc-muted)]">Price not available</p>
                  <p className="text-xs text-[var(--cc-muted)]">
                    Source: {item.sources && item.sources.length > 0
                      ? item.sources.map((source) => formatSourceOrganization(source).shortName).join(', ')
                      : 'Official catalogue record'}
                  </p>
                  <div className="md-card-actions">
                    <Button
                      variant="secondary"
                      aria-label={`View details for ${item.canonical_name}`}
                      onClick={() => void handleViewDetail(item.id, item.catalogue_source)}
                    >
                      View details
                    </Button>
                    <Link
                      className="md-card-btn-compare"
                      to={`/compare-medicines?a=${encodeURIComponent(item.id)}&source=${item.catalogue_source}`}
                      aria-label={`Compare ${item.canonical_name}`}
                    >
                      <Icon name="copy" className="size-4" />
                      <span>Compare</span>
                    </Link>
                  </div>
                </article>)}</div>}
              <nav aria-label="Browse pages" className="flex gap-2 mt-4">
                <Button variant="secondary" disabled={pageFromUrl === 1} onClick={() => navigateToPage(pageFromUrl - 1)}>Previous</Button>
                <Button variant="secondary" disabled={!browseData.pagination.has_more} onClick={() => navigateToPage(pageFromUrl + 1)}>Next</Button>
              </nav>
            </>}
          </div>
        )}
      </section>
      {catalogueSuggestions.length > 0 && <aside className="md-popular-panel" aria-label="Catalogue search suggestions">
        <h2>From this catalogue page</h2>
        <p>Search a name found in the records shown.</p>
        <div className="md-popular-list">
          {catalogueSuggestions.map((item) => (
            <button key={item} type="button" className="md-suggestion-chip" onClick={() => handleQuickSearch(item)}>{item}</button>
          ))}
        </div>
      </aside>}
      </div>

      {/* ====================================================================
          E. MINIMAL REGULATORY-INFORMATION FOOTER
          ==================================================================== */}
      <footer className="md-pillars-banner mt-10" aria-label="Official regulatory reference pillars">
        <div className="md-pillar-item">
          <div className="md-pillar-icon">
            <Icon name="shield" className="size-4" />
          </div>
          <div>
            <h4 className="md-pillar-title">CDSCO Regulatory Reference</h4>
            <p className="md-pillar-desc">
              New drug approvals and combination notices gazetted by the Central Drugs Standard Control Organisation.
            </p>
          </div>
        </div>

        <div className="md-pillar-item">
          <div className="md-pillar-icon">
            <Icon name="bookmark" className="size-4" />
          </div>
          <div>
            <h4 className="md-pillar-title">NLEM 2022 Publication</h4>
            <p className="md-pillar-desc">
              Priority formulations indexed from the National List of Essential Medicines (MoHFW official publication).
            </p>
          </div>
        </div>

        <div className="md-pillar-item">
          <div className="md-pillar-icon">
            <Icon name="check" className="size-4" />
          </div>
          <div>
            <h4 className="md-pillar-title">NPPA Price Notifications</h4>
            <p className="md-pillar-desc">
              Statutory ceiling prices and DPCO price notifications gazetted by the National Pharmaceutical Pricing Authority.
            </p>
          </div>
        </div>
      </footer>

      {/* ====================================================================
          F. FORMULATION DETAILS MODAL
          ==================================================================== */}
      {selectedDetailId && (
        <MedicineCatalogDialog
          title={selectedDetail ? selectedDetail.canonical_name : 'Loading formulation details…'}
          onClose={closeDetailModal}
        >
          {detailLoading ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : detailError ? (
            <div className="p-6 text-center space-y-4">
              <p className="text-sm text-[var(--cc-danger)] font-medium">{detailError}</p>
              <Button variant="secondary" onClick={closeDetailModal}>
                Close
              </Button>
            </div>
          ) : selectedDetail ? (
            <div className="md-detail-container md-catalog-details">
              {/* The dialog title contains the formulation name. */}
              <div className="md-detail-hero-card">
                <div className="md-detail-title-block">
                  <div className="md-detail-badges">
                    <Badge tone={selectedDetail.catalogue_source === 'official_catalogue' ? 'info' : 'neutral'}>
                      {selectedDetail.catalogue_source === 'official_catalogue' ? 'Official catalogue record' : 'Supplemental legacy record'}
                    </Badge>
                    {selectedDetail.dosage_form ? <Badge>{selectedDetail.dosage_form}</Badge> : null}
                    {selectedDetail.brand_name ? (
                      <Badge tone="success">Brand: {selectedDetail.brand_name}</Badge>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Section 1: Overview */}
              <div>
                <h4 className="md-detail-section-title">
                  <Icon name="bookmark" className="size-4 text-[var(--cc-primary)]" />
                  Formulation Overview
                </h4>
                <div className="md-detail-overview-grid">
                  <div>
                    <div className="md-detail-dt">Brand Name</div>
                    <div className="md-detail-dd">{selectedDetail.brand_name ?? '—'}</div>
                  </div>
                  <div>
                    <div className="md-detail-dt">Generic Name</div>
                    <div className="md-detail-dd">{selectedDetail.generic_name ?? '—'}</div>
                  </div>
                  <div>
                    <div className="md-detail-dt">Dosage Form</div>
                    <div className="md-detail-dd">{selectedDetail.dosage_form ?? '—'}</div>
                  </div>
                  <div>
                    <div className="md-detail-dt">Manufacturer</div>
                    <div className="md-detail-dd">{selectedDetail.manufacturer_name ?? 'Not published'}</div>
                  </div>
                  <div>
                    <div className="md-detail-dt">Strength Specification</div>
                    <div className="md-detail-dd">
                      {selectedDetail.strength_value ? `${selectedDetail.strength_value} ${selectedDetail.strength_unit ?? ''}` : 'Not available'}
                    </div>
                  </div>
                  <div>
                    <div className="md-detail-dt">Catalogue Provenance</div>
                    <div className="md-detail-dd">
                      {selectedDetail.catalogue_source === 'official_catalogue' ? 'Official catalogue' : 'Supplemental legacy reference'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Active Ingredients */}
              <div>
                <h4 className="md-detail-section-title">
                  <Icon name="check" className="size-4 text-[var(--cc-primary)]" />
                  Active Ingredients ({selectedDetail.ingredients.length})
                </h4>
                {selectedDetail.ingredients.length > 0 ? (
                  <div className="md-table-wrapper">
                    <table className="md-premium-table">
                      <thead>
                        <tr>
                          <th>Active Substance</th>
                          <th>Strength</th>
                          <th>Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedDetail.ingredients.map((ing, idx) => (
                          <tr key={idx}>
                            <td className="font-semibold text-[var(--cc-text)]">{ing.name}</td>
                            <td>{ing.strength_value ?? '—'}</td>
                            <td>{ing.strength_unit ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--cc-muted)] italic">No active ingredient components registered.</p>
                )}
              </div>

              {/* Section 3: NPPA Price Schedule */}
              <div>
                <h4 className="md-detail-section-title">
                  <Icon name="shield" className="size-4 text-[var(--cc-primary)]" />
                  Available price information
                </h4>
                {verifiedPrices.length > 0 ? (
                  <div className="p-3.5 rounded-xl border border-[var(--cc-border)] bg-[var(--cc-panel-muted)] space-y-2 text-xs">
                    <p className="text-[var(--cc-muted)]">Pricing reference only; not prescribing guidance.</p>
                    {verifiedPrices.map((price, idx) => (
                      <div key={`${price.source_key}:${price.price_basis}:${idx}`} className="py-1">
                        <div className="flex justify-between items-center gap-3">
                          <span className="font-medium text-[var(--cc-text)]">
                            {PRICE_BASIS_LABELS[price.price_basis]}
                          </span>
                          <span className="font-bold text-[var(--cc-primary)] text-sm">
                            {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(price.amount)}
                          </span>
                        </div>
                        {price.package_description && <p>Package: {price.package_description}</p>}
                        {price.package_unit && <p>Unit: {price.package_unit}</p>}
                        <p>Source: {formatSourceOrganization(price.source_key).shortName}</p>
                        <p>Effective date: {price.effective_on ?? 'Not available'}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl border border-[var(--cc-border)] bg-[var(--cc-panel-muted)] text-xs text-[var(--cc-muted)]">
                    Price not available. No verified source-linked price is available for this formulation.
                  </div>
                )}
              </div>

              {/* Section 4: Verified Regulatory Sources */}
              {selectedDetail.sources.length > 0 && (
                <div>
                  <h4 className="md-detail-section-title">
                    <Icon name="shield" className="size-4 text-[var(--cc-primary)]" />
                    Source evidence
                  </h4>
                  <div className="grid gap-2">
                    {selectedDetail.sources.map((srcId, idx) => {
                      const org = formatSourceOrganization(srcId);
                      return (
                        <div
                          key={idx}
                          className="p-3 rounded-xl bg-[var(--cc-panel-muted)] border border-[var(--cc-border)] flex items-start gap-2.5 text-xs"
                        >
                          <span className="size-2 rounded-full bg-[var(--cc-primary)] shrink-0 mt-1" />
                          <div>
                            <strong className="text-[var(--cc-text)] block font-semibold">
                              {org.fullName}
                              {org.isPublication ? (
                                <span className="ml-1.5 font-normal text-[11px] text-[var(--cc-muted)] uppercase tracking-wider">
                                  [Reference Publication]
                                </span>
                              ) : null}
                            </strong>
                            <span className="text-[var(--cc-muted)]">{org.role}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Section 5: Technical Provenance (Collapsible) */}
              <details className="md-provenance-box">
                <summary className="md-provenance-summary">
                  Technical Provenance &amp; Identifiers
                </summary>
                <div className="md-provenance-details space-y-1">
                  <div><strong>Formulation ID:</strong> {selectedDetail.id}</div>
                  <div><strong>Namespace:</strong> {selectedDetail.id_namespace}</div>
                  {selectedDetail.aliases.length > 0 && (
                    <div><strong>Registered Aliases:</strong> {selectedDetail.aliases.join(', ')}</div>
                  )}
                </div>
              </details>

              {/* Modal Footer Actions */}
              <div className="pt-2 flex flex-wrap gap-2.5">
                <Link
                  className="cc-button cc-button--primary flex-1 font-semibold"
                  to={`/compare-medicines?a=${encodeURIComponent(selectedDetail.id)}&source=${selectedDetailSource}`}
                >
                  <Icon name="copy" className="size-4" />
                  <span>Compare this Medicine</span>
                </Link>
                <Button variant="secondary" onClick={closeDetailModal}>
                  Back to library
                </Button>
              </div>
            </div>
          ) : null}
        </MedicineCatalogDialog>
      )}
    </div>
  );
}
