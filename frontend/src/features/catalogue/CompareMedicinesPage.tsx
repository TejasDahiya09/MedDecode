import { useEffect, useId, useRef, useState, useCallback, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, EmptyState, Skeleton } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { formatSourceOrganization } from './catalogue-sources';
import {
  compareMedicineCatalogue,
  fetchMedicineCatalogueDetail,
  searchMedicineCatalogue,
  type CatalogueMedicineDetail,
  type CatalogueMedicineSummary,
  type CatalogueSource,
} from './medicine-catalogue-api';
import { ApiError } from '../../services/api-client';
import { useAuth } from '../auth/AuthProvider';
import '../demo/compare-medicines.css';

type ComparisonSlot = 'a' | 'b';

const POPULAR_SEARCH_SUGGESTIONS = [
  'Paracetamol',
  'Amoxicillin',
  'Metformin',
  'Atorvastatin',
  'Ibuprofen',
  'Azithromycin',
  'Pantoprazole',
  'Cetirizine',
];

function formatVerifiedPrice(prices: readonly unknown[] | undefined | null): string {
  if (!prices || !Array.isArray(prices) || prices.length === 0) {
    return 'Not available';
  }
  const first = prices[0];
  if (typeof first === 'number' && Number.isFinite(first) && first > 0) {
    return `₹${first.toFixed(2)}`;
  }
  if (typeof first === 'object' && first !== null) {
    const obj = first as Record<string, unknown>;
    const val = obj.ceiling_price ?? obj.price ?? obj.rate;
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      return `₹${val.toFixed(2)}${typeof obj.unit === 'string' ? ` per ${obj.unit}` : ''}`;
    }
    if (typeof val === 'string' && /^\d+(\.\d+)?$/.test(val) && Number(val) > 0) {
      return `₹${Number(val).toFixed(2)}${typeof obj.unit === 'string' ? ` per ${obj.unit}` : ''}`;
    }
  }
  return 'Not available';
}

function SelectionCard({
  slot,
  item,
  loading,
  onChoose,
  onRemove,
}: {
  slot: ComparisonSlot;
  item: CatalogueMedicineDetail | null;
  loading: boolean;
  onChoose: () => void;
  onRemove: () => void;
}) {
  const is1 = slot === 'a';
  const label = is1 ? 'Medicine 1' : 'Medicine 2';

  if (loading) {
    return (
      <article className="md-compare-slot is-loading" aria-busy="true">
        <div className="p-6 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-24 rounded-md" />
            <Skeleton className="h-6 w-28 rounded-md" />
          </div>
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </article>
    );
  }

  return (
    <article
      className={`md-compare-slot ${item ? 'is-selected' : 'is-empty'}`}
      aria-label={`${label}${item ? `: ${item.canonical_name}` : ': no selection'}`}
    >
      {item ? (
        <div className="md-compare-slot-body">
          <div className="md-compare-slot-label">
            <div className="flex items-center gap-2">
              <Badge tone="info">{label}</Badge>
              <span className="text-xs font-medium text-[var(--cc-muted)]">
                Official Gazette Record
              </span>
            </div>
            <span className="text-[11px] font-mono text-[var(--cc-muted)]">
              {item.dosage_form || 'Formulation'}
            </span>
          </div>

          <h2 className="md-compare-slot-title">{item.canonical_name}</h2>

          <div className="md-compare-slot-meta space-y-1.5 mt-2">
            <p className="text-xs text-[var(--cc-text)]">
              <span className="text-[var(--cc-muted)]">Active substance:</span>{' '}
              <strong>{item.generic_name || 'Active component specified in formulation'}</strong>
            </p>
            <p className="text-xs text-[var(--cc-muted)]">
              <span>Formulation:</span>{' '}
              <span className="text-[var(--cc-text)]">
                {item.dosage_form || 'Not specified'}
                {item.strength_value ? ` · ${item.strength_value} ${item.strength_unit ?? ''}` : ''}
              </span>
            </p>
            {item.brand_name ? (
              <p className="text-xs text-[var(--cc-muted)]">
                <span>Brand reference:</span>{' '}
                <span className="text-[var(--cc-text)]">{item.brand_name}</span>
              </p>
            ) : null}
            <p className="font-mono text-[11px] text-[var(--cc-muted)] truncate pt-1 border-t border-[var(--cc-border)]/50">
              Ref ID: {item.id}
            </p>
          </div>

          <div className="md-compare-slot-actions">
            <Button variant="secondary" onClick={onChoose} aria-label={`Change ${label}`}>
              Change medicine
            </Button>
            <Button variant="ghost" onClick={onRemove} aria-label={`Remove ${item.canonical_name} from ${label}`}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="md-compare-empty">
          <div className="md-compare-slot-label mb-2">
            <Badge tone="neutral">{label}</Badge>
          </div>
          <h2>Select {label}</h2>
          <p>Choose an official formulation from the catalogue to compare.</p>
          <Button onClick={onChoose} aria-label={`Select ${label}`}>
            Select medicine
          </Button>
        </div>
      )}
    </article>
  );
}

