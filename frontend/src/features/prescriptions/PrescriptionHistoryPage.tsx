import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState, PageHeader, Skeleton } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ApiError } from '../../services/api-client';
import { useAuth } from '../auth/AuthProvider';
import {
  fetchPrescriptionHistory,
  type PrescriptionHistoryItem,
  type PrescriptionHistoryPage as HistoryPageData,
  type PrescriptionStatus,
} from './prescription-api';
import { PrescriptionStatusBadge } from './PrescriptionStatusBadge';

function formatBytes(bytesStr: string | null): string {
  if (!bytesStr) return '—';
  const bytes = Number(bytesStr);
  if (!Number.isFinite(bytes)) return bytesStr;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoStr: string | null): string {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : isoStr;
  } catch {
    return isoStr;
  }
}

function fileTypeLabel(mime: string): string {
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'image/jpeg') return 'JPEG';
  if (mime === 'image/png') return 'PNG';
  return mime;
}

type StatusFilterId = 'all' | 'completed' | 'processing' | 'uploaded' | 'failed';

interface StatusFilterOption {
  readonly id: StatusFilterId;
  readonly label: string;
  readonly matches: (status: PrescriptionStatus) => boolean;
}

const STATUS_OPTIONS: readonly StatusFilterOption[] = [
  { id: 'all', label: 'All', matches: () => true },
  { id: 'completed', label: 'Completed', matches: (s) => s === 'completed' || s === 'completed_with_warnings' },
  { id: 'processing', label: 'Processing', matches: (s) => s === 'queued' || s === 'processing' },
  { id: 'uploaded', label: 'Uploaded', matches: (s) => s === 'uploaded' },
  { id: 'failed', label: 'Failed', matches: (s) => s === 'failed' || s === 'cancelled' },
];

