import { Badge, Card, EmptyState, SectionHeader } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PrescriptionMedicineCard } from './PrescriptionMedicineCard';
import { PrescriptionWarningsCard } from './PrescriptionWarningsCard';
import type { ContractV1AnalysisResult, ContractV1MedicineItem } from './prescription-api';

interface PrescriptionResultsViewProps {
  readonly result: ContractV1AnalysisResult;
  readonly accessToken?: string;
  readonly onSaveToCabinet?: (medicine: ContractV1MedicineItem) => void;
}

export function PrescriptionResultsView({ result, accessToken = '', onSaveToCabinet }: PrescriptionResultsViewProps) {
  const { medicines, warnings, prescription, patient, processing_metadata, recommendations = [], status } = result;

  const isCompletedWithWarnings = status === 'completed_with_warnings';
  const confidenceScore = processing_metadata.overall_confidence;
  const hasWarnings = warnings.length > 0;
  const showUncertainNotice = isCompletedWithWarnings || hasWarnings;

  return (
    <div className="grid gap-6">
      {/* Surface the persisted completion status and warnings without guessing their source. */}
      {showUncertainNotice ? (
        <section
          role="status"
          aria-label="Analysis warnings"
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
                    ? 'Analysis completed with warnings'
                    : 'This analysis includes warnings'}
                </h3>
                <Badge tone="warning">
                  {hasWarnings
                    ? `${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}`
                    : 'Completed with warnings'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-[var(--cc-text-soft)]">
                Review the recorded warnings and extracted details against the original prescription.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* Prescription Metadata Grid (Doctor, Facility, Patient, Confidence) */}
      <Card>
        <SectionHeader
          title="Prescription Information"
          description="Prescription details returned with this analysis."
        />
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--cc-muted)]">Prescription Date</dt>
            <dd className="mt-1 font-semibold text-[var(--cc-text)]">
              {prescription?.prescription_date ?? 'Not dated'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--cc-muted)]">Reported result confidence</dt>
            <dd className="mt-1 font-semibold text-[var(--cc-text)] flex items-center gap-1.5">
              {confidenceScore !== null ? (
                <span>{Math.round(confidenceScore * 100)}%</span>
              ) : (
                'Not provided'
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
                {patient.age != null ? ` · Age ${patient.age}` : ''}
                {patient.gender ? ` · ${patient.gender}` : ''}
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <section role="note">
        <Card className="border-[var(--cc-border)]">
          <div className="flex items-start gap-3">
            <Icon name="shield" className="size-5 shrink-0 text-[var(--cc-info)]" />
            <div>
              <h2 className="font-semibold text-[var(--cc-text)]">Source evidence unavailable</h2>
              <p className="mt-1 text-sm text-[var(--cc-muted)]">
                This result includes extraction and match fields, but no source provenance, regulatory evidence, or price observations. None are inferred or displayed as verified facts.
              </p>
            </div>
          </div>
        </Card>
      </section>

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
                accessToken={accessToken}
                isUncertain={isCompletedWithWarnings}
                onSaveToCabinet={onSaveToCabinet}
              />
            ))}
          </div>
        )}
      </section>

      {recommendations.length > 0 ? (
        <section aria-labelledby="analysis-notes-heading" className="grid gap-3">
          <div>
            <h2 id="analysis-notes-heading" className="text-xl font-bold text-[var(--cc-text)]">
              Analysis notes
            </h2>
            <p className="text-sm text-[var(--cc-muted)]">
              Notes returned with this analysis; they are not a substitute for professional advice.
            </p>
          </div>
          <div className="grid gap-3">
            {recommendations.map((recommendation, index) => (
              <Card key={`${recommendation.type}-${index}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-semibold text-[var(--cc-text)] break-words [overflow-wrap:anywhere]">
                    {recommendation.title}
                  </h3>
                  <Badge tone="info">{recommendation.type}</Badge>
                </div>
                <p className="mt-2 text-sm text-[var(--cc-text-soft)] break-words [overflow-wrap:anywhere]">
                  {recommendation.message}
                </p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--cc-muted)]">
                  {recommendation.related_medicine_sequence_number !== null ? (
                    <span>Relates to Entry #{recommendation.related_medicine_sequence_number}</span>
                  ) : null}
                  {recommendation.confidence !== null ? (
                    <span>Reported confidence: {Math.round(recommendation.confidence * 100)}%</span>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

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