function CompareMedicineDialog({
  title,
  subtitle,
  onClose,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  onClose: () => void;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pointerOutside = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { scrollX, scrollY } = window;
    const body = document.body;
    const saved = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      width: body.style.width,
    };
    const rootOverflow = document.documentElement.style.overflow;
    Object.assign(body.style, {
      overflow: 'hidden',
      position: 'fixed',
      top: `${-scrollY}px`,
      left: `${-scrollX}px`,
      width: '100%',
    });
    document.documentElement.style.overflow = 'hidden';

    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }

    dialog.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });

    return () => {
      if (typeof dialog.close === 'function') {
        try {
          dialog.close();
        } catch {
          dialog.removeAttribute('open');
        }
      } else {
        dialog.removeAttribute('open');
      }
      Object.assign(body.style, saved);
      document.documentElement.style.overflow = rootOverflow;
      window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
    };
  }, []);

  const outside = (event: { currentTarget: HTMLDialogElement; clientX: number; clientY: number }) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    );
  };

  return createPortal(
    <dialog
      ref={ref}
      role="dialog"
      className="md-compare-dialog cc-modal"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        pointerOutside.current = event.target === event.currentTarget && outside(event);
      }}
      onClick={(event) => {
        if (pointerOutside.current && event.target === event.currentTarget && outside(event)) {
          onClose();
        }
        pointerOutside.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ];
        if (controls.length === 0) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="md-compare-dialog-head">
        <div>
          <h2 id={titleId} className="cc-section-title">
            {title}
          </h2>
          {subtitle ? <p className="text-xs text-[var(--cc-muted)] mt-1">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          className="cc-icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" className="size-5" />
        </button>
      </header>
      <div className="md-compare-dialog-content">{children}</div>
    </dialog>,
    document.querySelector('.cc-app-shell') ?? document.body,
  );
}

