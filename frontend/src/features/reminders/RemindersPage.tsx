import { useEffect, useId, useRef, useState, type FormEvent, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Skeleton } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ApiError } from '../../services/api-client';
import { useAuth } from '../auth/AuthProvider';
import {
  createReminder,
  deleteReminder,
  fetchRecentDoseLogs,
  fetchReminders,
  logDose,
  updateReminder,
  type CreateReminderPayload,
  type DoseLog,
  type MedicationReminder,
  type ReminderRecurrence,
  type ReminderStatus,
} from './reminders-api';
import { fetchMedicineCabinet, type MedicineCabinetItem } from '../cabinet/medicine-cabinet-api';
import './reminders.css';

function formatDisplayTime(timeStr: string): string {
  if (!timeStr) return 'Time not set';
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  const hours = parseInt(parts[0]!, 10);
  const minutes = parseInt(parts[1]!, 10);
  if (isNaN(hours) || isNaN(minutes)) return timeStr;

  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  const displayMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${displayHours}:${displayMinutes} ${period}`;
}

function formatRelativeTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function recurrenceLabel(recurrence: ReminderRecurrence): string {
  switch (recurrence) {
    case 'daily':
      return 'Daily';
    case 'twice_daily':
      return 'Twice daily';
    case 'thrice_daily':
      return 'Thrice daily';
    case 'weekly':
      return 'Weekly';
    case 'as_needed':
      return 'As needed (PRN)';
    case 'once':
      return 'Single dose';
    case 'custom':
      return 'Custom schedule';
    default:
      return 'Scheduled';
  }
}

function ReminderDialog({
  title,
  subtitle,
  onClose,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  onClose: () => void;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pointerOutside = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { scrollX, scrollY } = window;
    const body = document.body;
    const saved = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      width: body.style.width,
    };
    const rootOverflow = document.documentElement.style.overflow;
    Object.assign(body.style, {
      overflow: 'hidden',
      position: 'fixed',
      top: `${-scrollY}px`,
      left: `${-scrollX}px`,
      width: '100%',
    });
    document.documentElement.style.overflow = 'hidden';

    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }

    dialog.querySelector<HTMLInputElement>('input, select, textarea')?.focus({ preventScroll: true });

    return () => {
      if (typeof dialog.close === 'function') {
        try {
          dialog.close();
        } catch {
          dialog.removeAttribute('open');
        }
      } else {
        dialog.removeAttribute('open');
      }
      Object.assign(body.style, saved);
      document.documentElement.style.overflow = rootOverflow;
      window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
    };
  }, []);

  const outside = (event: { currentTarget: HTMLDialogElement; clientX: number; clientY: number }) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    );
  };

  return createPortal(
    <dialog
      ref={ref}
      role="dialog"
      className="md-reminder-dialog cc-modal"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        pointerOutside.current = event.target === event.currentTarget && outside(event);
      }}
      onClick={(event) => {
        if (pointerOutside.current && event.target === event.currentTarget && outside(event)) {
          onClose();
        }
        pointerOutside.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ];
        if (controls.length === 0) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="md-reminder-dialog-head">
        <div>
          <h2 id={titleId} className="cc-section-title">
            {title}
          </h2>
          {subtitle ? <p className="text-xs text-[var(--cc-muted)] mt-1">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          className="cc-icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" className="size-5" />
        </button>
      </header>
      <div className="md-reminder-dialog-body">{children}</div>
    </dialog>,
    document.querySelector('.cc-app-shell') ?? document.body,
  );
}

export function RemindersPage() {
  const auth = useAuth();
  const token = auth.getAccessToken() ?? '';
  const queryClient = useQueryClient();

  const [editor, setEditor] = useState<{ kind: 'add' } | { kind: 'edit'; item: MedicationReminder } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MedicationReminder | null>(null);
  const [cabinetItems, setCabinetItems] = useState<readonly MedicineCabinetItem[]>([]);
  const [formMedicineName, setFormMedicineName] = useState('');
  const [formSelectedCabinetId, setFormSelectedCabinetId] = useState<string>('');
  const [formDosage, setFormDosage] = useState('');
  const [formTime, setFormTime] = useState('08:00');
  const [formExtraTimes, setFormExtraTimes] = useState<string[]>([]);
  const [formNewTimeInput, setFormNewTimeInput] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formRecurrence, setFormRecurrence] = useState<ReminderRecurrence>('daily');
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doseActionBusy, setDoseActionBusy] = useState<string | null>(null);
  const [recordedDoses, setRecordedDoses] = useState<readonly DoseLog[]>([]);
  const [notificationStatus, setNotificationStatus] = useState<'default' | 'granted' | 'denied' | 'unsupported'>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'unsupported';
  });

  async function requestBrowserNotifications() {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        setNotificationStatus(permission);
        if (permission === 'granted') {
          new Notification('MedDecode Medication Reminders', {
            body: 'Browser reminder notifications are now active.',
            icon: '/favicon.ico',
          });
        }
      } catch {
        setNotificationStatus('denied');
      }
    }
  }

  // Reminders Query
  const remindersQuery = useQuery({
    queryKey: ['medication-reminders', auth.user?.id],
    enabled: Boolean(token),
    queryFn: async () => {
      if (!token) throw new ApiError('An authenticated session is required.', 401);
      return fetchReminders(token);
    },
    retry: false,
  });

  // Recent Doses Query
  const recentDosesQuery = useQuery({
    queryKey: ['medication-recent-doses', auth.user?.id],
    enabled: Boolean(token),
    queryFn: async () => {
      if (!token) return [];
      try {
        return await fetchRecentDoseLogs(token, 10);
      } catch {
        return [];
      }
    },
    retry: false,
  });

  // Cabinet Items Query for prefill
  useEffect(() => {
    let active = true;
    async function loadCabinet() {
      if (!token) return;
      try {
        const res = await fetchMedicineCabinet(token);
        if (active) setCabinetItems(res.items);
      } catch {
        // Cabinet prefill is optional; ignore failure
      }
    }
    void loadCabinet();
    return () => {
      active = false;
    };
  }, [token]);

  function openAddModal() {
    setFormMedicineName('');
    setFormSelectedCabinetId('');
    setFormDosage('');
    setFormTime('08:00');
    setFormExtraTimes([]);
    setFormNewTimeInput('');
    setFormStartDate('');
    setFormEndDate('');
    setFormRecurrence('daily');
    setFormNotes('');
    setFormError(null);
    setEditor({ kind: 'add' });
  }

  function openEditModal(item: MedicationReminder) {
    setFormMedicineName(item.medicine_name);
    setFormSelectedCabinetId(item.medicine_id || '');
    setFormDosage(item.dosage ?? '');
    setFormTime(item.scheduled_time);
    setFormExtraTimes(item.scheduled_times ? item.scheduled_times.filter((t) => t !== item.scheduled_time) : []);
    setFormNewTimeInput('');
    setFormStartDate(item.start_date || '');
    setFormEndDate(item.end_date || '');
    setFormRecurrence(item.recurrence);
    setFormNotes(item.notes ?? '');
    setFormError(null);
    setEditor({ kind: 'edit', item });
  }

  function handleAddExtraTime() {
    if (!formNewTimeInput) return;
    if (!formExtraTimes.includes(formNewTimeInput) && formNewTimeInput !== formTime) {
      setFormExtraTimes([...formExtraTimes, formNewTimeInput]);
    }
    setFormNewTimeInput('');
  }

  function handleRemoveExtraTime(timeToRemove: string) {
    setFormExtraTimes(formExtraTimes.filter((t) => t !== timeToRemove));
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!token || busy) return;
    const trimmedName = formMedicineName.trim();
    if (!trimmedName) {
      setFormError('Please enter a medicine name or schedule label.');
      return;
    }
    if (!formTime) {
      setFormError('Please select a scheduled dosing time.');
      return;
    }

    setBusy(true);
    setFormError(null);

    const allTimes = [formTime, ...formExtraTimes];

    try {
      if (editor?.kind === 'add') {
        const payload: CreateReminderPayload = {
          medicine_name: trimmedName,
          medicine_id: formSelectedCabinetId || null,
          dosage: formDosage.trim() || null,
          scheduled_time: formTime,
          scheduled_times: allTimes.length > 1 ? allTimes : undefined,
          start_date: formStartDate || null,
          end_date: formEndDate || null,
          recurrence: formRecurrence,
          notes: formNotes.trim() || null,
        };
        await createReminder(payload, token);
      } else if (editor?.kind === 'edit') {
        await updateReminder(
          editor.item.id,
          {
            medicine_name: trimmedName,
            medicine_id: formSelectedCabinetId || null,
            dosage: formDosage.trim() || null,
            scheduled_time: formTime,
            scheduled_times: allTimes.length > 1 ? allTimes : null,
            start_date: formStartDate || null,
            end_date: formEndDate || null,
            recurrence: formRecurrence,
            notes: formNotes.trim() || null,
          },
          token,
        );
      }

      setEditor(null);
      await queryClient.invalidateQueries({ queryKey: ['medication-reminders'] });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 404 || err.status === 501 || err.status === 503) {
          setFormError('The medication reminder service is not yet deployed on this backend deployment (HTTP ' + err.status + ').');
        } else if (err.status === 400) {
          setFormError('Invalid reminder schedule parameters. Please check your inputs.');
        } else {
          setFormError('Failed to save reminder: ' + err.message);
        }
      } else {
        setFormError('Unable to connect to the reminder service. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleStatus(item: MedicationReminder) {
    if (!token || busy) return;
    setBusy(true);
    const nextStatus: ReminderStatus = item.status === 'active' ? 'paused' : 'active';
    try {
      await updateReminder(item.id, { status: nextStatus }, token);
      await queryClient.invalidateQueries({ queryKey: ['medication-reminders'] });
    } catch {
      void remindersQuery.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function handleLogDose(item: MedicationReminder, status: 'taken' | 'skipped') {
    if (!token || doseActionBusy) return;
    setDoseActionBusy(item.id);
    try {
      const result = await logDose(item.id, { status }, token);
      setRecordedDoses(current => [result.dose, ...current.filter(dose => dose.id !== result.dose.id)].slice(0, 10));
      queryClient.setQueryData<readonly DoseLog[]>(
        ['medication-recent-doses', auth.user?.id],
        (current = []) => [result.dose, ...current.filter((dose) => dose.id !== result.dose.id)].slice(0, 10),
      );
      await remindersQuery.refetch();
      void recentDosesQuery.refetch();
    } catch {
      void remindersQuery.refetch();
    } finally {
      setDoseActionBusy(null);
    }
  }

  async function handleDeleteConfirm() {
    if (!token || !deleteTarget || busy) return;
    setBusy(true);
    try {
      await deleteReminder(deleteTarget.id, token);
      setDeleteTarget(null);
      await Promise.all([remindersQuery.refetch(), recentDosesQuery.refetch()]);
    } catch {
      void remindersQuery.refetch();
    } finally {
      setBusy(false);
    }
  }

  const queryError = remindersQuery.error;
  const isBackendUnavailable =
    queryError instanceof ApiError &&
    (queryError.status === 404 || queryError.status === 501 || queryError.status === 503);
  const isAuthError =
    !token || (queryError instanceof ApiError && (queryError.status === 401 || queryError.status === 403));
  const isGenericError = Boolean(queryError && !isBackendUnavailable && !isAuthError);

  const reminders = remindersQuery.data?.items ?? [];
  const recentDoses: readonly DoseLog[] = [
    ...recordedDoses,
    ...(recentDosesQuery.data ?? []).filter(dose => !recordedDoses.some(recorded => recorded.id === dose.id)),
  ].slice(0, 10);

  const todayReminders = reminders.filter(
    (r) => r.recurrence === 'daily' || r.recurrence === 'twice_daily' || r.recurrence === 'thrice_daily',
  );
  const upcomingReminders = reminders.filter(
    (r) => r.recurrence !== 'daily' && r.recurrence !== 'twice_daily' && r.recurrence !== 'thrice_daily',
  );

  return (
    <div className="md-page md-reminders">
      {/* Page Header */}
      <header className="md-reminders-header">
        <div>
          <h1 className="cc-page-title">Medication Reminders</h1>
          <p>Track scheduled medication dosages, adherence routines, and timing.</p>
        </div>
        <div className="md-reminders-header-actions">
          <Button
            icon="plus"
            disabled={isBackendUnavailable || busy}
            title={isBackendUnavailable ? 'Reminder scheduling is currently unavailable' : 'Add reminder'}
            aria-label="Add reminder"
            onClick={openAddModal}
            className="md-reminders-add-btn shrink-0"
          >
            Add Reminder
          </Button>
        </div>
      </header>

      {/* Browser Notification Bar */}
      {notificationStatus === 'default' && (
        <aside className="md-reminders-notifications-bar" role="region" aria-label="Notification settings">
          <div className="md-reminders-notifications-info">
            <Icon name="bell" className="size-4 text-[var(--cc-primary)] shrink-0" />
            <span>Enable in-browser reminders to receive alerts while MedDecode is open.</span>
          </div>
          <Button
            variant="secondary"
            onClick={requestBrowserNotifications}
            className="text-xs shrink-0 self-start sm:self-center"
          >
            Enable Browser Alerts
          </Button>
        </aside>
      )}

      {/* Backend Status / Error Notification */}
      {isBackendUnavailable ? (
        <section className="md-reminders-alert is-unavailable" role="status" aria-label="Backend service status">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex items-center justify-center size-9 rounded-lg bg-[var(--cc-warning-soft)] text-[var(--cc-warning)] shrink-0 mt-0.5">
                <Icon name="clock" className="size-4" />
              </span>
              <div className="space-y-1">
                <h2 className="text-sm sm:text-base font-semibold text-[var(--cc-text)]">
                  Medication reminders are temporarily unavailable
                </h2>
                <p className="text-xs sm:text-sm text-[var(--cc-muted)] leading-relaxed">
                  Reminder scheduling is not available right now. Your existing medicines and prescriptions are unaffected.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-center">
              <Button
                variant="secondary"
                icon="arrow"
                loading={remindersQuery.isFetching}
                onClick={() => void remindersQuery.refetch()}
                className="text-xs shrink-0"
                aria-label="Retry loading reminders"
              >
                Retry
              </Button>
              <Link
                to="/my-cabinet"
                className="cc-button cc-button--secondary text-xs inline-flex items-center gap-1.5 shrink-0"
              >
                <Icon name="briefcase" className="size-3.5" />
                <span>View My Cabinet</span>
              </Link>
            </div>
          </div>
        </section>
      ) : isAuthError ? (
        <section className="md-reminders-alert is-error" role="alert">
          <div className="flex items-start gap-3">
            <Icon name="warning" className="size-5 text-[var(--cc-danger)] shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-[var(--cc-danger)]">Authentication Required</h2>
              <p className="mt-1 text-sm text-[var(--cc-text-soft)]">
                Your session is unauthenticated or expired. Please sign in to view your medication reminders.
              </p>
              <div className="mt-3">
                <Link className="cc-button cc-button--primary text-xs" to="/sign-in">
                  Sign In
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : isGenericError ? (
        <section className="md-reminders-alert is-error" role="alert">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex items-center justify-center size-9 rounded-lg bg-[var(--cc-danger-soft)] text-[var(--cc-danger)] shrink-0 mt-0.5">
                <Icon name="warning" className="size-4" />
              </span>
              <div className="space-y-1">
                <h2 className="text-sm sm:text-base font-semibold text-[var(--cc-danger)]">
                  Reminders are temporarily unavailable
                </h2>
                <p className="text-xs sm:text-sm text-[var(--cc-danger)]/90 leading-relaxed">
                  Could not connect to the reminders service. Check your connection or try again.
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              icon="arrow"
              loading={remindersQuery.isFetching}
              onClick={() => void remindersQuery.refetch()}
              className="text-xs shrink-0 self-start sm:self-center"
              aria-label="Retry loading reminders"
            >
              Retry
            </Button>
          </div>
        </section>
      ) : null}

      {/* Visual balance informative card when service is unavailable */}
      {isBackendUnavailable ? (
        <div className="md-reminders-unavailable-helper text-center py-10 px-4 rounded-2xl border border-[var(--cc-border)]/60 bg-[var(--cc-panel)]/40 max-w-xl mx-auto space-y-3 mt-4">
          <span className="inline-flex items-center justify-center size-12 rounded-full bg-[var(--cc-primary)]/10 text-[var(--cc-primary)] mx-auto">
            <Icon name="calendar" className="size-6" />
          </span>
          <h3 className="text-base font-semibold text-[var(--cc-text)]">Scheduled Dosing &amp; Regimen Tracking</h3>
          <p className="text-xs sm:text-sm text-[var(--cc-muted)] max-w-md mx-auto leading-relaxed">
            Once reminders are active on your account, you will be able to configure daily intake routines, recurring dosage intervals, and refill reminders.
          </p>
          <div className="pt-2 flex flex-wrap justify-center gap-3">
            <Link to="/my-cabinet" className="cc-button cc-button--primary text-xs inline-flex items-center gap-1.5">
              <Icon name="briefcase" className="size-3.5" />
              <span>Explore Medicine Cabinet</span>
            </Link>
            <Link to="/upload-prescription" className="cc-button cc-button--secondary text-xs inline-flex items-center gap-1.5">
              <Icon name="inbox" className="size-3.5" />
              <span>Upload Prescription</span>
            </Link>
          </div>
        </div>
      ) : null}

      {/* Loading Skeletons */}
      {remindersQuery.isLoading ? (
        <div className="md-reminders-layout" aria-busy="true">
          <div className="md-reminders-section">
            <Skeleton className="h-7 w-40 rounded-md" />
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
          <div className="md-reminders-section">
            <Skeleton className="h-7 w-40 rounded-md" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        </div>
      ) : reminders.length === 0 && !isBackendUnavailable ? (
        /* Empty State */
        <Card className="border-[var(--cc-border)] p-8">
          <EmptyState
            icon="calendar"
            title="No reminders scheduled yet"
            description="Schedule daily or periodic dosing reminders to stay consistent with your prescribed medication regimen."
            action={
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button icon="plus" onClick={openAddModal}>Add first reminder</Button>
                <Link className="cc-button cc-button--secondary text-xs" to="/my-cabinet">
                  View Medicine Cabinet
                </Link>
                <Link className="cc-button cc-button--ghost text-xs" to="/upload-prescription">
                  Upload Prescription
                </Link>
              </div>
            }
          />
        </Card>
      ) : reminders.length > 0 ? (
        /* Active Reminders Display */
        <div className="space-y-8">
          <div className="md-reminders-layout">
            {/* Today's Reminders Column */}
            <section className="md-reminders-section" aria-labelledby="today-reminders-title">
              <div className="md-reminders-section-head">
                <h2 id="today-reminders-title">Today's Schedule</h2>
                <p>{todayReminders.length} reminder{todayReminders.length === 1 ? '' : 's'}</p>
              </div>

              {todayReminders.length === 0 ? (
                <p className="text-sm text-[var(--cc-muted)] italic py-4">No daily dosing reminders scheduled for today.</p>
              ) : (
                <div className="md-reminders-list">
                  {todayReminders.map((item) => (
                    <article
                      key={item.id}
                      className={`md-reminder-card ${item.status === 'paused' ? 'is-paused' : ''}`}
                      aria-label={`${item.medicine_name} at ${formatDisplayTime(item.scheduled_time)}`}
                    >
                      <div className="md-reminder-card-main">
                        <div className="md-reminder-card-body">
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span className="md-reminder-time-badge">
                              <Icon name="clock" className="size-3.5" />
                              {formatDisplayTime(item.scheduled_time)}
                            </span>
                            {item.scheduled_times && item.scheduled_times.length > 1 ? (
                              <div className="md-reminder-times-group">
                                {item.scheduled_times
                                  .filter((t) => t !== item.scheduled_time)
                                  .map((t) => (
                                    <span key={t} className="md-reminder-time-sub">
                                      {formatDisplayTime(t)}
                                    </span>
                                  ))}
                              </div>
                            ) : null}
                            <Badge tone={item.status === 'active' ? 'info' : 'neutral'}>
                              {item.status === 'active' ? 'Active' : 'Paused'}
                            </Badge>
                            <Badge tone="neutral">{recurrenceLabel(item.recurrence)}</Badge>
                          </div>
                          <h3 className="md-reminder-card-title">{item.medicine_name}</h3>
                          <div className="md-reminder-card-meta">
                            <span className="md-reminder-card-dosage">
                              {item.dosage || 'Dosage not specified'}
                            </span>
                          </div>
                          {item.last_taken_at ? (
                            <div className="md-reminder-last-taken">
                              <Icon name="check" className="size-3.5" />
                              <span>Last taken {formatRelativeTime(item.last_taken_at)}</span>
                            </div>
                          ) : null}
                          {item.notes ? (
                            <p className="md-reminder-card-notes">“{item.notes}”</p>
                          ) : null}
                        </div>
                      </div>

                      <div className="md-reminder-card-actions">
                        {item.status === 'active' ? (
                          <div className="md-reminder-dose-actions">
                            <Button
                              variant="primary"
                              onClick={() => handleLogDose(item, 'taken')}
                              loading={doseActionBusy === item.id}
                              aria-label={`Mark dose taken for ${item.medicine_name}`}
                              className="md-btn-take-dose"
                            >
                              Take Dose
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => handleLogDose(item, 'skipped')}
                              loading={doseActionBusy === item.id}
                              aria-label={`Mark dose skipped for ${item.medicine_name}`}
                              className="md-btn-skip-dose"
                            >
                              Skip
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--cc-muted)] italic">Schedule paused</span>
                        )}

                        <div className="md-reminder-mgmt-actions">
                          <Button
                            variant="secondary"
                            onClick={() => handleToggleStatus(item)}
                            aria-label={`${item.status === 'active' ? 'Pause' : 'Resume'} reminder for ${item.medicine_name}`}
                            className="text-xs h-7 px-2.5"
                          >
                            {item.status === 'active' ? 'Pause' : 'Resume'}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => openEditModal(item)}
                            aria-label={`Edit reminder for ${item.medicine_name}`}
                            className="text-xs h-7 px-2.5"
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setDeleteTarget(item)}
                            aria-label={`Delete reminder for ${item.medicine_name}`}
                            className="text-xs h-7 px-2.5 text-[var(--cc-danger)] hover:bg-[var(--cc-danger-soft)]/20"
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* Upcoming & Periodic Reminders Column */}
            <section className="md-reminders-section" aria-labelledby="upcoming-reminders-title">
              <div className="md-reminders-section-head">
                <h2 id="upcoming-reminders-title">Upcoming &amp; Periodic</h2>
                <p>{upcomingReminders.length} reminder{upcomingReminders.length === 1 ? '' : 's'}</p>
              </div>

              {upcomingReminders.length === 0 ? (
                <p className="text-sm text-[var(--cc-muted)] italic py-4">No weekly or as-needed reminders scheduled.</p>
              ) : (
                <div className="md-reminders-list">
                  {upcomingReminders.map((item) => (
                    <article
                      key={item.id}
                      className={`md-reminder-card ${item.status === 'paused' ? 'is-paused' : ''}`}
                      aria-label={`${item.medicine_name} ${recurrenceLabel(item.recurrence)}`}
                    >
                      <div className="md-reminder-card-main">
                        <div className="md-reminder-card-body">
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span className="md-reminder-time-badge">
                              <Icon name="clock" className="size-3.5" />
                              {formatDisplayTime(item.scheduled_time)}
                            </span>
                            <Badge tone={item.status === 'active' ? 'info' : 'neutral'}>
                              {item.status === 'active' ? 'Active' : 'Paused'}
                            </Badge>
                            <Badge tone="neutral">{recurrenceLabel(item.recurrence)}</Badge>
                          </div>
                          <h3 className="md-reminder-card-title">{item.medicine_name}</h3>
                          <div className="md-reminder-card-meta">
                            <span className="md-reminder-card-dosage">
                              {item.dosage || 'Dosage not specified'}
                            </span>
                          </div>
                          {item.last_taken_at ? (
                            <div className="md-reminder-last-taken">
                              <Icon name="check" className="size-3.5" />
                              <span>Last taken {formatRelativeTime(item.last_taken_at)}</span>
                            </div>
                          ) : null}
                          {item.notes ? (
                            <p className="md-reminder-card-notes">“{item.notes}”</p>
                          ) : null}
                        </div>
                      </div>

                      <div className="md-reminder-card-actions">
                        {item.status === 'active' ? (
                          <div className="md-reminder-dose-actions">
                            <Button
                              variant="primary"
                              onClick={() => handleLogDose(item, 'taken')}
                              loading={doseActionBusy === item.id}
                              aria-label={`Mark dose taken for ${item.medicine_name}`}
                              className="md-btn-take-dose"
                            >
                              Take Dose
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => handleLogDose(item, 'skipped')}
                              loading={doseActionBusy === item.id}
                              aria-label={`Mark dose skipped for ${item.medicine_name}`}
                              className="md-btn-skip-dose"
                            >
                              Skip
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--cc-muted)] italic">Schedule paused</span>
                        )}

                        <div className="md-reminder-mgmt-actions">
                          <Button
                            variant="secondary"
                            onClick={() => handleToggleStatus(item)}
                            aria-label={`${item.status === 'active' ? 'Pause' : 'Resume'} reminder for ${item.medicine_name}`}
                            className="text-xs h-7 px-2.5"
                          >
                            {item.status === 'active' ? 'Pause' : 'Resume'}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => openEditModal(item)}
                            aria-label={`Edit reminder for ${item.medicine_name}`}
                            className="text-xs h-7 px-2.5"
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setDeleteTarget(item)}
                            aria-label={`Delete reminder for ${item.medicine_name}`}
                            className="text-xs h-7 px-2.5 text-[var(--cc-danger)] hover:bg-[var(--cc-danger-soft)]/20"
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Recent Dose Activity Section */}
          {recentDoses.length > 0 ? (
            <section className="md-reminders-activity-section" aria-labelledby="activity-section-title">
              <div className="md-reminders-section-head">
                <h2 id="activity-section-title">Recent Dose Activity</h2>
                <p>Recorded adherence events</p>
              </div>
              <div className="md-reminders-activity-list">
                {recentDoses.map((dose) => (
                  <div key={dose.id} className="md-reminders-activity-item">
                    <div className="md-reminders-activity-lead">
                      <span
                        className={`size-2.5 rounded-full ${
                          dose.status === 'taken' ? 'bg-[var(--cc-success,#10b981)]' : 'bg-[var(--cc-warning,#f59e0b)]'
                        }`}
                      />
                      <span className="font-semibold text-[var(--cc-text)]">
                        {dose.medicine_name || 'Scheduled Medicine'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone={dose.status === 'taken' ? 'success' : 'neutral'}>
                        {dose.status === 'taken' ? 'Taken' : 'Skipped'}
                      </Badge>
                      <span className="text-xs text-[var(--cc-muted)] tabular-nums">
                        {formatRelativeTime(dose.dose_time || dose.logged_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {/* Add / Edit Dialog */}
      {editor && (
        <ReminderDialog
          title={editor.kind === 'add' ? 'Add Medication Reminder' : 'Edit Reminder'}
          subtitle="Configure dosage timing, recurrence, and schedule."
          onClose={() => setEditor(null)}
        >
          <form onSubmit={handleSave} className="md-reminder-form">
            {/* Quick Prefill from Medicine Cabinet if items exist */}
            {cabinetItems.length > 0 && editor.kind === 'add' ? (
              <div className="p-2.5 rounded-lg bg-[var(--cc-panel-muted)] border border-[var(--cc-border)] text-xs space-y-1.5">
                <span className="font-semibold text-[var(--cc-text)]">Prefill from Medicine Cabinet:</span>
                <div className="flex flex-wrap gap-1.5">
                  {cabinetItems.slice(0, 4).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="px-2 py-0.5 rounded border border-[var(--cc-border)] bg-[var(--cc-panel)] hover:border-[var(--cc-primary)] text-[var(--cc-text)] text-[11px] transition-colors"
                      onClick={() => {
                        setFormSelectedCabinetId(c.id);
                        setFormMedicineName(c.usage_information || `Cabinet Medicine (${c.medicine_id.slice(0, 8)})`);
                        if (c.usage_information) setFormDosage(c.usage_information);
                      }}
                    >
                      {c.usage_information ? c.usage_information.slice(0, 24) : `Med ${c.medicine_id.slice(0, 6)}`}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <label>
              <span>Medicine Name or Schedule Label *</span>
              <input
                type="text"
                required
                maxLength={120}
                placeholder="e.g. Paracetamol 500mg, Morning Blood Pressure"
                value={formMedicineName}
                onChange={(e) => setFormMedicineName(e.target.value)}
              />
            </label>

            <label>
              <span>Dosage Instructions (optional)</span>
              <input
                type="text"
                maxLength={100}
                placeholder="e.g. 1 Tablet after breakfast"
                value={formDosage}
                onChange={(e) => setFormDosage(e.target.value)}
              />
            </label>

            <div className="md-reminder-form-grid">
              <label>
                <span>Primary Scheduled Time *</span>
                <input
                  type="time"
                  required
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                />
              </label>

              <label>
                <span>Recurrence Frequency *</span>
                <select
                  value={formRecurrence}
                  onChange={(e) => setFormRecurrence(e.target.value as ReminderRecurrence)}
                >
                  <option value="daily">Daily</option>
                  <option value="twice_daily">Twice daily</option>
                  <option value="thrice_daily">Thrice daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="as_needed">As needed (PRN)</option>
                  <option value="once">Single dose</option>
                  <option value="custom">Custom schedule</option>
                </select>
              </label>
            </div>

            {/* Additional Daily Times */}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-[var(--cc-text)]">Additional Daily Times (optional)</span>
              <div className="flex gap-2">
                <input
                  type="time"
                  value={formNewTimeInput}
                  onChange={(e) => setFormNewTimeInput(e.target.value)}
                  className="max-w-[140px]"
                />
                <Button
                  variant="secondary"
                  type="button"
                  onClick={handleAddExtraTime}
                  disabled={!formNewTimeInput}
                  className="text-xs"
                >
                  Add Time
                </Button>
              </div>
              {formExtraTimes.length > 0 ? (
                <div className="md-reminder-time-chips">
                  {formExtraTimes.map((t) => (
                    <span key={t} className="md-reminder-time-chip">
                      <span>{formatDisplayTime(t)}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveExtraTime(t)}
                        className="text-[var(--cc-muted)] hover:text-[var(--cc-danger)] ml-0.5"
                        aria-label={`Remove time ${t}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Schedule Range (Optional Start and End Dates) */}
            <div className="md-reminder-form-grid">
              <label>
                <span>Start Date (optional)</span>
                <input
                  type="date"
                  value={formStartDate}
                  onChange={(e) => setFormStartDate(e.target.value)}
                />
              </label>

              <label>
                <span>End Date (optional)</span>
                <input
                  type="date"
                  value={formEndDate}
                  onChange={(e) => setFormEndDate(e.target.value)}
                />
              </label>
            </div>

            <label>
              <span>Notes (optional)</span>
              <textarea
                rows={2}
                maxLength={250}
                placeholder="Special instructions, food interactions, or reminders"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </label>

            {formError ? (
              <div role="alert" className="p-3 rounded-lg border border-[var(--cc-danger)]/40 bg-[var(--cc-danger-soft)]/20 text-xs text-[var(--cc-danger)]">
                {formError}
              </div>
            ) : null}

            <div className="md-reminder-form-actions">
              <Button variant="secondary" onClick={() => setEditor(null)} type="button">
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                {editor.kind === 'add' ? 'Save reminder' : 'Update reminder'}
              </Button>
            </div>
          </form>
        </ReminderDialog>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <ReminderDialog
          title="Delete Reminder?"
          subtitle={`Are you sure you want to delete the reminder for ${deleteTarget.medicine_name}?`}
          onClose={() => setDeleteTarget(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--cc-muted)]">
              This will permanently remove the dosing schedule from your account. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={busy}
                onClick={handleDeleteConfirm}
                className="bg-[var(--cc-danger)] hover:bg-[var(--cc-danger)]/90 text-white"
              >
                Confirm deletion
              </Button>
            </div>
          </div>
        </ReminderDialog>
      )}
    </div>
  );
}
