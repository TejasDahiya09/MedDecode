import { Link } from 'react-router-dom';
import { Badge, Card, PageHeader } from '../../components/ui';
import { Icon } from '../../components/Icon';

interface BackendUnavailablePageProps {
  readonly title: string;
  readonly description: string;
  readonly requirement: string;
  readonly demoPath?: string;
}

export function BackendUnavailablePage({
  title,
  description,
  requirement,
  demoPath,
}: BackendUnavailablePageProps) {
  return (
    <div className="md-page p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader eyebrow="Backend capability" title={title} description={description} />
      <Card className="border-[var(--cc-border)]">
        <div role="status" className="flex items-start gap-3">
          <span className="cc-icon-box text-[var(--cc-info)]">
            <Icon name="shield" className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--cc-text)]">Unavailable from this backend</h2>
              <Badge tone="warning">No sample results shown</Badge>
            </div>
            <p className="mt-2 text-sm text-[var(--cc-text-soft)]">{requirement}</p>
            <p className="mt-2 text-sm text-[var(--cc-muted)]">
              This production page does not use fictional medicine data or imply that unavailable evidence exists.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link className="cc-button cc-button--secondary" to="/home">Back to Home</Link>
              {demoPath ? <Link className="cc-button cc-button--ghost" to={demoPath}>Open labelled demo</Link> : null}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
