import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Button, Card, EmptyState, SectionHeader, Skeleton } from '../../components/ui';
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
  type ContractV1MedicineItem,
  type PrescriptionHistoryItem,
  type ProcessingJobInfo,
} from './prescription-api';
import { PrescriptionStatusBadge } from './PrescriptionStatusBadge';
import { PrescriptionResultsView } from './PrescriptionResultsView';
import { PrescriptionProcessingStepper } from './PrescriptionProcessingStepper';
import { SaveToCabinetModal } from './SaveToCabinetModal';
import { isPrescriptionAutoSubmitEnabled, type PrescriptionUploadProcessing } from './prescription-upload';
import { ReviewAndEditButton } from '../prescription-review/ReviewActionControl';
import { HttpPrescriptionReviewAdapter, isPrescriptionReviewFeatureEnabled } from '../prescription-review/prescription-review-api';
import type { PrescriptionReviewContractV1 } from '../prescription-review/types';
import './prescription-results.css';

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
  readonly pollIntervalMs?: number;
}

export function PrescriptionResultsPage({ initialPrescriptionId, initialResult, pollIntervalMs = 2500 }: PrescriptionResultsPageProps = {}) {
  const { id: routeId } = useParams<{ id: string }>();
  const location = useLocation();
  const auth = useAuth();

  const prescriptionId = initialPrescriptionId ?? routeId ?? '';
  const routeState = location.state as {
    result?: ContractV1AnalysisResult;
    uploadProcessing?: PrescriptionUploadProcessing;
  } | null;
  const candidateResult = initialResult ?? routeState?.result;
  const passedResult = candidateResult?.prescription_id === prescriptionId ? candidateResult : undefined;
  const uploadProcessing = routeState?.uploadProcessing;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reconciliationPending, setReconciliationPending] = useState(
    uploadProcessing?.requested === true || uploadProcessing?.requested === null,
  );
  const [prescription, setPrescription] = useState<PrescriptionHistoryItem | null>(null);
  const [processing, setProcessing] = useState<ProcessingJobInfo | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [analysisOutcome, setAnalysisOutcome] = useState<AnalysisResultOutcome | null>(
    passedResult ? { kind: 'available', result: passedResult } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);
  const [isNotFound, setIsNotFound] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [savingMedicine, setSavingMedicine] = useState<ContractV1MedicineItem | null>(null);
  const [review, setReview] = useState<PrescriptionReviewContractV1 | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const v3Enabled = isPrescriptionReviewFeatureEnabled();
  const hasCurrentResult = analysisOutcome?.kind === 'available'
    && (review?.status !== 'confirmed' || !processing || analysisOutcome.result.job_id === processing.job_id);
  useEffect(() => {
    if (!v3Enabled || !prescriptionId) return;
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    const adapter = new HttpPrescriptionReviewAdapter(() => auth.getAccessToken());
    const loadReview = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const current = await adapter.fetchReview(prescriptionId, controller.signal);
        if (active) { setReview(current); setReviewError(null); }
      } catch (cause) {
        if (active && !(cause instanceof Error && cause.name === 'AbortError')) {
          if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 404) setReview(null);
          else setReviewError('Review status could not be verified. Refresh before continuing.');
        }
      } finally { inFlight = false; }
    };
    void loadReview();
    const terminal = hasCurrentResult || processing?.status === 'failed' || processing?.status === 'cancelled';
    const timer = terminal ? undefined : setInterval(() => void loadReview(), pollIntervalMs);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [v3Enabled, prescriptionId, auth, pollIntervalMs, hasCurrentResult, processing?.status]);
  const autoSubmitted = useRef(new Set<string>());
  const reconciliationAttempted = useRef(new Set<string>());
  const acceptAnalysisOutcome = useCallback((outcome: AnalysisResultOutcome) => {
    setAnalysisOutcome(outcome);
    if (outcome.kind === 'unauthorized') {
      setIsAuthError(true);
      setError(outcome.reason);
    }
  }, []);
  const effectiveStatus = prescription?.status === 'uploaded' && processing
    ? processing.status
    : prescription?.status ?? 'uploaded';

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
        let statusAvailable = true;
        const [item, statusData] = await Promise.all([
          fetchPrescriptionDetail(prescriptionId, token),
          fetchProcessingStatus(prescriptionId, token).then((value) => {
            if (active) setProcessingError(null);
            return value;
          }).catch((cause: unknown) => {
            statusAvailable = false;
            if (active) setProcessingError(
              cause instanceof ApiError && cause.kind === 'network'
                ? 'Background job details could not be reached. Refresh to try again.'
                : 'Background job details are unavailable. Prescription status is shown from its history record.',
            );
            return null;
          }),
        ]);

        if (active) {
          setPrescription(item);
          setProcessing(statusData?.processing ?? null);
          setLoading(false);
          if (uploadProcessing?.requested === true) {
            setActionNotice(`Automatic processing submission was confirmed for job ${uploadProcessing.job_id}. Checking its current status.`);
          } else if (uploadProcessing?.requested === null) {
            setActionNotice('The upload is stored, but processing submission could not be confirmed. Checking status without re-uploading the file.');
          }
          if (uploadProcessing?.requested === true || uploadProcessing?.requested === null) {
            const terminal = ['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(item.status)
              || ['completed', 'failed', 'cancelled'].includes(statusData?.processing?.status ?? '');
            setReconciliationPending(!terminal);
          }
        }

        if (
          item.status === 'completed'
          || item.status === 'completed_with_warnings'
          || statusData?.processing?.status === 'completed'
        ) {
          const outcome = await fetchPrescriptionAnalysisResult(prescriptionId, token);
          if (active) acceptAnalysisOutcome(outcome);
        }

        if (
          uploadProcessing !== undefined
          && 'submission' in uploadProcessing
          && uploadProcessing.submission === 'unconfirmed'
          && statusAvailable
          && statusData?.processing === null
          && item.status === 'uploaded'
          && isPrescriptionAutoSubmitEnabled()
          && !reconciliationAttempted.current.has(prescriptionId)
        ) {
          reconciliationAttempted.current.add(prescriptionId);
          if (active) setSubmitting(true);
          try {
            const submission = await submitPrescriptionProcessing(prescriptionId, token);
            if (active) {
              setProcessing({
                job_id: submission.job.id,
                status: submission.job.status,
                created_at: submission.job.created_at,
                started_at: null,
                completed_at: null,
              });
              setReconciliationPending(true);
              setActionNotice(
                submission.submission.created
                  ? `The stored prescription was reconciled to job ${submission.job.id}. Status will update automatically.`
                  : `An existing job (${submission.job.id}) was confirmed for this stored prescription.`,
              );
              setProcessingError(null);
            }
          } catch {
            if (active) {
              setProcessingError('The upload is stored, but its processing submission is still unconfirmed. Status will be checked again; do not upload the file again.');
            }
          } finally {
            if (active) setSubmitting(false);
          }
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
  }, [prescriptionId, auth, passedResult, uploadProcessing, acceptAnalysisOutcome]);

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
        fetchProcessingStatus(prescriptionId, token).then((value) => {
          setProcessingError(null);
          return value;
        }).catch((cause: unknown) => {
          setProcessingError(
            cause instanceof ApiError && cause.kind === 'network'
              ? 'Background job details could not be reached. Refresh to try again.'
              : 'Background job details are unavailable. Prescription status is shown from its history record.',
          );
          return null;
        }),
      ]);
      setPrescription(item);
      setProcessing(statusData?.processing ?? null);
      if (item.status !== 'uploaded' || statusData?.processing) setReconciliationPending(false);

      if (
        item.status === 'completed'
        || item.status === 'completed_with_warnings'
        || statusData?.processing?.status === 'completed'
      ) {
        const outcome = await fetchPrescriptionAnalysisResult(prescriptionId, token);
        acceptAnalysisOutcome(outcome);
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
  }, [prescriptionId, auth, acceptAnalysisOutcome]);

  const handleStartProcessing = useCallback(async () => {
    if (!prescriptionId || submitting) return;

    if (effectiveStatus === 'cancelled') {
      setError('Cancelled prescriptions cannot be re-processed by the service. Please upload a new prescription document to run analysis.');
      return;
    }

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
      } else if (cause instanceof ApiError && cause.status === 409) {
        setError('This prescription cannot be submitted for processing in its current state. Upload a new prescription document.');
      } else if (cause instanceof ApiError && cause.status === 503) {
        setError('Prescription processing is unavailable in this deployment. The saved prescription was not submitted for analysis.');
      } else if (cause instanceof ApiError && cause.kind === 'network') {
        setError('Could not reach the processing service. No job submission was confirmed; try again when the service is available.');
      } else {
        setError('Could not submit prescription for processing. No job submission was confirmed.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [prescriptionId, submitting, effectiveStatus, auth, handleRefresh]);

  // Automated background polling while job is queued or processing
  useEffect(() => {
    const status = prescription?.status;
    const activeJob = processing?.status === 'queued' || processing?.status === 'processing';
    const awaitingUnconfirmedSubmission = reconciliationPending && status === 'uploaded';
    const awaitingConfirmedResult = review?.status === 'confirmed' && !hasCurrentResult && processing?.status !== 'failed' && processing?.status !== 'cancelled';
    if (status !== 'queued' && status !== 'processing' && !activeJob && !awaitingUnconfirmedSubmission && !awaitingConfirmedResult) return;

    let mounted = true;
    let inFlight = false;
    const interval = setInterval(async () => {
      if (!mounted || inFlight) return;
      const token = auth.getAccessToken();
      if (!token) return;
      inFlight = true;
      try {
        const [item, statusData] = await Promise.all([
          fetchPrescriptionDetail(prescriptionId, token),
          fetchProcessingStatus(prescriptionId, token).catch(() => null),
        ]);

        if (!mounted) return;
        setProcessingError(statusData ? null : 'Background job details are temporarily unavailable. Status updates will be retried automatically.');
        setPrescription(item);
        setProcessing(statusData?.processing ?? null);
        if (item.status !== 'uploaded' || statusData?.processing) setReconciliationPending(false);

        if (
          item.status === 'completed'
          || item.status === 'completed_with_warnings'
          || statusData?.processing?.status === 'completed'
        ) {
          const outcome = await fetchPrescriptionAnalysisResult(prescriptionId, token);
          if (mounted) acceptAnalysisOutcome(outcome);
        }
      } catch {
        if (mounted) setProcessingError('Status updates are temporarily unavailable. We will try again automatically.');
      } finally { inFlight = false; }
    }, pollIntervalMs);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [prescription?.status, processing?.status, reconciliationPending, prescriptionId, auth, pollIntervalMs, acceptAnalysisOutcome, review?.status, hasCurrentResult]);

  // Auto-start processing if redirected with ?process=true
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('process') === 'true' && prescription?.status === 'uploaded' && !submitting && !loading && !autoSubmitted.current.has(prescriptionId)) {
      autoSubmitted.current.add(prescriptionId);
      void handleStartProcessing();
    }
  }, [prescription?.status, location.search, submitting, loading, prescriptionId, handleStartProcessing]);

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

  const isCompletedStatus = effectiveStatus === 'completed' || effectiveStatus === 'completed_with_warnings';
  const effectiveResult = isCompletedStatus && review?.status !== 'draft'
    ? (hasCurrentResult && analysisOutcome?.kind === 'available' ? analysisOutcome.result : (!v3Enabled && passedResult?.status === effectiveStatus ? passedResult : undefined))
    : undefined;

  return (
    <div className="md-page md-prescription-results p-4 sm:p-6 space-y-6">
      {/* Top Navigation & Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="md-results-breadcrumb">
        <Link to="/prescriptions" className="hover:text-[var(--cc-text)] flex items-center gap-1 transition-colors">
          <Icon name="arrow" className="size-3.5 rotate-180" />
          <span>All Prescriptions</span>
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-mono text-[11px] text-[var(--cc-text-soft)]" title={prescriptionId}>
          {prescriptionId ? `${prescriptionId.slice(0, 8)}…` : 'Detail'}
        </span>
      </nav>

      {/* Compact Page Header with Status & Restrained Metadata */}
      <header className="md-results-header">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[var(--cc-text)]">
              Prescription Details &amp; Results
            </h1>
            <PrescriptionStatusBadge status={effectiveStatus} />
          </div>
          <p className="text-xs sm:text-sm text-[var(--cc-muted)]">
            Inspect extracted medications, recognized dosages, and OCR evidence.
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--cc-muted)] pt-0.5 [overflow-wrap:anywhere]">
            <span className="font-medium text-[var(--cc-text-soft)]">
              {prescription?.file_type?.toUpperCase().includes('PDF') ? 'PDF document' : 'Prescription Document'}
            </span>
            <span>·</span>
            <span>Size: {formatBytes(prescription?.file_size_bytes ?? null)}</span>
            <span>·</span>
            <span>Uploaded: {formatDate(prescription?.created_at ?? null)}</span>
            {prescription?.prescription_date ? (
              <>
                <span>·</span>
                <span>Prescription Date: {prescription.prescription_date}</span>
              </>
            ) : null}
            <span>·</span>
            <span className="font-mono text-[11px] text-[var(--cc-muted)]" title={prescriptionId}>
              Ref: {prescriptionId.slice(0, 8)}…
            </span>
            {processing?.job_id ? (
              <>
                <span>·</span>
                <span className="break-all font-mono text-[11px] text-[var(--cc-muted)]" title={processing.job_id}>
                  Job: {processing.job_id}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="md-results-header-actions flex items-center gap-2">
          {prescriptionId && isCompletedStatus ? (
            <ReviewAndEditButton prescriptionId={prescriptionId} />
          ) : null}
          <Button
            variant="secondary"
            loading={refreshing}
            icon="arrow"
            onClick={() => void handleRefresh()}
            aria-label="Refresh prescription status"
            className="text-xs"
          >
            Refresh
          </Button>
        </div>
      </header>

      {/* 4-Stage Processing Timeline */}
      <section aria-label="Prescription processing timeline">
        <PrescriptionProcessingStepper status={effectiveStatus} processing={processing} reviewState={review?.status} resultAvailable={Boolean(effectiveResult)} />
      </section>

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
      {processingError ? (
        <div role="alert" className="rounded-xl border border-[var(--cc-warning)]/40 bg-[var(--cc-warning-soft)]/20 p-4 text-sm text-[var(--cc-text-soft)]">
          {processingError}
        </div>
      ) : null}

      {/* Main Analysis Results Area */}
      {reviewError ? <p role="alert">{reviewError}</p> : null}
      {review?.status === 'draft' ? (
        <Card><SectionHeader title="OCR complete — Review Required" description="Review and confirm the transcription before intelligence results are produced." /><ReviewAndEditButton prescriptionId={prescriptionId} /></Card>
      ) : effectiveResult ? (
        <PrescriptionResultsView
          result={effectiveResult}
          accessToken={auth.getAccessToken() ?? ''}
          onSaveToCabinet={(med) => setSavingMedicine(med)}
        />
      ) : effectiveStatus === 'completed' || effectiveStatus === 'completed_with_warnings' ? (
        analysisOutcome === null ? (
          <Card role="status" aria-busy="true" className="border-[var(--cc-border)]">
            <SectionHeader title="Loading analysis results" description="Retrieving the completed prescription analysis." />
            <Skeleton className="mt-4 h-20 w-full rounded-xl" />
          </Card>
        ) : analysisOutcome.kind === 'error' ? (
          <Card role="alert" className="border-[var(--cc-danger)]/40">
            <SectionHeader title="Unable to load analysis results" description={analysisOutcome.reason} />
            {analysisOutcome.retryable ? (
              <Button
                variant="secondary"
                loading={refreshing}
                onClick={() => void handleRefresh()}
                className="mt-4"
              >
                Retry results
              </Button>
            ) : null}
          </Card>
        ) : (
          <Card role="status" className="border-[var(--cc-border)]">
            <SectionHeader
              title="Analysis result not available"
              description={analysisOutcome.kind === 'unavailable'
                ? analysisOutcome.reason
                : 'Sign in again to view this prescription result.'}
            />
            <Button
              variant="secondary"
              loading={refreshing}
              onClick={() => void handleRefresh()}
              className="mt-4"
            >
              Refresh results
            </Button>
          </Card>
        )
      ) : effectiveStatus === 'queued' ? (
        /* 3. Beautiful Queued-State Panel (replacing the oversized card and broken bracket) */
        <Card className="md-queued-panel">
          <span className="md-queued-icon-wrap">
            <Icon name="clock" className="size-7" />
          </span>
          <div className="flex justify-center">
            <div className="md-queued-badge">
              <span className="size-1.5 rounded-full bg-[var(--cc-primary)] animate-pulse" />
              <span>Waiting for analysis</span>
            </div>
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-[var(--cc-text)]">
            Your prescription is in the analysis queue
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-[var(--cc-muted)] max-w-lg mx-auto leading-relaxed">
            Your document has been uploaded successfully. Analysis will begin when processing becomes available.
          </p>
          <p className="mt-1 text-xs text-[var(--cc-text-soft)]">
            This prescription is in the analysis queue. Status updates are checked automatically.
          </p>

          <div className="md-queued-meta-card">
            <span>Document: <strong>{prescription?.file_type?.toUpperCase().includes('PDF') ? 'PDF document' : 'Image document'}</strong></span>
            <span>·</span>
            <span>Size: <strong>{formatBytes(prescription?.file_size_bytes ?? null)}</strong></span>
            <span>·</span>
            <span>Registered: <strong>{formatDate(prescription?.created_at ?? null)}</strong></span>
            {processing?.job_id ? (
              <>
                <span>·</span>
                <span className="font-mono">Active Job: {processing.job_id}</span>
              </>
            ) : null}
          </div>

          <div className="mt-6 flex justify-center gap-3">
            <Link to="/prescriptions" className="text-xs text-[var(--cc-primary)] hover:underline inline-flex items-center gap-1.5 font-medium">
              <span>View My Prescriptions</span>
              <Icon name="arrow" className="size-3" />
            </Link>
          </div>
        </Card>
      ) : effectiveStatus === 'processing' ? (
        /* 4. OCR Processing State */
        <Card className="md-processing-panel">
          <span className="md-processing-icon-wrap">
            <Icon name="sparkles" className="size-7 animate-pulse text-[var(--cc-primary)]" />
          </span>
          <div className="flex justify-center">
            <div className="md-queued-badge">
              <span className="size-1.5 rounded-full bg-[var(--cc-primary)] animate-ping" />
              <span>Analysis in progress</span>
            </div>
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-[var(--cc-text)]">
            Analyzing your prescription
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-[var(--cc-muted)] max-w-lg mx-auto leading-relaxed">
            Extracting medicine information from your document. Analysis in progress.
          </p>
          <p className="mt-1 text-xs text-[var(--cc-muted)]">
            The backend reports that analysis is in progress. Reading the document and identifying medicines may be occurring; individual stages are not reported.
          </p>
        </Card>
      ) : effectiveStatus === 'uploaded' ? (
        /* Uploaded State */
        <Card className="text-center py-10 px-6 border-[var(--cc-border)] bg-[var(--cc-panel)]">
          <span className="flex items-center justify-center size-14 rounded-2xl bg-[var(--cc-panel-muted)] text-[var(--cc-muted)] mx-auto mb-4">
            <Icon name="inbox" className="size-7" />
          </span>
          <h2 className="text-lg sm:text-xl font-bold text-[var(--cc-text)]">
            Document Uploaded Successfully
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-[var(--cc-muted)] max-w-lg mx-auto leading-relaxed">
            {reconciliationPending
              ? uploadProcessing?.requested === null
                ? 'The document is stored, but automatic processing submission could not be confirmed. Checking the existing job status; do not upload this document again.'
                : 'The backend confirmed an automatic processing request. Waiting for the status endpoint to report the job.'
              : <>The document has been securely stored. OCR and medicine intelligence processing have not been run. Genuine PDF, JPEG, and PNG documents are supported by the processing pipeline. Click <strong>Start OCR &amp; Analysis</strong> to submit this document.</>}
          </p>
          {!reconciliationPending ? <p className="mt-2 text-xs text-[var(--cc-muted)] flex items-center justify-center gap-1.5">
            <Icon name="shield" className="size-4 shrink-0 text-[var(--cc-info)]" />
            <span>Hosted processing worker remains disabled. Submit processing when your local worker is active.</span>
          </p> : null}
          <div className="mt-6 flex justify-center gap-3">
            <Button
              loading={submitting}
              icon="sparkles"
              onClick={() => void handleStartProcessing()}
            >
              Start OCR &amp; Analysis
            </Button>
          </div>
        </Card>
      ) : effectiveStatus === 'failed' ? (
        /* Failed State */
        <Card className="text-center py-10 px-6 border-[var(--cc-danger)]/40 bg-[var(--cc-danger-soft)]/10">
          <span className="flex items-center justify-center size-14 rounded-2xl bg-[var(--cc-danger-soft)] text-[var(--cc-danger)] mx-auto mb-4">
            <Icon name="warning" className="size-7" />
          </span>
          <h2 className="text-lg sm:text-xl font-bold text-[var(--cc-danger)]">
            Prescription Analysis Failed
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-[var(--cc-text-soft)] max-w-lg mx-auto leading-relaxed">
            Prescription analysis processing failed. You may retry submission or re-upload a clearer image.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button
              variant="danger"
              loading={submitting}
              icon="arrow"
              onClick={() => void handleStartProcessing()}
            >
              Retry Analysis
            </Button>
            <Link to="/upload-prescription" className="cc-button cc-button--secondary text-xs">
              Upload Clearer Document
            </Link>
          </div>
        </Card>
      ) : effectiveStatus === 'cancelled' ? (
        /* Cancelled State */
        <Card className="text-center py-10 px-6 border-[var(--cc-warning)]/40 bg-[var(--cc-warning-soft)]/10">
          <span className="flex items-center justify-center size-14 rounded-2xl bg-[var(--cc-warning-soft)] text-[var(--cc-warning)] mx-auto mb-4">
            <Icon name="warning" className="size-7" />
          </span>
          <h2 className="text-lg sm:text-xl font-bold text-[var(--cc-warning)]">
            Prescription Analysis Cancelled
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-[var(--cc-text-soft)] max-w-lg mx-auto leading-relaxed">
            Prescription analysis was cancelled. This record is finalized; upload the document again to initiate a new analysis.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button
              variant="secondary"
              loading={submitting}
              icon="arrow"
              onClick={() => void handleStartProcessing()}
              className="text-xs"
            >
              Restart Analysis
            </Button>
            <Link to="/upload-prescription" className="cc-button cc-button--primary text-xs">
              Upload New Document
            </Link>
          </div>
        </Card>
      ) : null}

      {/* Save to Medicine Cabinet Modal */}
      {savingMedicine ? (
        <SaveToCabinetModal
          medicine={savingMedicine}
          prescriptionId={prescriptionId}
          onClose={() => setSavingMedicine(null)}
        />
      ) : null}
    </div>
  );
}