export function CompareMedicinesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAuth();
  const countId = useId();

  const idA = searchParams.get('a');
  const idB = searchParams.get('b');
  // Use genuine official catalogue by default. Preserve any active query param for backward compatibility.
  const activeSource: CatalogueSource = (searchParams.get('source') as CatalogueSource) || 'official_catalogue';

  const [medicineA, setMedicineA] = useState<CatalogueMedicineDetail | null>(null);
  const [medicineB, setMedicineB] = useState<CatalogueMedicineDetail | null>(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  // Picker Modal State
  const [pickerSlot, setPickerSlot] = useState<ComparisonSlot | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<{ message: string; isUnavailable: boolean; status?: number | null } | null>(null);
  const [pickerResults, setPickerResults] = useState<readonly CatalogueMedicineSummary[]>([]);
  const pickerInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    const token = auth.getAccessToken() ?? '';

    // Both selected: execute comparison API
    if (idA && idB) {
      setComparing(true);
      setLoadingA(true);
      setLoadingB(true);
      setCompareError(null);
      try {
        const result = await compareMedicineCatalogue(idA, idB, activeSource, token);
        setMedicineA(result.medicines[0] ?? null);
        setMedicineB(result.medicines[1] ?? null);
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 503) {
          setCompareError('Medicine catalogue temporarily unavailable. Please try again.');
        } else {
          setCompareError('Unable to generate side-by-side comparison. Check catalogue records and try again.');
        }
      } finally {
        setComparing(false);
        setLoadingA(false);
        setLoadingB(false);
      }
      return;
    }

    // Only slot A selected
    if (idA && !idB) {
      setMedicineB(null);
      setLoadingA(true);
      setCompareError(null);
      try {
        const detail = await fetchMedicineCatalogueDetail(idA, activeSource, token);
        setMedicineA(detail);
      } catch {
        setMedicineA(null);
      } finally {
        setLoadingA(false);
      }
      return;
    }

    // Only slot B selected
    if (!idA && idB) {
      setMedicineA(null);
      setLoadingB(true);
      setCompareError(null);
      try {
        const detail = await fetchMedicineCatalogueDetail(idB, activeSource, token);
        setMedicineB(detail);
      } catch {
        setMedicineB(null);
      } finally {
        setLoadingB(false);
      }
      return;
    }

    // Neither selected
    setMedicineA(null);
    setMedicineB(null);
    setCompareError(null);
  }, [idA, idB, activeSource, auth]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return loadData();
      return undefined;
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  function handleSwap() {
    if (!idA && !idB) return;
    const next = new URLSearchParams(searchParams);
    if (idB) next.set('a', idB);
    else next.delete('a');
    if (idA) next.set('b', idA);
    else next.delete('b');
    setSearchParams(next);
  }

  function handleClear() {
    const next = new URLSearchParams();
    if (activeSource !== 'official_catalogue') {
      next.set('source', activeSource);
    }
    setSearchParams(next);
    setMedicineA(null);
    setMedicineB(null);
  }

  function handleRemoveSlot(slot: ComparisonSlot) {
    const next = new URLSearchParams(searchParams);
    next.delete(slot);
    setSearchParams(next);
    if (slot === 'a') setMedicineA(null);
    else setMedicineB(null);
  }

  const executePickerSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q || q.length < 2) {
      setPickerResults([]);
      setPickerLoading(false);
      setPickerError(null);
      return;
    }

    setPickerLoading(true);
    setPickerError(null);

    try {
      const token = auth.getAccessToken() ?? '';
      const resp = await searchMedicineCatalogue(q, { source: activeSource, limit: 20 }, token);
      setPickerResults(resp.items);
      setPickerError(null);
    } catch (err: unknown) {
      setPickerResults([]);
      let is503 = false;
      let status: number | null = null;
      let message = 'Medicine catalogue temporarily unavailable';

      if (err instanceof ApiError) {
        status = err.status;
        if (err.status === 503) {
          is503 = true;
          message = 'Medicine catalogue temporarily unavailable';
        } else if (err.status === 401 || err.status === 403) {
          message = 'An authenticated session is required to search the official medicine catalogue.';
        } else if (err.status === 400) {
          message = 'Search query must be between 2 and 80 alphanumeric characters.';
        } else if (err.kind === 'network' || !err.status) {
          message = 'Unable to reach the medicine catalogue service. Please verify your connection.';
        } else {
          message = `The medicine catalogue service encountered an error (${err.status}).`;
        }
      }

      setPickerError({ message, isUnavailable: is503, status });
    } finally {
      setPickerLoading(false);
    }
  }, [activeSource, auth]);

  // Debounced search trigger on query changes
  useEffect(() => {
    let active = true;
    const q = pickerQuery.trim();
    if (!q || q.length < 2) return;

    const timer = setTimeout(() => {
      if (active) {
        void executePickerSearch(q);
      }
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pickerQuery, executePickerSearch]);

  function handleSelectSlotMedicine(slot: ComparisonSlot, item: CatalogueMedicineSummary) {
    const next = new URLSearchParams(searchParams);
    next.set(slot, item.id);
    if (activeSource !== 'official_catalogue') {
      next.set('source', activeSource);
    }
    setSearchParams(next);
    setPickerSlot(null);
    setPickerQuery('');
    setPickerResults([]);
    setPickerError(null);
  }

  const bothSelected = Boolean(idA && idB && medicineA && medicineB);
  const differentForms = bothSelected && medicineA?.dosage_form !== medicineB?.dosage_form;
  const differentStrengths =
    bothSelected &&
    (medicineA?.strength_value !== medicineB?.strength_value ||
      medicineA?.strength_unit !== medicineB?.strength_unit);

  const priceA = bothSelected ? formatVerifiedPrice(medicineA?.prices) : 'Not available';
  const priceB = bothSelected ? formatVerifiedPrice(medicineB?.prices) : 'Not available';
  const differentPrices = bothSelected && priceA !== 'Not available' && priceB !== 'Not available' && priceA !== priceB;

  const excludedId = pickerSlot === 'a' ? idB : idA;

  return (
    <div className="md-page md-compare">
      {/* Header */}
      <header className="md-compare-header">
        <div>
          <div className="md-compare-title-line">
            <h1 className="cc-page-title">Compare Medicines</h1>
          </div>
          <p>Compare official formulation details side by side.</p>
          <p className="md-compare-safety">
            <Icon name="shield" />
            <span>
              <strong>Clinical Independence Standard:</strong> Objective attribute comparisons only. Comparisons do not establish clinical equivalence or commercial substitutions.
            </span>
          </p>
        </div>
      </header>

      {/* Slots Section */}
      <section className="md-compare-slots" aria-label="Medicine selections">
        <div>
          <SelectionCard
            slot="a"
            item={medicineA}
            loading={loadingA || comparing}
            onChoose={() => {
              setPickerSlot('a');
              setPickerQuery('');
              setPickerResults([]);
              setPickerError(null);
            }}
            onRemove={() => handleRemoveSlot('a')}
          />
        </div>
        <div>
          <SelectionCard
            slot="b"
            item={medicineB}
            loading={loadingB || comparing}
            onChoose={() => {
              setPickerSlot('b');
              setPickerQuery('');
              setPickerResults([]);
              setPickerError(null);
            }}
            onRemove={() => handleRemoveSlot('b')}
          />
        </div>
      </section>

      {/* Controls Bar: Swap, Clear, and ONE Browse Medicine Library action */}
      <div className="md-compare-actions" aria-label="Comparison controls">
        <Button
          variant="secondary"
          disabled={!idA || !idB}
          onClick={handleSwap}
          aria-label="Swap medicines"
        >
          <Icon name="arrow" />
          <span>Swap medicines</span>
        </Button>
        <Button
          variant="secondary"
          disabled={!idA && !idB}
          onClick={handleClear}
          aria-label="Clear comparison"
        >
          <Icon name="close" />
          <span>Clear comparison</span>
        </Button>
        <Link className="cc-button cc-button--ghost" to="/medicine-library">
          Browse Medicine Library <Icon name="arrow" />
        </Link>
      </div>

      {compareError && (
        <div role="alert" className="p-4 rounded-xl border border-[var(--cc-danger)]/40 bg-[var(--cc-danger-soft)]/20 text-xs text-[var(--cc-danger)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon name="warning" className="size-4 shrink-0" />
            <span>{compareError}</span>
          </div>
          <Button
            variant="secondary"
            loading={comparing}
            onClick={() => void loadData()}
            className="text-xs h-7 px-2.5 shrink-0 self-start sm:self-auto"
          >
            Retry comparison
          </Button>
        </div>
      )}

      {/* Empty / Guidance Box when not both selected (NO duplicate browse button) */}
      {!bothSelected ? (
        <section className="md-compare-guidance" aria-label="Comparison guidance">
          <span className="md-compare-guidance-icon">
            <Icon name="copy" />
          </span>
          <div>
            <h2>Select Two Formulations to Compare</h2>
            <p>
              {idA || idB
                ? 'Choose another formulation to inspect side-by-side active ingredients, dosage forms, and price schedules.'
                : 'Select two formulations from the official catalogue to compare their formulation details.'}
            </p>
          </div>
        </section>
      ) : (
        /* Detailed Side-by-Side Comparison Matrix */
        <section className="md-compare-details" aria-labelledby="comparison-details-title">
          <div className="md-compare-details-head">
            <div>
              <p className="cc-eyebrow">Comparison Evidence Breakdown</p>
              <h2 id="comparison-details-title">Side-by-side comparison</h2>
            </div>
            <div className="md-compare-column-names" aria-hidden="true">
              <span>Medicine 1 · {medicineA!.canonical_name}</span>
              <span>Medicine 2 · {medicineB!.canonical_name}</span>
            </div>
          </div>

          <dl>
            {/* Formulation Name */}
            <div className="md-compare-row">
              <dt>Formulation Name</dt>
              <dd>
                <span className="md-compare-mobile-label">Medicine 1</span>
                <strong>{medicineA!.canonical_name}</strong>
              </dd>
              <dd>
                <span className="md-compare-mobile-label">Medicine 2</span>
                <strong>{medicineB!.canonical_name}</strong>
              </dd>
            </div>

            {/* Brand Name */}
            <div className="md-compare-row">
              <dt>Brand Name / Aliases</dt>
              <dd>
                <span className="md-compare-mobile-label">Medicine 1</span>
                <div>
                  <span className="font-medium">{medicineA!.brand_name ?? '—'}</span>
                  {medicineA!.aliases && medicineA!.aliases.length > 0 ? (
                    <p className="text-xs text-[var(--cc-muted)] mt-0.5">
                      Aliases: {medicineA!.aliases.join(', ')}
                    </p>
                  ) : null}
                </div>
              </dd>
              <dd>
                <span className="md-compare-mobile-label">Medicine 2</span>
                <div>
                  <span className="font-medium">{medicineB!.brand_name ?? '—'}</span>
                  {medicineB!.aliases && medicineB!.aliases.length > 0 ? (
                    <p className="text-xs text-[var(--cc-muted)] mt-0.5">
                      Aliases: {medicineB!.aliases.join(', ')}
                    </p>
                  ) : null}
                </div>
              </dd>
            </div>

            {/* Generic / Active Substance */}
            <div className="md-compare-row">
              <dt>Generic Substance</dt>
              <dd>
                <span className="md-compare-mobile-label">Medicine 1</span>
                {medicineA!.generic_name ?? '—'}
              </dd>
              <dd>
                <span className="md-compare-mobile-label">Medicine 2</span>
                {medicineB!.generic_name ?? '—'}
              </dd>
            </div>

            {/* Dosage Form */}
            <div className="md-compare-row">
              <dt>
                Dosage Form
                {differentForms && <span className="md-compare-difference">Different form</span>}
              </dt>
              <dd>
                <span className="md-compare-mobile-label">Medicine 1</span>
                <Badge tone="info">{medicineA!.dosage_form ?? 'Unspecified'}</Badge>
              </dd>
              <dd>
                <span className="md-compare-mobile-label">Medicine 2</span>
                <Badge tone="info">{medicineB!.dosage_form ?? 'Unspecified'}</Badge>
              </dd>
            </div>

            {/* Strength */}
            <div className="md-compare-row">
              <dt>
                Strength
                {differentStrengths && <span className="md-compare-difference">Different strength</span>}
              </dt>
              <dd>
                <span className="md-compare-mobile-label">Medicine 1</span>
                {medicineA!.strength_value ? `${medicineA!.strength_value} ${medicineA!.strength_unit ?? ''}` : '—'}
              </dd>
              <dd>
                <span className="md-compare-mobile-label">Medicine 2</span>
                {medicineB!.strength_value ? `${medicineB!.strength_value} ${medicineB!.strength_unit ?? ''}` : '—'}
              </dd>
            </div>

            {/* Active Ingredients List */}
            <div className="md-compare-row">
              <dt>Active Ingredients</dt>
              <dd>
                <span className="md-compare-mobile-label">Medicine 1</span>
                <ul className="space-y-1">
                  {medicineA!.ingredients.map((ing, idx) => (
                    <li key={idx} className="flex items-center gap-1.5 text-xs">
                      <span className="size-1.5 rounded-full bg-[var(--cc-primary)] shrink-0" />
                      <span>{ing.name} ({ing.strength_value ?? '—'} {ing.strength_unit ?? ''})</span>
                    </li>
                  ))}
                  {medicineA!.ingredients.length === 0 && <li>—</li>}
                </ul>
              </dd>
              <dd>
                <span className="md-compare-mobile-label">Medicine 2</span>
                <ul className="space-y-1">
                  {medicineB!.ingredients.map((ing, idx) => (
                    <li key={idx} className="flex items-center gap-1.5 text-xs">
                      <span className="size-1.5 rounded-full bg-[var(--cc-primary)] shrink-0" />
                      <span>{ing.name} ({ing.strength_value ?? '—'} {ing.strength_unit ?? ''})</span>
                    </li>
                  ))}
                  {medicineB!.ingredients.length === 0 && <li>—</li>}
                </ul>
              </dd>
            </div>

            {/* Manufacturer */}
            <div className="md-compare-row">
              <dt>Manufacturer</dt>
              <dd>
                <span className="md-compare-mobile-label">Medicine 1</span>
                {medicineA!.manufacturer_name ?? 'Not published'}
              </dd>
              <dd>
                <span className="md-compare-mobile-label">Medicine 2</span>
                {medicineB!.manufacturer_name ?? 'Not published'}
              </dd>
            </div>

            {/* Verified Price (NPPA / PMBI) */}
            <div className="md-compare-row">
              <dt>
                Verified Retail Price (NPPA / PMBI)
                {differentPrices && <span className="md-compare-difference">Different price</span>}
              </dt>
              <dd>
                <span className="md-compare-mobile-label">Medicine 1</span>
                <span className={priceA !== 'Not available' ? 'font-semibold text-[var(--cc-text)]' : 'text-[var(--cc-muted)]'}>
                  {priceA}
                </span>
              </dd>
              <dd>
                <span className="md-compare-mobile-label">Medicine 2</span>
                <span className={priceB !== 'Not available' ? 'font-semibold text-[var(--cc-text)]' : 'text-[var(--cc-muted)]'}>
                  {priceB}
                </span>
              </dd>
            </div>

            {/* Regulatory Sources */}
            <div className="md-compare-row">
              <dt>Regulatory Provenance</dt>
              <dd>
                <span className="md-compare-mobile-label">Medicine 1</span>
                <div className="space-y-1">
                  {medicineA!.sources.map((s, idx) => {
                    const org = formatSourceOrganization(s);
                    return (
                      <div key={idx} className="text-xs">
                        <strong>{org.shortName}</strong> ({org.role})
                      </div>
                    );
                  })}
                  {medicineA!.sources.length === 0 && <span>—</span>}
                </div>
              </dd>
              <dd>
                <span className="md-compare-mobile-label">Medicine 2</span>
                <div className="space-y-1">
                  {medicineB!.sources.map((s, idx) => {
                    const org = formatSourceOrganization(s);
                    return (
                      <div key={idx} className="text-xs">
                        <strong>{org.shortName}</strong> ({org.role})
                      </div>
                    );
                  })}
                  {medicineB!.sources.length === 0 && <span>—</span>}
                </div>
              </dd>
            </div>

            {/* Source Reference & Namespace */}
            <div className="md-compare-row">
              <dt>Official Source Reference</dt>
              <dd>
                <span className="md-compare-mobile-label">Medicine 1</span>
                <div className="font-mono text-xs text-[var(--cc-muted)] space-y-0.5">
                  <p className="truncate">Namespace: {medicineA!.id_namespace}</p>
                  <p className="truncate">ID: {medicineA!.id}</p>
                </div>
              </dd>
              <dd>
                <span className="md-compare-mobile-label">Medicine 2</span>
                <div className="font-mono text-xs text-[var(--cc-muted)] space-y-0.5">
                  <p className="truncate">Namespace: {medicineB!.id_namespace}</p>
                  <p className="truncate">ID: {medicineB!.id}</p>
                </div>
              </dd>
            </div>
          </dl>

          <p className="md-compare-limit">
            <Icon name="shield" />
            <span>
              <strong>Clinical Independence Standard:</strong> Matching or differing formulation attributes do not establish clinical equivalence, therapeutic safety, interchangeability, or brand substitution. Consult a physician or pharmacist.
            </span>
          </p>
        </section>
      )}

      <p className="md-demo-footnote">
        Indian Medicine Catalogue Reference · Side-by-side formulation comparison · Informational use only
      </p>

      {/* Medicine Comparison Picker Dialog */}
      {pickerSlot && (
        <CompareMedicineDialog
          title={pickerSlot === 'a' ? 'Select first medicine' : 'Select second medicine'}
          subtitle="Choose an official formulation to compare details."
          onClose={() => {
            setPickerSlot(null);
            setPickerQuery('');
            setPickerResults([]);
            setPickerError(null);
          }}
        >
          <div className="md-compare-picker">
            <form
              className="cc-market-search md-compare-picker-search"
              role="search"
              onSubmit={(e) => e.preventDefault()}
            >
              <label className="sr-only" htmlFor={`${countId}-search`}>
                Search by medicine name or ingredient
              </label>
              <Icon name="search" />
              <input
                ref={pickerInputRef}
                id={`${countId}-search`}
                type="text"
                inputMode="search"
                autoComplete="off"
                placeholder="Search formulations (e.g. Paracetamol, Amoxicillin)..."
                value={pickerQuery}
                onChange={(e) => {
                  const value = e.target.value;
                  setPickerQuery(value);
                  if (value.trim().length < 2) {
                    setPickerResults([]);
                    setPickerLoading(false);
                    setPickerError(null);
                  }
                }}
                aria-describedby={countId}
              />
              {pickerQuery ? (
                <button
                  type="button"
                  aria-label="Clear search input"
                  onClick={() => {
                    setPickerQuery('');
                    setPickerError(null);
                    setPickerResults([]);
                    pickerInputRef.current?.focus();
                  }}
                >
                  <Icon name="close" />
                </button>
              ) : null}
            </form>

            <p
              id={countId}
              className={`md-compare-picker-count ${pickerError ? 'text-[var(--cc-danger)]' : ''}`}
              role={pickerError ? 'alert' : 'status'}
              aria-live="polite"
            >
              {pickerLoading
                ? 'Searching formulations…'
                : pickerError
                ? pickerError.message
                : pickerQuery.trim().length >= 2
                ? `${pickerResults.length} formulation${pickerResults.length === 1 ? '' : 's'} available`
                : 'Type at least 2 characters to search catalogue'}
            </p>

            {/* Popular Search Suggestions (when search query is short and no error) */}
            {pickerQuery.trim().length < 2 && !pickerError ? (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-medium text-[var(--cc-muted)]">Common formulation searches:</p>
                <div className="flex flex-wrap gap-1.5">
                  {POPULAR_SEARCH_SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="px-2.5 py-1 text-xs rounded-lg border border-[var(--cc-border)] bg-[var(--cc-panel)] hover:border-[var(--cc-primary)] hover:text-[var(--cc-primary)] text-[var(--cc-text)] transition-colors cursor-pointer"
                      onClick={() => {
                        setPickerQuery(suggestion);
                        pickerInputRef.current?.focus();
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {pickerLoading ? (
              <div className="p-4 space-y-2" aria-busy="true">
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-14 w-full rounded-xl" />
              </div>
            ) : pickerError ? (
              <div
                role="alert"
                className="p-4 rounded-xl border border-[var(--cc-danger)]/40 bg-[var(--cc-danger-soft)]/20 text-xs text-[var(--cc-danger)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2">
                  <Icon name="warning" className="size-4 shrink-0" />
                  <span>{pickerError.message}</span>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void executePickerSearch(pickerQuery)}
                  className="text-xs h-7 px-2.5 shrink-0 self-start sm:self-auto"
                >
                  Retry
                </Button>
              </div>
            ) : pickerResults.length > 0 ? (
              <div className="md-compare-picker-list" role="list">
                {pickerResults.map((item) => {
                  const isExcluded = item.id === excludedId;
                  const otherMedicineLabel = pickerSlot === 'a' ? 'Medicine 2' : 'Medicine 1';
                  return (
                    <button
                      type="button"
                      role="listitem"
                      disabled={isExcluded}
                      className={`md-compare-picker-item ${isExcluded ? 'is-disabled opacity-50 cursor-not-allowed' : ''}`}
                      key={item.id}
                      onClick={() => {
                        if (!isExcluded) {
                          handleSelectSlotMedicine(pickerSlot, item);
                        }
                      }}
                    >
                      <span className="md-compare-picker-icon-box">
                        <Icon name="briefcase" className="size-5 text-[var(--cc-primary)]" />
                      </span>
                      <span className="min-w-0">
                        <strong className="truncate block">{item.canonical_name}</strong>
                        {item.generic_name && item.generic_name !== item.canonical_name ? (
                          <small className="truncate block text-[var(--cc-muted)]">Active: {item.generic_name}</small>
                        ) : null}
                        {item.brand_name ? <small className="truncate block">Brand: {item.brand_name}</small> : null}
                        <small className="truncate block">
                          {item.dosage_form || 'Formulation'}{' '}
                          {item.strength_value ? `· ${item.strength_value} ${item.strength_unit ?? ''}` : ''}
                        </small>
                      </span>
                      {isExcluded ? (
                        <span className="text-[10px] uppercase font-semibold text-[var(--cc-warning,#d97706)] shrink-0">
                          Selected as {otherMedicineLabel}
                        </span>
                      ) : (
                        <Icon name="arrow" className="shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : pickerQuery.trim().length >= 2 ? (
              <EmptyState
                icon="search"
                title="No formulations found"
                description={`No matching formulations found for "${pickerQuery}".`}
                action={
                  <Button variant="secondary" onClick={() => setPickerQuery('')}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <div className="py-4 text-center text-xs text-[var(--cc-muted)]">
                Search the 4,802 verified formulations by generic or canonical name to compare.
              </div>
            )}
          </div>
        </CompareMedicineDialog>
      )}
    </div>
  );
}
