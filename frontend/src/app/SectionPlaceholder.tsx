import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, PageHeader, SectionHeader } from '../components/ui';
import type { Destination } from './navigation';

export function SectionPlaceholder({ destination }: { readonly destination: Destination }) {
  return (
    <div className="md-page">
      <PageHeader eyebrow="MedDecode workspace" title={destination.label} description={destination.description} />
      <Card className="md-placeholder">
        <SectionHeader title="Section preview" actions={<Badge>Navigation preview</Badge>} />
        <EmptyState icon={destination.icon} title="Not yet implemented" description="This placeholder verifies navigation and layout. This feature is not yet implemented." />
      </Card>
      <p className="md-placeholder-note">Product workflows are not yet implemented. No application services are connected to this preview.</p>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="md-page">
      <PageHeader title="Page not found" description="The address does not match a MedDecode section." />
      <Card className="md-placeholder">
        <EmptyState title="Choose a section" description="Use the navigation or return to Home." action={<Link className="cc-button cc-button--primary" to="/home">Return to Home</Link>} />
      </Card>
    </div>
  );
}
