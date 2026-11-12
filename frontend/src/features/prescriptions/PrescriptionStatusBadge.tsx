import { Badge } from '../../components/ui';
import type { PrescriptionStatus } from './prescription-api';

interface StatusBadgeProps {
  readonly status: PrescriptionStatus;
}

export function PrescriptionStatusBadge({ status }: StatusBadgeProps) {
  switch (status) {
    case 'uploaded':
      return <Badge tone="neutral">Uploaded</Badge>;
    case 'queued':
      return <Badge tone="info">Queued</Badge>;
    case 'processing':
      return <Badge tone="info">Processing</Badge>;
    case 'completed':
      return <Badge tone="success">Completed</Badge>;
    case 'completed_with_warnings':
      return <Badge tone="warning">Completed with warnings</Badge>;
    case 'failed':
      return <Badge tone="danger">Failed</Badge>;
    default:
      return <Badge tone="neutral">{status}</Badge>;
  }
}
