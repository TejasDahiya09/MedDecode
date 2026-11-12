import { Badge, Card, EmptyState, SectionHeader } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PrescriptionMedicineCard } from './PrescriptionMedicineCard';
import { PrescriptionWarningsCard } from './PrescriptionWarningsCard';
import type { ContractV1AnalysisResult } from './prescription-api';

interface PrescriptionResultsViewProps {
  readonly result: ContractV1AnalysisResult;
}

export function PrescriptionResultsView({ result }: PrescriptionResultsViewProps) {
  const { medicines, warnings, prescription, patient, processing_metadata, status } = result;

  const isCompletedWithWarnings = status === 'completed_with_warnings';
  const confidenceScore = processing_metadata.overall_confidence;
  const isLowConfidence = confidenceScore !== null && confidenceScore < 0.75;
  const hasWarnings = warnings.length > 0;
  const showUncertainNotice = isCompletedWithWarnings || isLowConfidence || hasWarnings;

  return (
    <div className="grid gap-6">
      {/* Uncertain OCR Banner if completed_with_warnings or low confidence */}
      {showUncertainNotice ? (
        <section
          role="status"
          aria-label="OCR recognition alert"
          className="rounded-2xl border border-[var(--cc-warning)]/40 bg-[var(--cc-warning-soft)]/20 p-5"
        >
          <div className="flex items-start gap-3.5">
            <span className="rounded-xl bg-[var(--cc-warning)]/20 p-2 text-[var(--cc-warning)]">
              <Icon name="warning" className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-[var(--cc-text)]">
                  {isCompletedWithWarnings
                    ? 'Completed with warnings: Uncertain OCR outcomes detected'
                    : 'Notice: Some recognized text requires manual verification'}
                </h3>
                <Badge tone="warning">Manual verification required</Badge>
              </div>
              <p className="mt-1 text-sm text-[var(--cc-text-soft)]">
                Optical character recognition identified items with ambiguous matches or low confidence scores.
                Review every extracted strength, unit, and instruction against the original physical prescription before relying on this summary.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* Prescription Metadata Grid (Doctor, Facility, Patient, Confidence) */}
      <Card>
        <SectionHeader
          title="Prescription Information"
          description="Metadata extracted from the prescription header and document registry."
        />
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--cc-muted)]">Prescription Date</dt>
            <dd className="mt-1 font-semibold text-[var(--cc-text)]">
              {prescription?.prescription_date ?? 'Not dated'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--cc-muted)]">Overall OCR Confidence</dt>
            <dd className="mt-1 font-semibold text-[var(--cc-text)] flex items-center gap-1.5">
              {confidenceScore !== null ? (
                <>
                  <span>{Math.round(confidenceScore * 100)}%</span>
                  <Badge tone={confidenceScore >= 0.8 ? 'success' : 'warning'}>
                    {confidenceScore >= 0.8 ? 'High' : 'Moderate'}
                  </Badge>
                </>
              ) : (
                'Not computed'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--cc-muted)]">Prescribing Doctor</dt>
            <dd className="mt-1 font-semibold text-[var(--cc-text)]">
              {prescription?.doctor?.name ?? 'Not identified'}
              {prescription?.doctor?.registration_number ? (
                <span className="block text-xs font-normal text-[var(--cc-muted)]">
                  Reg: {prescription.doctor.registration_number}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--cc-muted)]">Medical Facility</dt>
            <dd className="mt-1 font-semibold text-[var(--cc-text)]">
              {prescription?.facility?.name ?? 'Not identified'}
              {prescription?.facility?.phone ? (
                <span className="block text-xs font-normal text-[var(--cc-muted)]">
                  {prescription.facility.phone}
                </span>
              ) : null}
            </dd>
          </div>
          {patient?.name || patient?.age || patient?.gender ? (
            <div className="col-span-2 sm:col-span-4 pt-3 border-t border-[var(--cc-border)]/50">
              <dt className="text-xs text-[var(--cc-muted)]">Patient Reference</dt>
              <dd className="mt-1 font-medium text-[var(--cc-text)]">
                {patient.name ?? 'Patient'}
                {patient.age ? ` · Age ${patient.age}` : ''}
                {patient.gender ? ` · ${patient.gender}` : ''}
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {/* Recognized Medicines */}
      <section aria-labelledby="recognized-medicines-heading" className="grid gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="recognized-medicines-heading" className="text-xl font-bold text-[var(--cc-text)]">
              Recognized Medicines ({medicines.length})
            </h2>
            <p className="text-sm text-[var(--cc-muted)]">
              Extracted pharmaceutical items, strengths, and scheduled instructions.
            </p>
          </div>
          <Badge tone="info">{medicines.length} {medicines.length === 1 ? 'item' : 'items'}</Badge>
        </div>

        {medicines.length === 0 ? (
          <EmptyState
            icon="copy"
            title="No medicines recognized"
            description="The intelligence engine did not identify any pharmaceutical entries in this document."
          />
        ) : (
          <div className="grid gap-4">
            {medicines.map((medicine) => (
              <PrescriptionMedicineCard
                key={medicine.sequence_number}
                medicine={medicine}
                isUncertain={isCompletedWithWarnings}
              />
            ))}
          </div>
        )}
      </section>

      {/* Warnings & Discrepancies */}
      <PrescriptionWarningsCard warnings={warnings} />

      {/* Non-fabrication & Clinical Safety Disclaimer */}
      <footer className="rounded-xl border border-[var(--cc-border)] bg-[var(--cc-bg)]/60 p-4 text-xs text-[var(--cc-muted)] leading-relaxed">
        <div className="flex items-start gap-2.5">
          <Icon name="shield" className="size-4 shrink-0 mt-0.5 text-[var(--cc-primary)]" />
          <div>
            <strong className="text-[var(--cc-text-soft)]">MedDecode Clinical Safety Notice:</strong>{' '}
            Automated transcription is provided for reference only. MedDecode does not fabricate medicine
            alternatives, prices, commercial substitution options, or unverified recommendations. All extracted
            strengths and schedules must be reviewed with the original prescription and a certified pharmacist or clinician.
          </div>
        </div>
      </footer>
    </div>
  );
}
