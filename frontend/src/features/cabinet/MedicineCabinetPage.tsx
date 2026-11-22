import { Link } from 'react-router-dom';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ApiError } from '../../services/api-client';
import { useAuth } from '../auth/AuthProvider';
import {
  addMedicineCabinetEntry,
  fetchMedicineCabinet,
  removeMedicineCabinetEntry,
  updateMedicineCabinetEntry,
  type CabinetFields,
  type MedicineCabinetItem,
} from './medicine-cabinet-api';
import { searchMedicineCatalogue, type CatalogueMedicineSummary } from '../catalogue/medicine-catalogue-api';
import './medicine-cabinet.css';

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Your session expired. Sign in again to view your cabinet.';
    if (cause.status === 503) return 'The medicine cabinet service is temporarily unavailable (HTTP 503). Please try again shortly.';
    if (cause.status === 500) return 'The medicine cabinet backend encountered an internal database error (HTTP 500).';
    if (cause.status === 502) return 'The medicine cabinet service returned an unexpected response (HTTP 502).';
    if (cause.kind === 'network') return 'Could not connect to the medicine cabinet service. Check your connection.';
  }
  return 'Unable to load your medicine cabinet. Please try again.';
}

function metadata(value: string | null): string {
  return value ?? 'Not provided';
}

