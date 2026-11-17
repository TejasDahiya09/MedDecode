import { Icon } from '../../components/Icon';
import type { PrescriptionStatus, ProcessingJobInfo } from './prescription-api';

interface StepperProps {
  readonly status: PrescriptionStatus;
  readonly processing: ProcessingJobInfo | null;
  readonly reviewState?: 'draft' | 'confirmed' | null;
  readonly resultAvailable?: boolean;
}

export function PrescriptionProcessingStepper({ status, processing, reviewState, resultAvailable = false }: StepperProps) {
  const isUploaded = status === 'uploaded';
  const isQueued = status === 'queued';
  const isProcessing = status === 'processing';
  const isCompleted = status === 'completed' && resultAvailable;
  const isCompletedWithWarnings = status === 'completed_with_warnings' && resultAvailable;
  const isFailed = status === 'failed';
  const isCancelled = status === 'cancelled';
  if (reviewState && !resultAvailable) {
    const failed = isFailed || processing?.status === 'failed';
    const stages = ['Upload successful', 'OCR complete — Review Required', 'Review & Edit',
      reviewState === 'confirmed' ? (failed ? 'Intelligence processing failed' : 'Review Confirmed — Intelligence Processing') : 'Awaiting review confirmation',
      'Results pending'];
    return <div className="md-stepper-container" role="region" aria-label="Prescription Analysis Progress">
      <ol className="md-stepper-grid">{stages.map((label, index) => <li key={label} className={`md-stepper-item ${index === 0 ? 'is-completed' : ''}`}><strong>{label}</strong></li>)}</ol>
      <p role="status">{failed ? 'Processing failed. No new result is available.' : reviewState === 'draft' ? 'Review and confirm the extracted medicines before intelligence processing.' : processing?.status === 'queued' ? 'Confirmed intelligence job queued.' : 'Waiting for the confirmed revision result. Status updates automatically.'}</p>
    </div>;
  }

  // Step 2: Queue
  const step2State = isUploaded
    ? 'pending'
    : isQueued
    ? 'active'
    : isCancelled
    ? 'cancelled'
    : 'completed';

  // Step 3: OCR & Intelligence Analysis
  const step3State = isUploaded || isQueued
    ? 'pending'
    : isProcessing
    ? 'active'
    : isFailed
    ? 'failed'
    : isCancelled
    ? 'cancelled'
    : 'completed';

  // Step 4: Results Ready
  const step4State = isCompleted
    ? 'completed'
    : isCompletedWithWarnings
    ? 'warning'
    : isFailed
    ? 'failed'
    : isCancelled
    ? 'cancelled'
    : 'pending';

  return (
    <div className="md-stepper-container" role="region" aria-label="Prescription Analysis Progress">
      <div className="md-stepper-grid">
        {/* Step 1: Uploaded */}
        <div className="md-stepper-item is-completed">
          <span className="md-stepper-icon-box bg-[var(--cc-success-soft)] text-[var(--cc-success)]">
            <Icon name="check" className="size-4" />
          </span>
          <div className="min-w-0">
            <span className="text-[11px] font-semibold text-[var(--cc-muted)] uppercase tracking-wider block">Step 1</span>
            <strong className="text-sm font-bold text-[var(--cc-text)] block">Document Uploaded</strong>
            <small className="text-xs text-[var(--cc-muted)] block mt-0.5">Securely registered</small>
          </div>
        </div>

        {/* Step 2: Queue */}
        <div className={`md-stepper-item ${
          step2State === 'active'
            ? 'is-active'
            : step2State === 'completed'
            ? 'is-completed'
            : ''
        }`}>
          <span className={`md-stepper-icon-box ${
            step2State === 'completed'
              ? 'bg-[var(--cc-success-soft)] text-[var(--cc-success)]'
              : step2State === 'active'
              ? 'bg-[var(--cc-primary)] text-white shadow-xs'
              : 'bg-[var(--cc-panel-muted)] text-[var(--cc-muted)]'
          }`}>
            {step2State === 'completed' ? (
              <Icon name="check" className="size-4" />
            ) : step2State === 'active' ? (
              <Icon name="clock" className="size-4" />
            ) : (
              <span className="text-xs font-bold">2</span>
            )}
          </span>
          <div className="min-w-0">
            <span className="text-[11px] font-semibold text-[var(--cc-muted)] uppercase tracking-wider block">Step 2</span>
            <strong className="text-sm font-bold text-[var(--cc-text)] block">Analysis Queue</strong>
            <small className="text-xs text-[var(--cc-muted)] block mt-0.5 truncate">
              {step2State === 'active'
                ? processing?.job_id
                  ? `Active job: ${processing.job_id.slice(0, 8)}...`
                  : 'Waiting for worker'
                : step2State === 'completed'
                ? 'Claimed by worker'
                : 'Pending start'}
            </small>
          </div>
        </div>

        {/* Step 3: Analysis Pipeline */}
        <div className={`md-stepper-item ${
          step3State === 'active'
            ? 'is-active'
            : step3State === 'completed'
            ? 'is-completed'
            : step3State === 'failed'
            ? 'is-failed'
            : ''
        }`}>
          <span className={`md-stepper-icon-box ${
            step3State === 'completed'
              ? 'bg-[var(--cc-success-soft)] text-[var(--cc-success)]'
              : step3State === 'active'
              ? 'bg-[var(--cc-primary)] text-white animate-pulse'
              : step3State === 'failed'
              ? 'bg-[var(--cc-danger-soft)] text-[var(--cc-danger)]'
              : 'bg-[var(--cc-panel-muted)] text-[var(--cc-muted)]'
          }`}>
            {step3State === 'completed' ? (
              <Icon name="check" className="size-4" />
            ) : step3State === 'active' ? (
              <Icon name="sparkles" className="size-4" />
            ) : step3State === 'failed' ? (
              <Icon name="warning" className="size-4" />
            ) : (
              <span className="text-xs font-bold">3</span>
            )}
          </span>
          <div className="min-w-0">
            <span className="text-[11px] font-semibold text-[var(--cc-muted)] uppercase tracking-wider block">Step 3</span>
            <strong className="text-sm font-bold text-[var(--cc-text)] block">OCR &amp; Intelligence</strong>
            <small className="text-xs text-[var(--cc-muted)] block mt-0.5">
              {step3State === 'active'
                ? 'Reading text & medicines…'
                : step3State === 'completed'
                ? 'Medicines recognized'
                : step3State === 'failed'
                ? 'Processing failed'
                : 'Awaiting pipeline'}
            </small>
          </div>
        </div>

        {/* Step 4: Results Ready */}
        <div className={`md-stepper-item ${
          step4State === 'completed'
            ? 'is-completed'
            : step4State === 'warning'
            ? 'is-warning'
            : step4State === 'failed'
            ? 'is-failed'
            : ''
        }`}>
          <span className={`md-stepper-icon-box ${
            step4State === 'completed'
              ? 'bg-[var(--cc-success)] text-white'
              : step4State === 'warning'
              ? 'bg-[var(--cc-warning)] text-white'
              : step4State === 'failed'
              ? 'bg-[var(--cc-danger)] text-white'
              : 'bg-[var(--cc-panel-muted)] text-[var(--cc-muted)]'
          }`}>
            {step4State === 'completed' ? (
              <Icon name="check" className="size-4" />
            ) : step4State === 'warning' ? (
              <Icon name="warning" className="size-4" />
            ) : step4State === 'failed' ? (
              <Icon name="warning" className="size-4" />
            ) : (
              <span className="text-xs font-bold">4</span>
            )}
          </span>
          <div className="min-w-0">
            <span className="text-[11px] font-semibold text-[var(--cc-muted)] uppercase tracking-wider block">Step 4</span>
            <strong className="text-sm font-bold text-[var(--cc-text)] block">{resultAvailable ? 'Results Ready' : 'Results pending'}</strong>
            <small className="text-xs text-[var(--cc-muted)] block mt-0.5">
              {step4State === 'completed'
                ? 'Full analysis ready'
                : step4State === 'warning'
                ? 'Ready with warnings'
                : step4State === 'failed'
                ? 'Analysis failed'
                : step4State === 'cancelled'
                ? 'Analysis cancelled'
                : 'Pending completion'}
            </small>
          </div>
        </div>
      </div>

      {/* Accessible progress announcement */}
      <p className="sr-only" role="status" aria-live="polite">
        Current prescription status: {status}.
        {isQueued && ' The job is queued for processing.'}
        {isProcessing && ' The document is being read by the intelligence pipeline.'}
        {isCompleted && ' Analysis is complete and results are displayed below.'}
      </p>
    </div>
  );
}
