import type { PropsWithChildren, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, PageHeader } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useDemo } from './demo-context';

export function DemoPage({ title, description, actions, children }: PropsWithChildren<{ title: string; description: string; actions?: ReactNode }>) {
  const { notice } = useDemo();
  return <div className="md-page md-demo"><PageHeader eyebrow="Your medicine workspace" title={title} description={description} actions={<><Badge>Demo Mode</Badge>{actions}</>} /><div className="md-demo-notice"><Icon name="shield" className="size-4" /><p><strong>Synthetic examples.</strong> No clinical validation or connected services. Changes reset on reload.</p></div>{notice && <p className="md-demo-feedback" role="status">{notice}</p>}{children}<p className="md-demo-footnote">Demo Mode · In-memory only · No account, cloud saving or background notifications.</p></div>;
}
export function DemoLink({ to, children, secondary = false }: PropsWithChildren<{ to: string; secondary?: boolean }>) { return <Link className={`cc-button cc-button--${secondary ? 'secondary' : 'primary'}`} to={to}>{children}<Icon name="arrow" className="size-4" /></Link>; }
export function ReferenceArt({ code, small = false }: { code: string; small?: boolean }) { return <div className={`md-demo-art${small ? ' is-small' : ''}`} aria-hidden="true"><svg viewBox="0 0 160 110"><rect x="43" y="24" width="74" height="62" rx="10" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M43 42h74M55 34h20M91 34h14M56 54h22M56 62h15M56 70h32" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="88" y="52" width="14" height="24" rx="7" fill="currentColor" opacity=".25" /><path d="M88 64h14" stroke="currentColor" /></svg><span>{code}</span></div>; }
export function Verification() { return <Badge tone="warning">Clinical verification unavailable</Badge>; }
