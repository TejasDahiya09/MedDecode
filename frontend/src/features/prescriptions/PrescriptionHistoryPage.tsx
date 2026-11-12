import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, PageHeader, Skeleton } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ApiError } from '../../services/api-client';
import { useAuth } from '../auth/AuthProvider';
import {
  fetchPrescriptionHistory,
  type PrescriptionHistoryItem,
  type PrescriptionHistoryPage as HistoryPageData,
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

export function PrescriptionHistoryPage() {
  const auth = useAuth();
  const [data, setData] = useState<HistoryPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);

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

      try {
        const page = await fetchPrescriptionHistory(token);
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
  }, [auth]);

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
      const page = await fetchPrescriptionHistory(token);
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
  }, [auth]);

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
        <section aria-label="Prescription records" className="grid gap-3">
          {items.map((item: PrescriptionHistoryItem) => (
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
                    <span className="font-mono text-sm font-semibold text-[var(--cc-text)]">
                      {item.id}
                    </span>
                    <PrescriptionStatusBadge status={item.status} />
                  </div>
                  <p className="mt-1 text-xs text-[var(--cc-muted)] flex flex-wrap items-center gap-x-2">
                    <span>{fileTypeLabel(item.file_type)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatBytes(item.file_size_bytes)}</span>
                    <span aria-hidden="true">·</span>
                    <span>Uploaded {formatDate(item.created_at)}</span>
                    {item.prescription_date ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Date: {item.prescription_date}</span>
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
    </div>
  );
}
