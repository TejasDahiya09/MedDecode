import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button, Card, PageHeader, Skeleton } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ApiError } from '../../services/api-client';
import { useAuth } from '../auth/AuthProvider';
import { fetchAccountProfile, type AccountProfile } from './profile-api';

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function accountError(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Your session has expired. Sign in again to view your account.';
    if (cause.status === 404) return 'Your verified session does not yet have an application profile.';
    if (cause.kind === 'network') return 'The account service could not be reached. Check the local backend and try again.';
  }
  return 'Your account information is temporarily unavailable. Please try again.';
}

export function AccountPage() {
  const auth = useAuth();
  const token = auth.getAccessToken();
  const profileQuery = useQuery<AccountProfile, unknown>({
    queryKey: ['account-profile', auth.user?.id],
    queryFn: () => token ? fetchAccountProfile(token) : Promise.reject(new ApiError('An authenticated session is required.', 401, 'http')),
    enabled: Boolean(token),
  });
  const profile = profileQuery.data ?? null;
  const error = !token ? 'Your session has expired. Sign in again to view your account.' : profileQuery.error ? accountError(profileQuery.error) : null;

  if (profileQuery.isLoading) {
    return <div className="md-page p-4 sm:p-6 max-w-3xl mx-auto space-y-5" aria-busy="true"><p className="sr-only" role="status">Loading account information...</p><Skeleton className="h-9 w-64" /><Skeleton className="h-44 w-full rounded-xl" /></div>;
  }

  return (
    <div className="md-page p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <PageHeader eyebrow="Account" title="Account & settings" description="Review the identity connected to this MedDecode session and manage the current session." />
      {error ? (
        <Card className="text-center py-8" role="alert">
          <span className="cc-icon-box mx-auto text-[var(--cc-danger)]"><Icon name="shield" className="size-6" /></span>
          <h2 className="mt-4 text-lg font-semibold text-[var(--cc-text)]">Account information unavailable</h2>
          <p className="mt-2 text-sm text-[var(--cc-muted)]">{error}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3"><Button variant="secondary" loading={profileQuery.isFetching} onClick={() => void profileQuery.refetch()}>Try again</Button><Link className="cc-button cc-button--ghost" to="/sign-in">Sign in</Link></div>
        </Card>
      ) : profile ? (
        <Card>
          <div className="flex items-start gap-4">
            <span className="cc-icon-box text-[var(--cc-info)]"><Icon name="shield" className="size-6" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-[var(--cc-text)]">Verified account</h2>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">Name</dt><dd className="mt-1 break-words text-sm text-[var(--cc-text)]">{profile.name?.trim() || 'Not provided'}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">Email</dt><dd className="mt-1 break-words text-sm text-[var(--cc-text)]">{profile.email ?? auth.user?.email ?? 'Not provided'}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">Member since</dt><dd className="mt-1 text-sm text-[var(--cc-text)]">{formatDate(profile.createdAt)}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">Session</dt><dd className="mt-1 text-sm text-[var(--cc-text)]">Authenticated</dd></div>
              </dl>
            </div>
          </div>
        </Card>
      ) : null}
      <Card>
        <h2 className="text-base font-semibold text-[var(--cc-text)]">Session controls</h2>
        <p className="mt-2 text-sm text-[var(--cc-muted)]">Signing out clears this browser session and returns you to the sign-in page.</p>
        <Button className="mt-5" variant="secondary" onClick={() => void auth.signOut()}>Sign out</Button>
      </Card>
      <p className="text-xs leading-5 text-[var(--cc-muted)]">Password changes and clinical profile editing are not offered on this page. No additional account-management capability is implied.</p>
    </div>
  );
}
