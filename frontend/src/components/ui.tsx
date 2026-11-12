import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cn } from '../utils/class-names';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon?: IconName;
  readonly loading?: boolean;
  readonly variant?: 'danger' | 'ghost' | 'outline' | 'primary' | 'secondary';
}

export function Button({
  children,
  className,
  disabled,
  icon,
  loading = false,
  variant = 'primary',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      className={cn('cc-button', `cc-button--${variant}`, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <span aria-hidden="true" className="cc-button-spinner" /> : null}
      {!loading && icon ? <Icon className="size-4" name={icon} /> : null}
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: PropsWithChildren<{ readonly tone?: 'danger' | 'info' | 'neutral' | 'success' | 'warning' }>) {
  return <span className={`cc-badge cc-badge--${tone}`}>{children}</span>;
}

export function Card({ children, className }: PropsWithChildren<{ readonly className?: string }>) {
  return <section className={cn('cc-card', className)}>{children}</section>;
}

export function EmptyState({
  action,
  description,
  icon = 'inbox',
  title,
}: {
  readonly action?: ReactNode;
  readonly description: string;
  readonly icon?: IconName;
  readonly title: string;
}) {
  return (
    <div className="cc-empty">
      <span className="cc-icon-box">
        <Icon className="size-6" name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  readonly actions?: ReactNode;
  readonly description: string;
  readonly eyebrow?: string;
  readonly title: string;
}) {
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="cc-eyebrow">{eyebrow}</p> : null}
        <h1 className="cc-page-title">{title}</h1>
        <p className="cc-page-description mt-2 max-w-2xl text-sm leading-6 sm:text-base">
          {description}
        </p>
      </div>
      {actions ? <div className="cc-page-actions shrink-0">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({
  actions,
  description,
  title,
}: {
  readonly actions?: ReactNode;
  readonly description?: string;
  readonly title: string;
}) {
  return (
    <header className="cc-section-header">
      <div className="min-w-0">
        <h2 className="cc-section-title">{title}</h2>
        {description ? <p className="cc-section-description">{description}</p> : null}
      </div>
      {actions ? <div className="cc-page-actions shrink-0">{actions}</div> : null}
    </header>
  );
}

export function Skeleton({ className }: { readonly className?: string }) {
  return <div aria-hidden="true" className={cn('cc-skeleton', className)} />;
}
