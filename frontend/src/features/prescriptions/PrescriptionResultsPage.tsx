import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, PageHeader, SectionHeader, Skeleton } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ApiError } from '../../services/api-client';
import { useAuth } from '../auth/AuthProvider';
import {
  fetchPrescriptionDetail,
  fetchProcessingStatus,
  fetchPrescriptionAnalysisResult,
  submitPrescriptionProcessing,
  type AnalysisResultOutcome,
  type ContractV1AnalysisResult,
  type PrescriptionHistoryItem,
  type ProcessingJobInfo,
} from './prescription-api';
import { PrescriptionStatusBadge } from './PrescriptionStatusBadge';
import { PrescriptionResultsView } from './PrescriptionResultsView';

function formatBytes(bytesStr: string | null): string {
  if (!bytesStr) return 'Unknown size';
  const bytes = Number(bytesStr);
  if (!Number.isFinite(bytes)) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoStr: string | null): string {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : isoStr;
  } catch {
    return isoStr;
  }
}

interface PrescriptionResultsPageProps {
  readonly initialPrescriptionId?: string;
  readonly initialResult?: ContractV1AnalysisResult;
}

export function PrescriptionResultsPage({ initialPrescriptionId, initialResult }: PrescriptionResultsPageProps = {}) {
  const { id: routeId } = useParams<{ id: string }>();
  const location = useLocation();
  const auth = useAuth();

  const prescriptionId = initialPrescriptionId ?? routeId ?? '';
  const passedResult = initialResult ?? (location.state as { result?: ContractV1AnalysisResult })?.result;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [prescription, setPrescription] = useState<PrescriptionHistoryItem | null>(null);
  const [processing, setProcessing] = useState<ProcessingJobInfo | null>(null);
  const [analysisOutcome, setAnalysisOutcome] = useState<AnalysisResultOutcome | null>(
    passedResult ? { kind: 'available', result: passedResult } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);
  const [isNotFound, setIsNotFound] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!prescriptionId) {
        if (active) {
          setError('Prescription ID is required.');
          setLoading(false);
        }
        return;
      }

      const token = auth.getAccessToken();
      if (!token) {
        if (active) {
          setIsAuthError(true);
          setError('An authenticated session is required to inspect prescriptions.');
          setLoading(false);
        }
        return;
      }

      try {
        const [item, statusData] = await Promise.all([
          fetchPrescriptionDetail(prescriptionId, token),
          fetchProcessingStatus(prescriptionId, token).catch(() => null),
        ]);

        if (active) {
          setPrescription(item);
          setProcessing(statusData?.processing ?? null);
          setLoading(false);
        }

        if (!passedResult && (item.status === 'completed' || item.status === 'completed_with_warnings')) {
          const outcome = await fetchPrescriptionAnalysisResult(prescriptionId, token);
          if (active) setAnalysisOutcome(outcome);
        }
      } catch (cause) {
        if (active) {
          setLoading(false);
          if (cause instanceof ApiError) {
            if (cause.status === 401) {
              setIsAuthError(true);
              setError('Your session has expired. Sign in again to view this prescription.');
            } else if (cause.status === 404) {
              setIsNotFound(true);
              setError('The requested prescription does not exist or you do not have permission to view it.');
            } else if (cause.kind === 'network') {
              setError('Could not reach the server. Check your connection and try again.');
            } else {
              setError(`Server error (${cause.status ?? 'unknown'}). Please try again later.`);
            }
          } else {
            setError('An unexpected error occurred while loading prescription data.');
          }
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [prescriptionId, auth, passedResult]);

  const handleRefresh = useCallback(async () => {
    if (!prescriptionId) return;
    const token = auth.getAccessToken();
    if (!token) {
      setIsAuthError(true);
      setError('An authenticated session is required.');
      return;
    }

    setRefreshing(true);
    setError(null);
    try {
      const [item, statusData] = await Promise.all([
        fetchPrescriptionDetail(prescriptionId, token),
        fetchProcessingStatus(prescriptionId, token).catch(() => null),
      ]);
      setPrescription(item);
      setProcessing(statusData?.processing ?? null);

      if (!passedResult && (item.status === 'completed' || item.status === 'completed_with_warnings')) {
        const outcome = await fetchPrescriptionAnalysisResult(prescriptionId, token);
        setAnalysisOutcome(outcome);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setIsAuthError(true);
        setError('Your session has expired. Sign in again.');
      } else {
        setError('Unable to refresh prescription status.');
      }
    } finally {
      setRefreshing(false);
    }
  }, [prescriptionId, auth, passedResult]);

  async function handleStartProcessing() {
    if (!prescriptionId || submitting) return;
    const token = auth.getAccessToken();
    if (!token) {
      setIsAuthError(true);
      setError('Your session has expired. Sign in again before requesting processing.');
      return;
    }

    setSubmitting(true);
    setActionNotice(null);
    setError(null);
    try {
      const submission = await submitPrescriptionProcessing(prescriptionId, token);
      setActionNotice(
        submission.submission.created
          ? `Analysis job created (Job ID: ${submission.job.id}). Now in queue.`
          : `Active analysis job resumed (Job ID: ${submission.job.id}).`,
      );
      // Reload current status
      await handleRefresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setIsAuthError(true);
        setError('Your session expired. Sign in again to request processing.');
      } else {
        setError('Could not submit prescription for processing. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // 1. Loading State
  if (loading) {
    return (
      <div className="md-page p-4 sm:p-6 max-w-5xl mx-auto" aria-busy="true">
        <p className="sr-only" role="status">Loading prescription analysis results...</p>
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="pt-4 grid gap-5">
            <Skeleton className="h-36 w-full rounded-2xl" />
            <Skeleton className="h-56 w-full rounded-2xl" />
            <Skeleton className="h-48 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  // 2. Authentication Error State
  if (isAuthError) {
    return (
      <div className="md-page p-4 sm:p-6 max-w-5xl mx-auto">
        <Card className="text-center py-10">
          <span className="cc-icon-box mx-auto text-[var(--cc-danger)]">
            <Icon name="shield" className="size-8" />
          </span>
          <h2 className="mt-4 text-xl font-bold text-[var(--cc-text)]">Authentication Required</h2>
          <p className="mt-2 text-sm text-[var(--cc-muted)] max-w-md mx-auto">
            {error ?? 'Your session has expired or is invalid. Sign in again to inspect prescription details.'}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link to="/sign-in" className="cc-button cc-button--primary">
              Sign In
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // 3. Not Found State
  if (isNotFound) {
    return (
      <div className="md-page p-4 sm:p-6 max-w-5xl mx-auto">
        <EmptyState
          icon="inbox"
          title="Prescription Not Found"
          description="The requested prescription ID does not exist or you do not have permission to view it."
          action={
            <div className="flex gap-3 justify-center">
              <Link to="/prescriptions" className="cc-button cc-button--primary">
                View All Prescriptions
              </Link>
              <Link to="/upload-prescription" className="cc-button cc-button--secondary">
                Upload New
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  // 4. General Error State (Network, 500, etc.)
  if (error && !prescription) {
    return (
      <div className="md-page p-4 sm:p-6 max-w-5xl mx-auto">
        <Card className="text-center py-8">
          <span className="cc-icon-box mx-auto text-[var(--cc-danger)]">
            <Icon name="warning" className="size-8" />
          </span>
          <h2 className="mt-4 text-xl font-bold text-[var(--cc-text)]">Unable to Load Prescription</h2>
          <p className="mt-2 text-sm text-[var(--cc-muted)] max-w-md mx-auto">{error}</p>
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={() => void handleRefresh()}>Try Again</Button>
            <Link to="/prescriptions" className="cc-button cc-button--secondary">
              Back to Prescriptions
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const effectiveStatus = prescription?.status ?? 'uploaded';
  const isCompletedStatus = effectiveStatus === 'completed' || effectiveStatus === 'completed_with_warnings';
  const effectiveResult = isCompletedStatus
    ? (analysisOutcome?.kind === 'available' ? analysisOutcome.result : (passedResult?.status === effectiveStatus ? passedResult : undefined))
    : undefined;

  return (
    <div className="md-page p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {/* Top Navigation & Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-[var(--cc-muted)]">
        <Link to="/prescriptions" className="hover:text-[var(--cc-text)] flex items-center gap-1 transition-colors">
          <Icon name="arrow" className="size-3.5 rotate-180" />
          <span>All Prescriptions</span>
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-[var(--cc-text)] font-mono text-xs">{prescriptionId}</span>
      </nav>

      {/* Page Header */}
      <PageHeader
        eyebrow="Prescription Analysis"
        title="Prescription Details &amp; Results"
        description={`Document format: ${prescription?.file_type ?? 'Document'} · Size: ${formatBytes(
          prescription?.file_size_bytes ?? null,
        )} · Registered: ${formatDate(prescription?.created_at ?? null)}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              loading={refreshing}
              icon="arrow"
              onClick={() => void handleRefresh()}
              aria-label="Refresh prescription status"
            >
              Refresh
            </Button>
          </div>
        }
      />

      {/* Notifications / Feedback */}
      {actionNotice ? (
        <div role="status" className="rounded-xl border border-[var(--cc-success)]/40 bg-[var(--cc-success-soft)]/20 p-4 text-sm text-[var(--cc-text)] flex items-center gap-2">
          <Icon name="check" className="size-4 text-[var(--cc-success)] shrink-0" />
          <span>{actionNotice}</span>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-xl border border-[var(--cc-danger)]/40 bg-[var(--cc-danger-soft)]/20 p-4 text-sm text-[var(--cc-danger)] flex items-center gap-2">
          <Icon name="warning" className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Processing Status Banner & Control Card */}
      <section aria-labelledby="status-section-heading">
        <Card className="border-[var(--cc-border)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="text-xs font-semibold tracking-wider uppercase text-[var(--cc-muted)]">
                Pipeline Lifecycle
              </span>
              <div className="mt-1 flex items-center gap-3">
                <h2 id="status-section-heading" className="text-lg font-bold text-[var(--cc-text)]">
                  Status:
                </h2>
                <PrescriptionStatusBadge status={effectiveStatus} />
              </div>
            </div>

            {/* Action buttons based on status */}
            <div className="flex flex-wrap items-center gap-2">
              {effectiveStatus === 'uploaded' ? (
                <Button
                  loading={submitting}
                  icon="sparkles"
                  onClick={() => void handleStartProcessing()}
                >
                  Start OCR &amp; Analysis
                </Button>
              ) : effectiveStatus === 'failed' ? (
                <Button
                  variant="danger"
                  loading={submitting}
                  icon="arrow"
                  onClick={() => void handleStartProcessing()}
                >
                  Retry Analysis
                </Button>
              ) : null}
            </div>
          </div>

          {/* Status Explanation Narrative */}
          <div className="mt-4 pt-4 border-t border-[var(--cc-border)]/50 text-sm">
            {effectiveStatus === 'uploaded' ? (
              <p className="text-[var(--cc-text-soft)]">
                The document has been securely stored in the private repository. OCR and medicine intelligence
                processing have not been run. Click <strong>Start OCR &amp; Analysis</strong> to submit this document
                to the analysis engine.
              </p>
            ) : effectiveStatus === 'queued' ? (
              <div className="flex items-start gap-2.5 text-[var(--cc-text-soft)]">
                <span className="size-2 rounded-full bg-[var(--cc-info)] mt-1.5 animate-pulse" />
                <p>
                  This prescription is in the analysis queue. A background intelligence worker will pick it up
                  momentarily. You can refresh this page to inspect progress.
                  {processing?.job_id ? (
                    <span className="block text-xs text-[var(--cc-muted)] mt-1 font-mono">
                      Active Job: {processing.job_id}
                    </span>
                  ) : null}
                </p>
              </div>
            ) : effectiveStatus === 'processing' ? (
              <div className="flex items-start gap-2.5 text-[var(--cc-text-soft)]">
                <span className="cc-button-spinner size-4 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-[var(--cc-text)]">Optical Character Recognition in Progress</p>
                  <p className="mt-0.5 text-xs text-[var(--cc-muted)]">
                    The intelligence pipeline is extracting text lines, recognizing medicine names, and cross-referencing
                    the verified medicine catalog.
                  </p>
                </div>
              </div>
            ) : effectiveStatus === 'completed' ? (
              <p className="text-[var(--cc-success)] font-medium flex items-center gap-1.5">
                <Icon name="check" className="size-4" />
                Prescription analysis completed successfully. Results are shown below.
              </p>
            ) : effectiveStatus === 'completed_with_warnings' ? (
              <p className="text-[var(--cc-warning)] font-medium flex items-center gap-1.5">
                <Icon name="warning" className="size-4" />
                Prescription analysis completed with warnings. Discrepancies and uncertain items require clinical review.
              </p>
            ) : effectiveStatus === 'failed' ? (
              <p className="text-[var(--cc-danger)] font-medium flex items-center gap-1.5">
                <Icon name="warning" className="size-4" />
                Prescription analysis processing failed. You may retry submission or re-upload a clearer image.
              </p>
            ) : null}
          </div>

          {/* Job Timeline Timestamps */}
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 pt-3 border-t border-[var(--cc-border)]/50">
            <div>
              <dt className="text-[var(--cc-muted)]">Uploaded</dt>
              <dd className="mt-0.5 font-medium text-[var(--cc-text)]">
                {formatDate(prescription?.created_at ?? null)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--cc-muted)]">Started</dt>
              <dd className="mt-0.5 font-medium text-[var(--cc-text)]">
                {formatDate(processing?.started_at ?? null)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--cc-muted)]">Completed</dt>
              <dd className="mt-0.5 font-medium text-[var(--cc-text)]">
                {formatDate(processing?.completed_at ?? prescription?.processed_at ?? null)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--cc-muted)]">Prescription Date</dt>
              <dd className="mt-0.5 font-medium text-[var(--cc-text)]">
                {prescription?.prescription_date ?? 'Not dated'}
              </dd>
            </div>
          </dl>
        </Card>
      </section>

      {/* Main Analysis Results Area */}
      {effectiveResult ? (
        <PrescriptionResultsView result={effectiveResult} />
      ) : effectiveStatus === 'completed' || effectiveStatus === 'completed_with_warnings' ? (
        /* Isolated Unavailable State when read endpoint is not yet mounted */
        <Card className="border-[var(--cc-border)]">
          <SectionHeader
            title="Intelligence Results Service"
            description="Automated prescription intelligence read adapter"
          />
          <div className="mt-4 flex items-start gap-3">
            <span className="rounded-xl bg-[var(--cc-info-soft)] p-2 text-[var(--cc-info)]">
              <Icon name="copy" className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-[var(--cc-text)]">
                  Intelligence Results Read Endpoint Not Yet Available
                </h3>
                <Badge tone="info">Adapter isolated</Badge>
              </div>
              <p className="mt-1 text-sm text-[var(--cc-text-soft)]">
                The prescription status (<strong>{effectiveStatus}</strong>) and background job pipeline are
                verified and connected. However, the full analysis results read API (<code>/api/v1/prescriptions/:id/results</code>)
                is not yet exposed by the backend in this environment.
              </p>
              <p className="mt-2 text-xs text-[var(--cc-muted)]">
                MedDecode keeps this data adapter isolated and displays this verified status rather than
                fabricating synthetic OCR results or medicine recommendations.
              </p>
            </div>
          </div>
        </Card>
      ) : effectiveStatus === 'queued' || effectiveStatus === 'processing' ? (
        <Card className="text-center py-10 border-dashed border-[var(--cc-border)]">
          <span className="cc-button-spinner size-8 mx-auto" aria-hidden="true" />
          <h3 className="mt-4 text-base font-semibold text-[var(--cc-text)]">Processing Document</h3>
          <p className="mt-1 text-sm text-[var(--cc-muted)] max-w-sm mx-auto">
            Results will appear here once the background OCR and catalog matching complete.
          </p>
        </Card>
      ) : effectiveStatus === 'uploaded' ? (
        <Card className="text-center py-10 border-dashed border-[var(--cc-border)]">
          <span className="cc-icon-box mx-auto text-[var(--cc-muted)]">
            <Icon name="sparkles" className="size-6" />
          </span>
          <h3 className="mt-4 text-base font-semibold text-[var(--cc-text)]">Awaiting Analysis</h3>
          <p className="mt-1 text-sm text-[var(--cc-muted)] max-w-sm mx-auto">
            Click &ldquo;Start OCR &amp; Analysis&rdquo; above to extract medicines, dosages, and warnings.
          </p>
        </Card>
      ) : effectiveStatus === 'failed' ? (
        <Card className="text-center py-10 border-dashed border-[var(--cc-border)]">
          <span className="cc-icon-box mx-auto text-[var(--cc-danger)]">
            <Icon name="warning" className="size-6" />
          </span>
          <h3 className="mt-4 text-base font-semibold text-[var(--cc-text)]">Analysis Failed</h3>
          <p className="mt-1 text-sm text-[var(--cc-muted)] max-w-sm mx-auto">
            No medicine analysis results are available. You can retry processing or upload a clearer document.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
