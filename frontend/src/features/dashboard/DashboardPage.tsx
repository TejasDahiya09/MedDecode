import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, EmptyState, Skeleton } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ApiError } from '../../services/api-client';
import { useAuth } from '../auth/AuthProvider';
import { fetchMedicineCabinet } from '../cabinet/medicine-cabinet-api';
import {
  fetchPrescriptionHistory,
  type PrescriptionHistoryItem,
} from '../prescriptions/prescription-api';
import { PrescriptionStatusBadge } from '../prescriptions/PrescriptionStatusBadge';
import '../demo/home-layout.css';

function serviceError(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Your session expired. Sign in again to load this section.';
    if (cause.status === 503) return 'The service is temporarily unavailable (HTTP 503).';
    if (cause.status === 500) return 'The backend encountered an internal error (HTTP 500).';
    if (cause.status === 502) return 'The service returned an unexpected response (HTTP 502).';
    if (cause.kind === 'network') return 'The backend could not be reached. Check the connection and try again.';
  }
  return 'This section could not be loaded. Try again.';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : value;
}

export function DashboardPage() {
  const auth = useAuth();
  const token = auth.getAccessToken();

  const dashboardQuery = useQuery({
    queryKey: ['dashboard', auth.user?.id],
    enabled: Boolean(token),
    queryFn: async () => {
      if (!token) throw new ApiError('An authenticated session is required.', 401);
      const [historyResult, cabinetResult] = await Promise.allSettled([
        fetchPrescriptionHistory(token),
        fetchMedicineCabinet(token),
      ]);
      return {
        history: historyResult.status === 'fulfilled' ? historyResult.value : null,
        historyError: historyResult.status === 'rejected' ? serviceError(historyResult.reason) : null,
        cabinet: cabinetResult.status === 'fulfilled' ? cabinetResult.value : null,
        cabinetError: cabinetResult.status === 'rejected' ? serviceError(cabinetResult.reason) : null,
      };
    },
  });

  if (!token) {
    return (
      <div className="md-page p-4 sm:p-6 max-w-5xl mx-auto">
        <Card className="text-center py-12">
          <h1 className="text-xl font-bold text-[var(--cc-text)]">Session required</h1>
          <p className="mt-2 text-sm text-[var(--cc-muted)]">Sign in again to load your account data.</p>
          <Link className="cc-button cc-button--primary mt-5" to="/sign-in">Sign In</Link>
        </Card>
      </div>
    );
  }

  if (dashboardQuery.isPending) {
    return (
      <div className="md-page p-4 sm:p-6 max-w-6xl mx-auto space-y-6" aria-busy="true">
        <p className="sr-only" role="status">Loading your MedDecode dashboard...</p>
        <Skeleton className="h-36 w-full rounded-2xl" />
        <div className="grid gap-5 md:grid-cols-2">
          <Skeleton className="h-72 w-full rounded-2xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (dashboardQuery.error instanceof ApiError && dashboardQuery.error.status === 401) {
    return (
      <div className="md-page p-4 sm:p-6 max-w-5xl mx-auto">
        <Card className="text-center py-12">
          <h1 className="text-xl font-bold text-[var(--cc-text)]">Session required</h1>
          <p className="mt-2 text-sm text-[var(--cc-muted)]">Sign in again to load your account data.</p>
          <Link className="cc-button cc-button--primary mt-5" to="/sign-in">Sign In</Link>
        </Card>
      </div>
    );
  }

  const historyError = dashboardQuery.data?.historyError ?? (dashboardQuery.error ? serviceError(dashboardQuery.error) : null);
  const cabinetError = dashboardQuery.data?.cabinetError ?? null;
  const recentPrescriptions = (dashboardQuery.data?.history?.items ?? []).slice(0, 5);
  const cabinetItems = (dashboardQuery.data?.cabinet?.items ?? []).slice(0, 5);

  return (
    <div className="cc-home-page cc-home-page--continue md-home">
      {/* Welcome Hero Banner */}
      <section className="cc-home-welcome">
        <div className="cc-home-welcome-copy">
          <p className="cc-home-kicker">
            <span />
            <span className="md-home-kicker-label">YOUR WORKSPACE</span>
          </p>
          <h1>
            Welcome back, <span>{auth.user?.email ?? 'User'}.</span>
          </h1>
          <p>
            Upload prescription documents for structured OCR analysis, explore verified Indian gazette formulations, and organize your cabinet.
          </p>
        </div>
        <Link className="cc-home-profile-link" to="/upload-prescription" aria-label="Upload Prescription">
          <Icon name="inbox" className="size-4" />
          <span>Upload Prescription</span>
          <Icon name="arrow" className="size-4" />
        </Link>
      </section>

      {/* Main 2-Column Primary Grid */}
      <div className="cc-home-primary-grid cc-home-primary-grid--continue">
        {/* Prescriptions Column */}
        <section className="cc-home-continue is-primary" aria-labelledby="home-prescriptions-title">
          <div className="cc-home-section-heading">
            <div>
              <p className="cc-home-section-eyebrow">Your prescriptions</p>
              <h2 id="home-prescriptions-title">Recent Prescriptions</h2>
              <p>Prescription documents uploaded to your account.</p>
            </div>
            <Link to="/prescriptions" className="cc-home-section-link">
              View all <Icon name="arrow" className="size-4" />
            </Link>
          </div>

          {historyError ? (
            <div role="alert" className="p-4 rounded-xl border border-[var(--cc-danger)]/40 bg-[var(--cc-danger-soft)]/20 text-xs text-[var(--cc-danger)]">
              {historyError}
            </div>
          ) : recentPrescriptions.length ? (
            <div className="cc-home-continue-list">
              {recentPrescriptions.map((item: PrescriptionHistoryItem) => (
                <Link
                  key={item.id}
                  to={`/prescriptions/${item.id}`}
                  className="cc-home-continue-item cc-home-kind--marketplace"
                >
                  <span className="cc-home-item-icon">
                    <Icon name="inbox" className="size-5" />
                  </span>
                  <span className="cc-home-item-copy">
                    <strong>{item.prescription_date ? `Prescription Document (${formatDate(item.prescription_date)})` : `${item.file_type.replace('application/', '').replace('image/', '').toUpperCase()} Prescription`}</strong>
                    <small>
                      <span className="font-mono text-xs"><span className="text-[var(--cc-muted)] font-sans mr-1 select-none">Ref:</span><span>{item.id}</span></span> · {item.file_type.replace('application/', '').replace('image/', '').toUpperCase()} · {formatDate(item.created_at)}
                    </small>
                  </span>
                  <div className="flex items-center gap-2">
                    <PrescriptionStatusBadge status={item.status} />
                    <span className="cc-home-open-label">Open</span>
                    <Icon name="arrow" className="cc-home-row-arrow size-4" />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="inbox"
              title="No prescriptions available"
              description="Upload a document to start a prescription record."
              action={
                <Link className="cc-button cc-button--primary text-sm" to="/upload-prescription">
                  Upload Prescription
                </Link>
              }
            />
          )}
        </section>

        {/* Medicine Cabinet Column */}
        <section className="cc-home-continue md-home-reminders" aria-labelledby="home-cabinet-title">
          <div className="cc-home-section-heading">
            <div>
              <p className="cc-home-section-eyebrow">Your cabinet</p>
              <h2 id="home-cabinet-title">Medicine Cabinet</h2>
              <p>Active medications and dosage tracking records.</p>
            </div>
            <Link to="/my-cabinet" className="cc-home-section-link">
              Open cabinet <Icon name="arrow" className="size-4" />
            </Link>
          </div>

          {cabinetError ? (
            <div role="alert" className="p-4 rounded-xl border border-[var(--cc-danger)]/40 bg-[var(--cc-danger-soft)]/20 text-xs text-[var(--cc-danger)] space-y-2">
              <p>{cabinetError}</p>
              <div className="flex">
                <Button
                  variant="secondary"
                  className="text-xs h-7 px-2.5"
                  loading={dashboardQuery.isFetching}
                  onClick={() => void dashboardQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : cabinetItems.length ? (
            <div className="cc-home-continue-list">
              {cabinetItems.map((item) => (
                <Link
                  key={item.id}
                  to="/my-cabinet"
                  className="cc-home-continue-item cc-home-kind--service"
                >
                  <span className="cc-home-item-icon">
                    <Icon name="briefcase" className="size-5" />
                  </span>
                  <span className="cc-home-item-copy">
                    <strong>{item.usage_information ? item.usage_information : 'Medicine record'}</strong>
                    <small>
                      <span className="font-mono text-xs"><span className="text-[var(--cc-muted)] font-sans mr-1 select-none">Med ID:</span><span>{item.medicine_id}</span></span> · {item.quantity === null ? 'Quantity unavailable' : `Qty ${item.quantity}`}
                      {item.expiry_date ? ` · Exp: ${item.expiry_date}` : ''}
                    </small>
                  </span>
                  <span className="cc-home-open-label">View</span>
                  <Icon name="arrow" className="cc-home-row-arrow size-4" />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="briefcase"
              title="No cabinet records available"
              description="No active medications currently recorded for this account."
              action={
                <Link className="cc-button cc-button--secondary text-xs" to="/upload-prescription">
                  Upload Prescription
                </Link>
              }
            />
          )}
        </section>
      </div>

      {/* Start Something Quick Actions Grid */}
      <section className="cc-home-actions" aria-labelledby="home-actions-title">
        <div className="cc-home-section-heading">
          <div>
            <h2 id="home-actions-title">Start something</h2>
            <p>Explore, compare, organize, or review clinical resources.</p>
          </div>
        </div>
        <div className="cc-home-action-grid">
          <Link to="/upload-prescription" aria-label="Upload Prescription" className="cc-home-action-tile cc-home-kind--marketplace">
            <span className="cc-home-action-icon"><Icon name="inbox" className="size-5" /></span>
            <span className="cc-home-action-copy"><strong>Upload Prescription</strong><small>Process PDF, JPG, PNG files</small></span>
            <Icon name="arrow" className="cc-home-action-arrow size-4" />
          </Link>
          <Link to="/medicine-library" aria-label="Medicine Library" className="cc-home-action-tile cc-home-kind--teamup">
            <span className="cc-home-action-icon"><Icon name="search" className="size-5" /></span>
            <span className="cc-home-action-copy"><strong>Medicine Library</strong><small>4,802 gazette formulations</small></span>
            <Icon name="arrow" className="cc-home-action-arrow size-4" />
          </Link>
          <Link to="/compare-medicines" aria-label="Compare Medicines" className="cc-home-action-tile cc-home-kind--service">
            <span className="cc-home-action-icon"><Icon name="copy" className="size-5" /></span>
            <span className="cc-home-action-copy"><strong>Compare Formulations</strong><small>Side-by-side active ingredients</small></span>
            <Icon name="arrow" className="cc-home-action-arrow size-4" />
          </Link>
          <Link to="/my-cabinet" aria-label="My Cabinet" className="cc-home-action-tile cc-home-kind--marketplace">
            <span className="cc-home-action-icon"><Icon name="briefcase" className="size-5" /></span>
            <span className="cc-home-action-copy"><strong>Medicine Cabinet</strong><small>View tracked prescriptions</small></span>
            <Icon name="arrow" className="cc-home-action-arrow size-4" />
          </Link>
          <Link to="/reminders" aria-label="Reminders" className="cc-home-action-tile cc-home-kind--lost_found">
            <span className="cc-home-action-icon"><Icon name="calendar" className="size-5" /></span>
            <span className="cc-home-action-copy"><strong>Dosing Reminders</strong><small>Plan scheduled reminders</small></span>
            <Icon name="arrow" className="cc-home-action-arrow size-4" />
          </Link>
          <Link to="/learn-resources" aria-label="Learn & Resources" className="cc-home-action-tile cc-home-kind--teamup">
            <span className="cc-home-action-icon"><Icon name="sparkles" className="size-5" /></span>
            <span className="cc-home-action-copy"><strong>Learn &amp; Resources</strong><small>Regulatory evidence guides</small></span>
            <Icon name="arrow" className="cc-home-action-arrow size-4" />
          </Link>
        </div>
      </section>

      {/* Bottom Profile Prompt / Cabinet Summary */}
      <aside className="cc-home-profile-prompt" aria-labelledby="home-cabinet-aside-title">
        <span className="md-home-cabinet-count" aria-label={`${cabinetItems.length} cabinet entries`}>
          {cabinetItems.length.toString().padStart(2, '0')}
        </span>
        <div className="cc-home-profile-copy">
          <p className="cc-home-section-eyebrow">Your Cabinet</p>
          <h2 id="home-cabinet-aside-title">Keep your health workspace organized</h2>
          <p>Review and organize your prescription records and tracked medications.</p>
        </div>
        <Link className="cc-home-section-link" to="/my-cabinet">
          Open cabinet <Icon name="arrow" className="size-4" />
        </Link>
      </aside>

      {(historyError || cabinetError) ? (
        <div className="flex justify-end pt-2">
          <Button
            variant="secondary"
            loading={dashboardQuery.isFetching}
            onClick={() => void dashboardQuery.refetch()}
          >
            Retry dashboard data
          </Button>
        </div>
      ) : null}
    </div>
  );
}
