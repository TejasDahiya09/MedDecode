import { Link } from 'react-router-dom';
import { Badge, Button } from '../../components/ui';
import { Icon } from '../../components/Icon';
import type { ContractV1MedicineItem } from './prescription-api';
import { VerifiedAlternativesSection } from './VerifiedAlternativesSection';

interface MedicineCardProps {
  readonly medicine: ContractV1MedicineItem;
  readonly accessToken: string;
  readonly isUncertain?: boolean;
  readonly onSaveToCabinet?: (medicine: ContractV1MedicineItem) => void;
}

function matchBadge(status: ContractV1MedicineItem['medicine_match']['status']) {
  switch (status) {
    case 'matched':
      return <Badge tone="success">Matched</Badge>;
    case 'probable_match':
      return <Badge tone="warning">Probable match</Badge>;
    case 'ambiguous':
      return <Badge tone="warning">Ambiguous match</Badge>;
    case 'unmatched':
      return <Badge tone="neutral">Unmatched</Badge>;
    case 'not_attempted':
      return <Badge tone="neutral">Not attempted</Badge>;
  }
}

export function PrescriptionMedicineCard({
  medicine,
  accessToken,
  isUncertain,
  onSaveToCabinet,
}: MedicineCardProps) {
  const { sequence_number, extraction, medicine_match, confidence, derived } = medicine;
  const isUnverifiedName = !extraction.medicine_name;
  const name = extraction.medicine_name || 'Unverified Medicine Name';
  const hasStrength = extraction.strength && (extraction.strength.value !== null || extraction.strength.unit !== null);
  const strengthText = hasStrength
    ? `${extraction.strength?.value ?? ''} ${extraction.strength?.unit ?? ''}`.trim()
    : 'Not provided';

  const freq = extraction.frequency;
  const hasSlotSchedule = freq.morning != null || freq.afternoon != null || freq.night != null;
  const slotText = hasSlotSchedule
    ? `Morning: ${freq.morning ?? 'Not provided'} · Afternoon: ${freq.afternoon ?? 'Not provided'} · Night: ${freq.night ?? 'Not provided'}`
    : null;
  const timesText = freq.times_per_day !== null && freq.times_per_day !== undefined
    ? `${freq.times_per_day} time${freq.times_per_day === 1 ? '' : 's'} daily`
    : null;
  const frequencyText = timesText
    ?? (freq.type === 'as_needed' ? 'As needed' : 'Not provided');
  const durationText = formatValueUnit(extraction.duration);
  const quantityText = formatValueUnit(extraction.quantity);

  const lowConfidence = isUncertain ||
    isUnverifiedName ||
    (confidence?.extraction !== undefined && confidence.extraction !== null && confidence.extraction < 0.7) ||
    (confidence?.medicine_name !== undefined && confidence.medicine_name !== null && confidence.medicine_name < 0.7) ||
    medicine_match.status === 'ambiguous' ||
    medicine_match.status === 'unmatched';

  return (
    <article
      className={`rounded-2xl border p-5 transition-colors ${
        lowConfidence
          ? 'border-[var(--cc-warning)]/40 bg-[var(--cc-warning-soft)]/20'
          : 'border-[var(--cc-border)] bg-[var(--cc-panel)]'
      }`}
      aria-labelledby={`medicine-${sequence_number}-title`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wider uppercase text-[var(--cc-muted)]">
              Entry #{sequence_number}
            </span>
            {isUnverifiedName ? (
              <Badge tone="warning">Unverified medicine name</Badge>
            ) : null}
            {lowConfidence && !isUnverifiedName ? (
              <Badge tone="warning">Review required</Badge>
            ) : null}
            {matchBadge(medicine_match.status)}
          </div>
          <h3
            id={`medicine-${sequence_number}-title`}
            className="mt-1 break-words text-lg font-bold text-[var(--cc-text)] [overflow-wrap:anywhere]"
          >
            {name}
          </h3>
          {isUnverifiedName ? (
            <p className="text-xs text-[var(--cc-warning)] font-medium mt-1">
              Unverified medicine: name could not be resolved from document text. Please verify manually.
            </p>
          ) : null}
          {extraction.medicine_name_normalized && extraction.medicine_name_normalized !== name ? (
            <p className="text-xs text-[var(--cc-muted)]">
              Normalized: <span className="font-mono">{extraction.medicine_name_normalized}</span>
            </p>
          ) : null}
        </div>

        {medicine_match.brand_name ? (
          <div className="text-right">
            <span className="text-xs text-[var(--cc-muted)] block">Catalog reference</span>
            <span className="break-words text-sm font-semibold text-[var(--cc-text)] [overflow-wrap:anywhere]">{medicine_match.brand_name}</span>
            {medicine_match.confidence !== null ? (
              <span className="block text-xs text-[var(--cc-muted)]">
                Match confidence: {Math.round(medicine_match.confidence * 100)}%
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Raw extracted text box */}
      <div className="mt-4 rounded-lg bg-[var(--cc-bg)]/80 p-3 border border-[var(--cc-border)]/60">
        <div className="flex items-center justify-between text-xs text-[var(--cc-muted)] mb-1">
          <span className="font-medium flex items-center gap-1.5">
            <Icon name="copy" className="size-3.5" />
            Raw OCR text
          </span>
          {confidence?.extraction !== undefined && confidence.extraction !== null ? (
            <span>Recognition confidence: {Math.round(confidence.extraction * 100)}%</span>
          ) : null}
        </div>
        <p className="text-xs sm:text-sm font-mono text-[var(--cc-text-soft)] break-words [overflow-wrap:anywhere]">
          &ldquo;{extraction.raw_text}&rdquo;
        </p>
      </div>

      {/* Structured Facts Grid */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-[var(--cc-muted)]">Strength</dt>
          <dd className="mt-0.5 font-medium text-[var(--cc-text)]">{strengthText}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--cc-muted)]">Dosage form</dt>
          <dd className="mt-0.5 font-medium text-[var(--cc-text)] capitalize">
            {extraction.dosage_form ?? 'Not provided'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--cc-muted)]">Dose</dt>
          <dd className="mt-0.5 font-medium text-[var(--cc-muted)]">Not provided</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--cc-muted)]">Route</dt>
          <dd className="mt-0.5 font-medium text-[var(--cc-muted)]">Not provided</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--cc-muted)]">Frequency</dt>
          <dd className="mt-0.5 font-medium text-[var(--cc-text)]">
            {frequencyText}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--cc-muted)]">Timing</dt>
          <dd className="mt-0.5 font-medium text-[var(--cc-text)] break-words">
            {extraction.timing ?? 'Not provided'}
          </dd>
        </div>
        {slotText ? (
          <div className="col-span-2">
            <dt className="text-xs text-[var(--cc-muted)]">Dose schedule (M · A · N)</dt>
            <dd className="mt-0.5 font-medium text-[var(--cc-text)]">{slotText}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-[var(--cc-muted)]">Duration</dt>
          <dd className="mt-0.5 font-medium text-[var(--cc-text)]">{durationText}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--cc-muted)]">Quantity</dt>
          <dd className="mt-0.5 font-medium text-[var(--cc-text)]">{quantityText}</dd>
        </div>
        {derived?.estimated_total_units != null ? (
          <div>
            <dt className="text-xs text-[var(--cc-muted)]">Calculated units</dt>
            <dd className="mt-0.5 font-medium text-[var(--cc-text)]">{derived.estimated_total_units}</dd>
          </div>
        ) : null}
      </dl>

      {/* Instructions */}
      {extraction.instructions ? (
        <div className="mt-4 pt-3 border-t border-[var(--cc-border)]/50">
          <span className="text-xs font-semibold text-[var(--cc-muted)] block">Instructions</span>
          <p className="mt-1 text-sm text-[var(--cc-text-soft)]">{extraction.instructions}</p>
        </div>
      ) : null}

      {/* Matched catalog ingredients */}
      {medicine_match.ingredients && medicine_match.ingredients.length > 0 ? (
        <div className="mt-3 pt-3 border-t border-[var(--cc-border)]/50 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--cc-muted)]">Active ingredients:</span>
          {medicine_match.ingredients.map((ing, idx) => (
            <Badge key={idx} tone="neutral">
              {ing.name} {ing.strength_value ? `${ing.strength_value} ${ing.strength_unit ?? ''}` : ''}
            </Badge>
          ))}
        </div>
      ) : null}

      <VerifiedAlternativesSection medicine={medicine} accessToken={accessToken} />

      {/* Card Actions Footer: Catalogue lookup & Save to Cabinet */}
      <div className="mt-3 pt-3 border-t border-[var(--cc-border)]/50 flex flex-wrap items-center justify-between gap-2">
        {name && name !== 'Unverified Medicine Name' ? (
          <Link
            to={`/medicine-library?q=${encodeURIComponent(extraction.medicine_name || medicine_match.brand_name || name)}`}
            className="text-xs font-semibold text-[var(--cc-primary)] hover:underline inline-flex items-center gap-1.5"
            title={`Search catalogue for ${name}`}
          >
            <Icon name="search" className="size-3.5" />
            <span>Look up formulation</span>
            <Icon name="arrow" className="size-3" />
          </Link>
        ) : <span />}

        {onSaveToCabinet ? (
          <Button
            variant="secondary"
            icon="briefcase"
            onClick={() => onSaveToCabinet(medicine)}
            className="text-xs h-7 px-2.5"
            aria-label={`Save ${name} to Medicine Cabinet`}
          >
            Save to My Cabinet
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function formatValueUnit(value: { readonly value: number | null; readonly unit: string | null } | undefined): string {
  if (!value || (value.value === null && value.unit === null)) return 'Not provided';
  return [value.value ?? 'Value not provided', value.unit ?? 'Unit not provided'].join(' ');
}
