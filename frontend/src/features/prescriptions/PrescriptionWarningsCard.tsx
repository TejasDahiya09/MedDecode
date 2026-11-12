import { Badge, Card, SectionHeader } from '../../components/ui';
import { Icon } from '../../components/Icon';
import type { ContractV1WarningItem } from './prescription-api';

interface WarningsCardProps {
  readonly warnings: readonly ContractV1WarningItem[];
}

function severityTone(severity: ContractV1WarningItem['severity']): 'danger' | 'warning' | 'info' {
  switch (severity) {
    case 'high':
      return 'danger';
    case 'medium':
    case 'low':
      return 'warning';
    case 'info':
      return 'info';
  }
}

export function PrescriptionWarningsCard({ warnings }: WarningsCardProps) {
  if (warnings.length === 0) {
    return null;
  }

  const hasHighOrMedium = warnings.some((w) => w.severity === 'high' || w.severity === 'medium');

  return (
    <Card className="border-[var(--cc-border)]">
      <div className="flex items-center justify-between">
        <SectionHeader
          title={`Warnings & Discrepancies (${warnings.length})`}
          description="Issues identified during optical character recognition and catalog matching."
        />
        <Badge tone={hasHighOrMedium ? 'warning' : 'info'}>
          {hasHighOrMedium ? 'Attention required' : 'Informational'}
        </Badge>
      </div>

      <ul className="mt-4 grid gap-3" role="list">
        {warnings.map((warning, index) => {
          const tone = severityTone(warning.severity);
          return (
            <li
              key={`${warning.code}-${index}`}
              className="flex flex-col gap-2 rounded-xl border border-[var(--cc-border)]/70 p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <Icon
                  name="warning"
                  className={`size-5 shrink-0 mt-0.5 ${
                    tone === 'danger'
                      ? 'text-[var(--cc-danger)]'
                      : tone === 'warning'
                      ? 'text-[var(--cc-warning)]'
                      : 'text-[var(--cc-info)]'
                  }`}
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-[var(--cc-text)] font-mono">
                      {warning.code}
                    </span>
                    <Badge tone={tone}>{warning.severity}</Badge>
                    {warning.related_medicine_sequence_number ? (
                      <span className="text-xs text-[var(--cc-muted)]">
                        Relates to Entry #{warning.related_medicine_sequence_number}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-[var(--cc-text-soft)]">{warning.message}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