export function PrescriptionHistoryPage() {
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawOffset = Number(searchParams.get('offset') ?? '0');
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const limit = 20;

  const [data, setData] = useState<HistoryPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilterId>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      const token = auth.getAccessToken();
      if (!token) {
        if (active) {
          setIsAuthError(true);
          setError('An authenticated session is required.');
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const page = await fetchPrescriptionHistory(token, { limit, offset });
        if (active) {
          setData(page);
          setLoading(false);
        }
      } catch (cause) {
        if (active) {
          setLoading(false);
          if (cause instanceof ApiError) {
            if (cause.status === 401) {
              setIsAuthError(true);
              setError('Your session has expired. Sign in again to view your prescriptions.');
            } else if (cause.kind === 'network') {
              setError('Could not connect to the prescription service. Check your connection.');
            } else {
              setError('Unable to load prescription history. Please try again.');
            }
          } else {
            setError('An unexpected error occurred while loading prescriptions.');
          }
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [auth, offset]);

  const handleRefresh = useCallback(async () => {
    const token = auth.getAccessToken();
    if (!token) {
      setIsAuthError(true);
      setError('An authenticated session is required.');
      return;
    }

    setRefreshing(true);
    setError(null);
    try {
      const page = await fetchPrescriptionHistory(token, { limit, offset });
      setData(page);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setIsAuthError(true);
        setError('Your session has expired. Sign in again.');
      } else {
        setError('Unable to refresh prescriptions.');
      }
    } finally {
      setRefreshing(false);
    }
  }, [auth, offset]);

  if (loading) {
    return (
      <div className="md-page p-4 sm:p-6 max-w-5xl mx-auto space-y-4" aria-busy="true">
        <p className="sr-only" role="status">Loading prescription history...</p>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-10 w-64" />
        <div className="pt-4 grid gap-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (isAuthError) {
    return (
      <div className="md-page p-4 sm:p-6 max-w-5xl mx-auto">
        <Card className="text-center py-10">
          <span className="cc-icon-box mx-auto text-[var(--cc-danger)]">
            <Icon name="shield" className="size-8" />
          </span>
          <h2 className="mt-4 text-xl font-bold text-[var(--cc-text)]">Authentication Required</h2>
          <p className="mt-2 text-sm text-[var(--cc-muted)] max-w-md mx-auto">{error}</p>
          <div className="mt-6 flex justify-center">
            <Link to="/sign-in" className="cc-button cc-button--primary">
              Sign In
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="md-page p-4 sm:p-6 max-w-5xl mx-auto">
        <Card className="text-center py-8">
          <span className="cc-icon-box mx-auto text-[var(--cc-danger)]">
            <Icon name="warning" className="size-8" />
          </span>
          <h2 className="mt-4 text-xl font-bold text-[var(--cc-text)]">Unable to Load Prescriptions</h2>
          <p className="mt-2 text-sm text-[var(--cc-muted)] max-w-md mx-auto">{error}</p>
          <div className="mt-6 flex justify-center">
            <Button onClick={() => void handleRefresh()}>Try Again</Button>
          </div>
        </Card>
      </div>
    );
  }

  const items = data?.items ?? [];

  const filteredItems = items.filter((item) => {
    const selectedOption = STATUS_OPTIONS.find((opt) => opt.id === statusFilter);
    if (selectedOption && !selectedOption.matches(item.status)) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchId = item.id.toLowerCase().includes(q);
      const matchType =
        fileTypeLabel(item.file_type).toLowerCase().includes(q) ||
        item.file_type.toLowerCase().includes(q);
      const matchDate = (item.prescription_date ?? '').toLowerCase().includes(q);
      const matchCreated = formatDate(item.created_at).toLowerCase().includes(q);
      return matchId || matchType || matchDate || matchCreated;
    }
    return true;
  });

  return (
    <div className="md-page p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        eyebrow="Prescription Management"
        title="Prescriptions"
        description="View and track your uploaded prescriptions, OCR status, and intelligence analysis results."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              loading={refreshing}
              icon="arrow"
              onClick={() => void handleRefresh()}
              aria-label="Refresh prescriptions list"
            >
              Refresh
            </Button>
            <Link to="/upload-prescription" className="cc-button cc-button--primary">
              <Icon name="plus" className="size-4" />
              Upload New
            </Link>
          </div>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="No Prescriptions Uploaded"
          description="Upload your prescription documents to automatically extract medicines, verify strengths, and track your history."
          action={
            <Link to="/upload-prescription" className="cc-button cc-button--primary">
              <Icon name="plus" className="size-4" />
              Upload Prescription
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {/* Controls Bar: Search & Status Filter */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1 max-w-sm">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--cc-muted)]">
                <Icon name="search" className="size-4" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by ID, file type, or date..."
                className="w-full pl-9 pr-8 py-2 rounded-xl border border-[var(--cc-border)] bg-[var(--cc-panel)] text-sm text-[var(--cc-text)] placeholder:text-[var(--cc-muted)] focus:outline-none focus:border-[var(--cc-primary)] focus:ring-1 focus:ring-[var(--cc-primary)]"
                aria-label="Filter prescriptions"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-[var(--cc-muted)] hover:text-[var(--cc-text)]"
                  aria-label="Clear search"
                >
                  <Icon name="close" className="size-3.5" />
                </button>
              ) : null}
            </div>

            {/* Status Filter Chips */}
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
              {STATUS_OPTIONS.map((opt) => {
                const isSelected = statusFilter === opt.id;
                const count =
                  opt.id === 'all'
                    ? items.length
                    : items.filter((it) => opt.matches(it.status)).length;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setStatusFilter(opt.id)}
                    aria-pressed={isSelected}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                      isSelected
                        ? 'bg-[var(--cc-primary)] text-white'
                        : 'bg-[var(--cc-panel)] text-[var(--cc-text-soft)] border border-[var(--cc-border)] hover:text-[var(--cc-text)] hover:border-[var(--cc-border-strong)]'
                    }`}
                  >
                    <span>{opt.label}</span>
                    <span
                      className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-[var(--cc-bg)] text-[var(--cc-muted)]'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <Card className="text-center py-8 border-dashed border-[var(--cc-border)]">
              <span className="cc-icon-box mx-auto text-[var(--cc-muted)]">
                <Icon name="search" className="size-6" />
              </span>
              <h3 className="mt-3 text-sm font-semibold text-[var(--cc-text)]">
                No matching prescriptions found
              </h3>
              <p className="mt-1 text-xs text-[var(--cc-muted)] max-w-xs mx-auto">
                No documents match the current filter or search query.
              </p>
              <div className="mt-4">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStatusFilter('all');
                    setSearchQuery('');
                  }}
                >
                  Clear Filters
                </Button>
              </div>
            </Card>
          ) : (
            <section aria-label="Prescription records" className="grid gap-3">
              {filteredItems.map((item: PrescriptionHistoryItem) => (
                <Link
                  key={item.id}
                  to={`/prescriptions/${item.id}`}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-[var(--cc-border)] bg-[var(--cc-panel)] hover:border-[var(--cc-border-strong)] transition-colors text-inherit no-underline"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    <span className="cc-icon-box text-[var(--cc-primary)] shrink-0">
                      <Icon name="inbox" className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm sm:text-base font-semibold text-[var(--cc-text)]">
                          {item.prescription_date
                            ? `Prescription Document (${formatDate(item.prescription_date)})`
                            : `${fileTypeLabel(item.file_type)} Prescription`}
                        </h3>
                        <PrescriptionStatusBadge status={item.status} />
                      </div>
                      <p className="mt-1 text-xs text-[var(--cc-muted)] flex flex-wrap items-center gap-x-2">
                        <span
                          className="font-mono text-[11px] bg-[var(--cc-bg)] px-1.5 py-0.5 rounded border border-[var(--cc-border)]/60"
                          title={`Document Reference: ${item.id}`}
                        >
                          <span className="text-[var(--cc-muted)] font-sans mr-1 select-none">Ref:</span>
                          <span>{item.id}</span>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{fileTypeLabel(item.file_type)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatBytes(item.file_size_bytes)}</span>
                        <span aria-hidden="true">·</span>
                        <span>Uploaded {formatDate(item.created_at)}</span>
                        {item.prescription_date ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Prescribed {formatDate(item.prescription_date)}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--cc-primary)] self-end sm:self-center shrink-0">
                    <span>View analysis</span>
                    <Icon name="arrow" className="size-4" />
                  </div>
                </Link>
              ))}
            </section>
          )}

          {/* Pagination controls */}
          {(offset > 0 || data?.pagination.has_more) ? (
            <div className="flex items-center justify-between pt-4 border-t border-[var(--cc-border)] text-sm">
              <Button
                variant="secondary"
                disabled={offset === 0}
                onClick={() => {
                  const nextOffset = Math.max(0, offset - limit);
                  setSearchParams({ offset: String(nextOffset) });
                }}
              >
                Previous page
              </Button>
              <span className="text-xs text-[var(--cc-muted)]">
                Showing {offset + 1}–{offset + items.length}
              </span>
              <Button
                variant="secondary"
                disabled={!data?.pagination.has_more}
                onClick={() => {
                  const nextOffset = data?.pagination.next_offset ?? offset + limit;
                  setSearchParams({ offset: String(nextOffset) });
                }}
              >
                Next page
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