function formatDisplayDate(value: string | null): string {
  if (!value) return 'Not provided';
  const parsed = new Date(value.includes('T') ? value : `${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    : value;
}

function getExpiryStatus(expiryDateStr: string | null): { label: string; tone: 'danger' | 'warning' | 'neutral' } | null {
  if (!expiryDateStr) return null;
  const expiry = new Date(`${expiryDateStr}T00:00:00Z`);
  if (!Number.isFinite(expiry.getTime())) return null;
  const now = new Date();
  const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return { label: 'Expired', tone: 'danger' };
  }
  if (diffDays <= 30) {
    return { label: `Expiring soon (${diffDays}d)`, tone: 'warning' };
  }
  return { label: 'Active', tone: 'neutral' };
}

export function MedicineCabinetPage() {
  const auth = useAuth();
  const token = auth.getAccessToken();
  const [editing, setEditing] = useState<MedicineCabinetItem | 'new' | null>(null);
  const [medicineQuery, setMedicineQuery] = useState('');
  const [medicineChoices, setMedicineChoices] = useState<readonly CatalogueMedicineSummary[]>([]);
  const [medicineId, setMedicineId] = useState('');
  const [selectedMedicineName, setSelectedMedicineName] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [fields, setFields] = useState<CabinetFields>({
    quantity: null,
    purchase_date: null,
    expiry_date: null,
    refill_date: null,
    usage_information: null,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'expiring' | 'expired'>('all');

  const modalRef = useRef<HTMLDivElement>(null);
  const modalOpenerRef = useRef<HTMLElement | null>(null);
  const wasEditingRef = useRef(false);

  const cabinetQuery = useQuery({
    queryKey: ['medicine-cabinet', auth.user?.id],
    enabled: Boolean(token),
    queryFn: () => {
      if (!token) throw new ApiError('An authenticated session is required.', 401);
      return fetchMedicineCabinet(token);
    },
  });

  const error = cabinetQuery.error ? errorMessage(cabinetQuery.error) : null;
  const authError = !token || (cabinetQuery.error instanceof ApiError && cabinetQuery.error.status === 401);

  // Close modal on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && editing && !busy) {
        setEditing(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editing, busy]);

  useEffect(() => {
    if (editing) {
      wasEditingRef.current = true;
      modalRef.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')?.focus();
      return;
    }
    if (wasEditingRef.current) {
      wasEditingRef.current = false;
      const opener = modalOpenerRef.current;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
    }
  }, [editing]);

  function openEditor(item: MedicineCabinetItem | 'new') {
    modalOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditing(item);
    setMedicineQuery('');
    setMedicineChoices([]);
    setMedicineId('');
    setSelectedMedicineName(null);
    setActionError(null);
    setFields(
      item === 'new'
        ? { quantity: null, purchase_date: null, expiry_date: null, refill_date: null, usage_information: null }
        : {
            quantity: item.quantity,
            purchase_date: item.purchase_date,
            expiry_date: item.expiry_date,
            refill_date: item.refill_date,
            usage_information: item.usage_information,
          },
    );
  }

  async function findMedicines() {
    if (!token) return;
    setActionError(null);
    setSearching(true);
    setMedicineChoices([]);
    setMedicineId('');
    setSelectedMedicineName(null);
    try {
      const result = await searchMedicineCatalogue(medicineQuery, { source: 'legacy', limit: 20 }, token);
      setMedicineChoices(result.items);
      if (!result.items.length) {
        setActionError('No matching medicines found in the supported medicine reference.');
      }
    } catch {
      setActionError('Medicine search failed. Enter at least two characters and try again.');
    } finally {
      setSearching(false);
    }
  }

  function handleSelectMedicine(id: string) {
    setMedicineId(id);
    const chosen = medicineChoices.find((c) => c.id === id);
    setSelectedMedicineName(chosen ? chosen.canonical_name : null);
    setActionError(null);
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    if (!token || !editing || busy) return;
    if (editing === 'new' && !medicineId) {
      setActionError('Search and select a medicine first.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      if (editing === 'new') {
        await addMedicineCabinetEntry(medicineId, fields, token);
      } else {
        await updateMedicineCabinetEntry(editing.id, fields, token);
      }
      setEditing(null);
      await cabinetQuery.refetch();
    } catch (cause) {
      setActionError(
        cause instanceof ApiError && cause.status === 400
          ? 'Check the quantity and dates, then try again.'
          : cause instanceof ApiError && cause.status === 404
          ? 'The medicine or record is unavailable. Refresh and try again.'
          : 'Could not save the record. Refresh before retrying.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(item: MedicineCabinetItem) {
    if (!token || busy || !window.confirm('Remove this medicine record from your cabinet?')) return;
    setBusy(true);
    setActionError(null);
    try {
      await removeMedicineCabinetEntry(item.id, token);
      await cabinetQuery.refetch();
    } catch {
      setActionError('Could not remove the record. Refresh before retrying.');
    } finally {
      setBusy(false);
    }
  }

  if (cabinetQuery.isPending && token) {
    return (
      <div className="md-cabinet-container" aria-busy="true">
        <p className="sr-only" role="status">Loading your medicine cabinet...</p>
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="h-44 w-full rounded-2xl" />
      </div>
    );
  }

  if (authError) {
    return (
      <div className="md-cabinet-container">
        <Card className="text-center py-12 px-6">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[var(--cc-primary)]/10 text-[var(--cc-primary)]">
            <Icon name="profile" className="size-6" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-[var(--cc-text)]">Authentication required</h1>
          <p className="mt-2 text-sm text-[var(--cc-muted)] max-w-md mx-auto">
            {error ?? 'Sign in to view your medicine cabinet.'}
          </p>
          <Link className="cc-button cc-button--primary mt-6 inline-flex items-center gap-2" to="/sign-in">
            <Icon name="profile" className="size-4" />
            <span>Sign In</span>
          </Link>
        </Card>
      </div>
    );
  }

  const items = cabinetQuery.data?.items ?? [];
  const totalCount = items.length;
  let activeCount = 0;
  let expiringSoonCount = 0;
  let expiredCount = 0;

  for (const item of items) {
    const status = getExpiryStatus(item.expiry_date);
    if (!status || status.tone === 'neutral') {
      activeCount += 1;
    } else if (status.tone === 'warning') {
      expiringSoonCount += 1;
    } else if (status.tone === 'danger') {
      expiredCount += 1;
    }
  }

  return (
    <div className="md-cabinet-container">
      {/* Header with Title and Unified Actions */}
      <PageHeader
        eyebrow="Personal Health Workspace"
        title="My Cabinet"
        description="Organize your active medications, verified dosage instructions, and refill schedules."
        actions={
          <div className="md-cabinet-header-actions">
            <Button icon="plus" onClick={() => openEditor('new')}>
              Add medicine
            </Button>
            <Button
              variant="secondary"
              loading={cabinetQuery.isFetching}
              icon="arrow"
              onClick={() => void cabinetQuery.refetch()}
            >
              Refresh
            </Button>
            <Link
              to="/upload-prescription"
              className="cc-button cc-button--secondary text-xs sm:text-sm inline-flex items-center gap-1.5"
            >
              <Icon name="inbox" className="size-4" />
              <span>Upload Prescription</span>
            </Link>
          </div>
        }
      />

      {/* Metric Summary Cards */}
      <section aria-label="Cabinet summary overview" className="md-cabinet-summary-grid">
        <article className="md-cabinet-stat-card tone-total">
          <div className="md-cabinet-stat-head">
            <span className="md-cabinet-stat-icon-wrap">
              <Icon name="briefcase" className="size-5" />
            </span>
            <Badge tone="neutral">Cabinet</Badge>
          </div>
          <div>
            <div className="md-cabinet-stat-value">{totalCount}</div>
            <div className="md-cabinet-stat-label">Total Medicines</div>
            <div className="md-cabinet-stat-desc">Recorded in your cabinet</div>
          </div>
        </article>

        <article className="md-cabinet-stat-card tone-active">
          <div className="md-cabinet-stat-head">
            <span className="md-cabinet-stat-icon-wrap">
              <Icon name="check" className="size-5" />
            </span>
            <Badge tone="success">Verified</Badge>
          </div>
          <div>
            <div className="md-cabinet-stat-value">{activeCount}</div>
            <div className="md-cabinet-stat-label">Active &amp; Current</div>
            <div className="md-cabinet-stat-desc">Within safe expiration</div>
          </div>
        </article>

        <article className="md-cabinet-stat-card tone-expiring">
          <div className="md-cabinet-stat-head">
            <span className="md-cabinet-stat-icon-wrap">
              <Icon name="clock" className="size-5" />
            </span>
            <Badge tone="warning">30 Days</Badge>
          </div>
          <div>
            <div className="md-cabinet-stat-value">{expiringSoonCount}</div>
            <div className="md-cabinet-stat-label">Expiring Soon</div>
            <div className="md-cabinet-stat-desc">Review for refill</div>
          </div>
        </article>

        <article className="md-cabinet-stat-card tone-expired">
          <div className="md-cabinet-stat-head">
            <span className="md-cabinet-stat-icon-wrap">
              <Icon name="warning" className="size-5" />
            </span>
            <Badge tone="danger">Past expiry</Badge>
          </div>
          <div>
            <div className="md-cabinet-stat-value">{expiredCount}</div>
            <div className="md-cabinet-stat-label">Expired Items</div>
            <div className="md-cabinet-stat-desc">Safe disposal required</div>
          </div>
        </article>
      </section>

      {/* Backend Synchronization & Reference Notice */}
      <section role="note" aria-label="Cabinet sync status">
        <div className="md-cabinet-sync-notice">
          <span className="p-2 rounded-xl bg-[var(--cc-primary)]/10 text-[var(--cc-primary)] shrink-0">
            <Icon name="shield" className="size-5" />
          </span>
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-[var(--cc-text)]">
              Your medicine cabinet
            </h2>
            <p className="text-xs text-[var(--cc-muted)] leading-relaxed">
              Add entries from the supported medicine reference. Entries are not automatically added from prescriptions.
            </p>
          </div>
        </div>
      </section>

      {/* Top action error when not in modal */}
      {actionError && !editing && (
        <div role="alert" className="rounded-xl border border-[var(--cc-danger)]/40 bg-[var(--cc-danger-soft)]/20 p-4 text-xs font-medium text-[var(--cc-danger)] flex items-center gap-2">
          <Icon name="warning" className="size-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Service Error Banner */}
      {error ? (
        <Card className="border-[var(--cc-danger)]/40 bg-[var(--cc-danger-soft)]/20 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Icon name="warning" className="size-5 shrink-0 text-[var(--cc-danger)] mt-0.5" />
              <div>
                <h3 className="font-semibold text-sm text-[var(--cc-danger)]">Unable to load cabinet records</h3>
                <p role="alert" className="mt-1 text-xs text-[var(--cc-danger)]/90">{error}</p>
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={() => void cabinetQuery.refetch()}
              loading={cabinetQuery.isFetching}
              className="shrink-0 text-xs"
            >
              Try Again
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Cabinet Records Section */}
      {cabinetQuery.data?.items.length ? (
        <section aria-label="Medicine cabinet records" className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
            <p className="text-xs font-semibold text-[var(--cc-muted)] uppercase tracking-wider">
              Showing {cabinetQuery.data.pagination.returned} saved record{cabinetQuery.data.pagination.returned === 1 ? '' : 's'}
              {cabinetQuery.data.pagination.has_more ? ' (additional records available in backend)' : ''}
            </p>
            <Link to="/prescriptions" className="text-xs font-semibold text-[var(--cc-primary)] hover:underline inline-flex items-center gap-1">
              <span>View prescriptions</span>
              <Icon name="arrow" className="size-3" />
            </Link>
          </div>

          {/* Search & Status Filter Toolbar */}
          <div className="md-cabinet-toolbar">
            <div className="md-cabinet-search-input-wrap">
              <Icon name="search" className="size-4 md-cabinet-search-icon" />
              <input
                type="search"
                className="md-cabinet-search-input"
                placeholder="Search cabinet by ID, schedule, or instructions..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                aria-label="Filter cabinet records"
              />
            </div>
            <div className="md-cabinet-filter-tabs" role="tablist" aria-label="Filter medications by status">
              {(
                [
                  { id: 'all', label: 'All records', count: totalCount },
                  { id: 'active', label: 'Active only', count: activeCount },
                  { id: 'expiring', label: 'Expiring soon', count: expiringSoonCount },
                  { id: 'expired', label: 'Expired items', count: expiredCount },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`md-cabinet-filter-tab ${statusFilter === tab.id ? 'is-active' : ''}`}
                >
                  <span>{tab.label}</span>
                  <span className="tab-badge">{tab.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Render Filtered Records */}
          {(() => {
            const allItems = cabinetQuery.data.items;
            const filtered = allItems.filter((item: MedicineCabinetItem) => {
              if (searchFilter.trim()) {
                const q = searchFilter.toLowerCase();
                const matchText = `${item.medicine_id} ${item.usage_information ?? ''} ${item.quantity ?? ''}`.toLowerCase();
                if (!matchText.includes(q)) return false;
              }
              if (statusFilter !== 'all') {
                const s = getExpiryStatus(item.expiry_date);
                if (statusFilter === 'active' && s && s.tone !== 'neutral') return false;
                if (statusFilter === 'expiring' && s?.tone !== 'warning') return false;
                if (statusFilter === 'expired' && s?.tone !== 'danger') return false;
              }
              return true;
            });

            if (filtered.length === 0) {
              return (
                <div className="text-center py-10 rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-panel)] p-6">
                  <div className="size-10 rounded-xl bg-[var(--cc-panel-muted)] flex items-center justify-center mx-auto text-[var(--cc-muted)] mb-3">
                    <Icon name="search" className="size-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--cc-text)]">No matching medications found</h3>
                  <p className="mt-1 text-xs text-[var(--cc-muted)]">No cabinet records match your current search or filter criteria.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchFilter('');
                      setStatusFilter('all');
                    }}
                    className="mt-3 text-xs font-semibold text-[var(--cc-primary)] hover:underline inline-flex items-center gap-1"
                  >
                    <span>Reset search and filters</span>
                  </button>
                </div>
              );
            }

            return (
              <div className="md-cabinet-records-list">
                {filtered.map((item: MedicineCabinetItem) => {
                  const expiryStatus = getExpiryStatus(item.expiry_date);
                  return (
                    <article
                      key={item.id}
                      className={`md-cabinet-card ${
                        expiryStatus?.tone === 'danger'
                          ? 'is-expired'
                          : expiryStatus?.tone === 'warning'
                          ? 'is-expiring'
                          : ''
                      }`}
                      aria-labelledby={`cabinet-item-${item.id}-title`}
                    >
                      <div className="md-cabinet-card-header">
                        <div className="md-cabinet-card-title-group">
                          <span className="md-cabinet-card-icon">
                            <Icon name="briefcase" className="size-5" />
                          </span>
                          <div>
                            <h2 id={`cabinet-item-${item.id}-title`} className="md-cabinet-card-title">
                              Medicine record
                            </h2>
                            <div className="md-cabinet-card-badges mt-1">
                              <Badge>Backend record</Badge>
                              {expiryStatus ? (
                                <Badge tone={expiryStatus.tone}>{expiryStatus.label}</Badge>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="md-cabinet-card-actions">
                          <Button variant="secondary" disabled={busy} onClick={() => openEditor(item)}>
                            Edit
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            aria-label={`Remove medicine record ${item.id}`}
                            onClick={() => void removeEntry(item)}
                            className="text-xs"
                          >
                            Remove
                          </Button>
                          <Link
                            to="/prescriptions"
                            className="cc-button cc-button--secondary text-xs inline-flex items-center gap-1"
                          >
                            <span>Prescriptions</span>
                            <Icon name="arrow" className="size-3" />
                          </Link>
                        </div>
                      </div>

                      {item.usage_information ? (
                        <div className="md-cabinet-usage-box">
                          <span className="md-cabinet-usage-title">
                            <Icon name="clock" className="size-3.5 text-[var(--cc-primary)]" />
                            Dosage &amp; Schedule Instructions
                          </span>
                          <p className="md-cabinet-usage-text">{item.usage_information}</p>
                        </div>
                      ) : null}

                      <dl className="md-cabinet-meta-grid">
                        <div className="md-cabinet-meta-item">
                          <dt>Quantity</dt>
                          <dd>{metadata(item.quantity)}</dd>
                        </div>
                        <div className="md-cabinet-meta-item">
                          <dt>Purchase date</dt>
                          <dd>{formatDisplayDate(item.purchase_date)}</dd>
                        </div>
                        <div className="md-cabinet-meta-item">
                          <dt>Expiry date</dt>
                          <dd>{formatDisplayDate(item.expiry_date)}</dd>
                        </div>
                        <div className="md-cabinet-meta-item">
                          <dt>Refill date</dt>
                          <dd>{formatDisplayDate(item.refill_date)}</dd>
                        </div>
                      </dl>

                      <div className="md-cabinet-card-footer">
                        <div className="md-cabinet-card-ids">
                          <span>Medicine ID: {item.medicine_id}</span>
                          <span className="hidden sm:inline">·</span>
                          <span>Record ID: {item.id}</span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            );
          })()}
        </section>
      ) : !error ? (
        <EmptyState
          icon="briefcase"
          title="No cabinet records"
          description="You have no saved medicine records. Add one from the supported medicine reference."
          action={
            <div className="flex flex-wrap gap-3 justify-center mt-3">
              <Button icon="plus" onClick={() => openEditor('new')}>
                Add medicine
              </Button>
              <Link to="/upload-prescription" className="cc-button cc-button--secondary text-sm inline-flex items-center gap-1.5">
                <Icon name="inbox" className="size-4" />
                <span>Upload Prescription</span>
              </Link>
              <Link to="/medicine-library" className="cc-button cc-button--secondary text-sm inline-flex items-center gap-1.5">
                <Icon name="search" className="size-4" />
                <span>Explore Medicine Library</span>
              </Link>
            </div>
          }
        />
      ) : null}

      {/* Redesigned Add / Edit Medicine Modal Dialog */}
      {editing && (
        <div
          className="md-cabinet-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setEditing(null);
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cabinet-modal-title"
        >
          <div ref={modalRef} className="md-cabinet-modal-panel">
            <div className="md-cabinet-modal-header">
              <div>
                <h2 id="cabinet-modal-title">
                  {editing === 'new' ? 'Add medicine' : 'Edit medicine record'}
                </h2>
                <p>
                  {editing === 'new'
                    ? 'Search and register a new medicine entry with dosage schedules and expiration tracking.'
                    : 'Update medicine details, quantity, or expiration dates.'}
                </p>
              </div>
              <button
                type="button"
                className="md-cabinet-modal-close-btn"
                onClick={() => !busy && setEditing(null)}
                aria-label="Close modal"
                disabled={busy}
              >
                <Icon name="close" className="size-4" />
              </button>
            </div>

            <form onSubmit={(event) => void saveEntry(event)} className="flex flex-col flex-1 overflow-hidden">
              <div className="md-cabinet-modal-body">
                {/* Search Medicine Step for New Entries */}
                {editing === 'new' && (
                  <div className="md-cabinet-lookup-section">
                    <label htmlFor="search-supported-medicines" className="text-xs font-semibold text-[var(--cc-text)]">
                      Search supported medicines
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          id="search-supported-medicines"
                          className="cc-field text-sm w-full"
                          placeholder="Enter medicine name (e.g. Paracetamol)..."
                          value={medicineQuery}
                          onChange={(event) => {
                            setMedicineQuery(event.target.value);
                            setMedicineId('');
                            setSelectedMedicineName(null);
                            setMedicineChoices([]);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void findMedicines();
                            }
                          }}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        loading={searching}
                        onClick={() => void findMedicines()}
                        className="shrink-0 text-xs"
                      >
                        Find medicine
                      </Button>
                    </div>

                    {/* Search Choices */}
                    {medicineChoices.length > 0 && !medicineId && (
                      <div className="grid gap-1.5 mt-2">
                        <label htmlFor="select-medicine-choice" className="text-xs font-semibold text-[var(--cc-text)]">
                          Medicine
                        </label>
                        <select
                          id="select-medicine-choice"
                          className="cc-field text-sm w-full"
                          value={medicineId}
                          onChange={(event) => handleSelectMedicine(event.target.value)}
                        >
                          <option value="">Select a medicine from results ({medicineChoices.length} found)</option>
                          {medicineChoices.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.canonical_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Selected Medicine Highlight Card */}
                    {medicineId && (
                      <div className="md-cabinet-selected-medicine mt-1">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex items-center justify-center size-7 rounded-lg bg-[var(--cc-primary)] text-white shrink-0">
                            <Icon name="check" className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="font-bold text-sm text-[var(--cc-text)] truncate">
                              {selectedMedicineName || 'Selected Catalogue Medicine'}
                            </div>
                            <div className="text-[11px] font-mono text-[var(--cc-muted)] truncate">
                              ID: {medicineId}
                            </div>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setMedicineId('');
                            setSelectedMedicineName(null);
                          }}
                          className="shrink-0 text-xs py-1 px-2.5 h-auto"
                        >
                          Change
                        </Button>
                      </div>
                    )}

                    <p className="text-[11px] text-[var(--cc-muted)] leading-relaxed">
                      Only medicines from the supported legacy medicine reference can be added.
                    </p>
                  </div>
                )}

                {/* Inventory Fields in 2-Column Grid */}
                <div className="md-cabinet-form-grid">
                  <div className="md-cabinet-field-group">
                    <label htmlFor="cabinet-field-quantity">Quantity</label>
                    <input
                      id="cabinet-field-quantity"
                      className="cc-field"
                      type="text"
                      placeholder="e.g. 30"
                      maxLength={30}
                      value={fields.quantity ?? ''}
                      onChange={(event) =>
                        setFields((current) => ({ ...current, quantity: event.target.value || null }))
                      }
                    />
                  </div>

                  <div className="md-cabinet-field-group">
                    <label htmlFor="cabinet-field-purchase_date">Purchase date</label>
                    <input
                      id="cabinet-field-purchase_date"
                      className="cc-field"
                      type="date"
                      value={fields.purchase_date ?? ''}
                      onChange={(event) =>
                        setFields((current) => ({ ...current, purchase_date: event.target.value || null }))
                      }
                    />
                  </div>

                  <div className="md-cabinet-field-group">
                    <label htmlFor="cabinet-field-expiry_date">Expiry date</label>
                    <input
                      id="cabinet-field-expiry_date"
                      className="cc-field"
                      type="date"
                      value={fields.expiry_date ?? ''}
                      onChange={(event) =>
                        setFields((current) => ({ ...current, expiry_date: event.target.value || null }))
                      }
                    />
                  </div>

                  <div className="md-cabinet-field-group">
                    <label htmlFor="cabinet-field-refill_date">Refill date</label>
                    <input
                      id="cabinet-field-refill_date"
                      className="cc-field"
                      type="date"
                      value={fields.refill_date ?? ''}
                      onChange={(event) =>
                        setFields((current) => ({ ...current, refill_date: event.target.value || null }))
                      }
                    />
                  </div>
                </div>

                {/* Expiry Date Validations & Warnings */}
                {fields.purchase_date && fields.expiry_date && fields.expiry_date < fields.purchase_date ? (
                  <div role="alert" className="rounded-xl border border-[var(--cc-danger)]/40 bg-[var(--cc-danger-soft)]/20 p-3 text-xs text-[var(--cc-danger)] font-medium flex items-center gap-2">
                    <Icon name="warning" className="size-4 shrink-0" />
                    <span>Warning: Expiry date is earlier than purchase date.</span>
                  </div>
                ) : fields.expiry_date && new Date(`${fields.expiry_date}T00:00:00Z`).getTime() < 1731542400000 ? (
                  <div className="rounded-xl border border-[var(--cc-warning)]/40 bg-[var(--cc-warning-soft)]/20 p-3 text-xs text-[var(--cc-warning)] font-medium flex items-center gap-2">
                    <Icon name="warning" className="size-4 shrink-0" />
                    <span>Notice: This expiration date is already in the past.</span>
                  </div>
                ) : null}

                {/* Usage Information (Full width) */}
                <div className="md-cabinet-field-group">
                  <label htmlFor="cabinet-field-usage">Usage information</label>
                  <input
                    id="cabinet-field-usage"
                    className="cc-field"
                    type="text"
                    placeholder="e.g. Take 1 tablet daily with breakfast"
                    maxLength={2000}
                    value={fields.usage_information ?? ''}
                    onChange={(event) =>
                      setFields((current) => ({ ...current, usage_information: event.target.value || null }))
                    }
                  />
                </div>

                {/* Error Banner inside Modal */}
                {actionError && (
                  <div role="alert" className="rounded-xl border border-[var(--cc-danger)]/40 bg-[var(--cc-danger-soft)]/20 p-3 text-xs text-[var(--cc-danger)] font-medium flex items-center gap-2">
                    <Icon name="warning" className="size-4 shrink-0" />
                    <span>{actionError}</span>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="md-cabinet-modal-footer">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy || (editing === 'new' && !medicineId)}
                  loading={busy}
                >
                  {busy ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
