import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, Card, Skeleton } from '../../components/ui';
import { Icon } from '../../components/Icon';

type ScheduleType = 'daily' | 'twice_daily' | 'short_course' | 'completed' | 'none';
type ReminderScheduleType = 'daily' | 'twice_daily' | 'short_course';
type DoseHistoryStatus = 'taken' | 'skipped';

interface CatalogueRecordFixture {
  readonly source_record_id: string;
  readonly canonical_name: string;
  readonly ingredient_name: string;
  readonly strength_value: string;
  readonly strength_unit: string;
  readonly dosage_form: string;
}

interface CabinetFixture {
  readonly id: string;
  readonly catalogue_record_id: string;
  readonly status: 'active' | 'completed';
  readonly schedule_type: ScheduleType;
  readonly schedule_text: string;
  readonly added_at: string;
  readonly completed_at: string | null;
  readonly reminder_id: string | null;
}

interface DoseHistoryFixture {
  readonly date: string;
  readonly time: string;
  readonly status: DoseHistoryStatus;
}

interface ReminderFixture {
  readonly id: string;
  readonly cabinet_id: string;
  readonly title: string;
  readonly schedule_type: ReminderScheduleType;
  readonly scheduled_times: readonly string[];
  readonly ends_at: string;
  readonly enabled: boolean;
  readonly history: readonly DoseHistoryFixture[];
}

interface PhaseD1Fixtures {
  readonly schema_version: 'phase-d1-demo.v1';
  readonly demo_only: true;
  readonly notice: string;
  readonly provenance: {
    readonly source_dataset: string;
    readonly source_release: string;
    readonly source_authority: string;
    readonly source_url: string;
    readonly local_export: string;
    readonly record_id_semantics: string;
  };
  readonly catalogue_records: readonly CatalogueRecordFixture[];
  readonly cabinet: readonly CabinetFixture[];
  readonly reminders: readonly ReminderFixture[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isScheduleType(value: unknown): value is ScheduleType {
  return value === 'daily'
    || value === 'twice_daily'
    || value === 'short_course'
    || value === 'completed'
    || value === 'none';
}

function parseFixtures(value: unknown): PhaseD1Fixtures | null {
  if (!isObject(value) || value.schema_version !== 'phase-d1-demo.v1' || value.demo_only !== true) return null;
  if (
    !isObject(value.provenance)
    || !isString(value.notice)
    || !isString(value.provenance.source_dataset)
    || !isString(value.provenance.source_release)
    || !isString(value.provenance.source_authority)
    || !isString(value.provenance.source_url)
    || !isString(value.provenance.local_export)
    || !isString(value.provenance.record_id_semantics)
    || !Array.isArray(value.catalogue_records)
    || !Array.isArray(value.cabinet)
    || !Array.isArray(value.reminders)
  ) return null;

  const catalogueRecords: CatalogueRecordFixture[] = [];
  for (const raw of value.catalogue_records) {
    if (
      !isObject(raw)
      || !isString(raw.source_record_id)
      || !isString(raw.canonical_name)
      || !isString(raw.ingredient_name)
      || !isString(raw.strength_value)
      || !isString(raw.strength_unit)
      || !isString(raw.dosage_form)
    ) return null;
    catalogueRecords.push({
      source_record_id: raw.source_record_id,
      canonical_name: raw.canonical_name,
      ingredient_name: raw.ingredient_name,
      strength_value: raw.strength_value,
      strength_unit: raw.strength_unit,
      dosage_form: raw.dosage_form,
    });
  }

  const cabinet: CabinetFixture[] = [];
  for (const raw of value.cabinet) {
    if (
      !isObject(raw)
      || !isString(raw.id)
      || !isString(raw.catalogue_record_id)
      || (raw.status !== 'active' && raw.status !== 'completed')
      || !isScheduleType(raw.schedule_type)
      || !isString(raw.schedule_text)
      || !isString(raw.added_at)
      || (raw.completed_at !== null && !isString(raw.completed_at))
      || (raw.reminder_id !== null && !isString(raw.reminder_id))
    ) return null;
    cabinet.push({
      id: raw.id,
      catalogue_record_id: raw.catalogue_record_id,
      status: raw.status,
      schedule_type: raw.schedule_type,
      schedule_text: raw.schedule_text,
      added_at: raw.added_at,
      completed_at: raw.completed_at,
      reminder_id: raw.reminder_id,
    });
  }

  const reminders: ReminderFixture[] = [];
  for (const raw of value.reminders) {
    if (
      !isObject(raw)
      || !isString(raw.id)
      || !isString(raw.cabinet_id)
      || !isString(raw.title)
      || (raw.schedule_type !== 'daily' && raw.schedule_type !== 'twice_daily' && raw.schedule_type !== 'short_course')
      || !Array.isArray(raw.scheduled_times)
      || !raw.scheduled_times.every(isString)
      || !isString(raw.ends_at)
      || typeof raw.enabled !== 'boolean'
      || !Array.isArray(raw.history)
    ) return null;
    const history: DoseHistoryFixture[] = [];
    for (const item of raw.history) {
      if (
        !isObject(item)
        || !isString(item.date)
        || !isString(item.time)
        || (item.status !== 'taken' && item.status !== 'skipped')
      ) return null;
      history.push({ date: item.date, time: item.time, status: item.status });
    }
    reminders.push({
      id: raw.id,
      cabinet_id: raw.cabinet_id,
      title: raw.title,
      schedule_type: raw.schedule_type,
      scheduled_times: raw.scheduled_times,
      ends_at: raw.ends_at,
      enabled: raw.enabled,
      history,
    });
  }

  const recordIds = new Set(catalogueRecords.map((record) => record.source_record_id));
  const cabinetIds = new Set(cabinet.map((item) => item.id));
  const reminderIds = new Set(reminders.map((item) => item.id));
  if (
    recordIds.size !== catalogueRecords.length
    || cabinetIds.size !== cabinet.length
    || reminderIds.size !== reminders.length
    || cabinet.some((item) => !recordIds.has(item.catalogue_record_id) || (item.reminder_id !== null && !reminderIds.has(item.reminder_id)))
    || reminders.some((item) => !cabinetIds.has(item.cabinet_id))
  ) return null;

  return {
    schema_version: 'phase-d1-demo.v1',
    demo_only: true,
    notice: value.notice,
    provenance: {
      source_dataset: value.provenance.source_dataset,
      source_release: value.provenance.source_release,
      source_authority: value.provenance.source_authority,
      source_url: value.provenance.source_url,
      local_export: value.provenance.local_export,
      record_id_semantics: value.provenance.record_id_semantics,
    },
    catalogue_records: catalogueRecords,
    cabinet,
    reminders,
  };
}

function scheduleLabel(scheduleType: ScheduleType): string {
  switch (scheduleType) {
    case 'daily': return 'Daily';
    case 'twice_daily': return 'Twice daily';
    case 'short_course': return 'Short course';
    case 'completed': return 'Completed';
    case 'none': return 'No reminder';
  }
}

export function PhaseD1DemoPage() {
  const [fixtures, setFixtures] = useState<PhaseD1Fixtures | null>(null);
  const [reminders, setReminders] = useState<ReminderFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const recordById = useMemo(
    () => new Map((fixtures?.catalogue_records ?? []).map((record) => [record.source_record_id, record])),
    [fixtures],
  );
  const reminderById = useMemo(() => new Map(reminders.map((reminder) => [reminder.id, reminder])), [reminders]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadFixtures() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/demo/phase-d1/fixtures.json', { signal: controller.signal });
        if (!response.ok) throw new Error(`Fixture request failed with status ${response.status}.`);
        const parsed = parseFixtures(await response.json());
        if (!parsed) throw new Error('The local Phase D.1 fixture file did not match its schema.');
        if (controller.signal.aborted) return;
        setFixtures(parsed);
        setReminders(parsed.reminders.map((reminder) => ({ ...reminder, scheduled_times: [...reminder.scheduled_times] })));
      } catch (cause: unknown) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'The local demo fixtures could not be loaded.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadFixtures();
    return () => controller.abort();
  }, [retry]);

  function saveSchedule(event: FormEvent<HTMLFormElement>, reminder: ReminderFixture) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const firstTime = String(formData.get('firstTime') ?? '');
    const secondTime = String(formData.get('secondTime') ?? '');
    const times = reminder.schedule_type === 'twice_daily' ? [firstTime, secondTime] : [firstTime];
    if (times.some((time) => !/^\d{2}:\d{2}$/.test(time))) {
      setFormError('Enter a valid time for each displayed schedule field.');
      return;
    }
    setReminders((current) => current.map((item) =>
      item.id === reminder.id ? { ...item, scheduled_times: times } : item,
    ));
    setEditingId(null);
    setFormError(null);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-primary)]">Phase D.1 · Local-only</p>
          <h2 className="mt-1 text-2xl font-bold text-[var(--cc-text)]">Source-backed demo preview</h2>
          <p className="mt-2 max-w-3xl text-sm text-[var(--cc-muted)]">
            Official NLEM 2022 source attributes are paired with entirely synthetic person, schedule, reminder, and history fixtures.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="cc-button cc-button--secondary" href="/demo/phase-d1/sample-prescription.pdf" download>
            Download sample PDF
          </a>
          <a className="cc-button cc-button--secondary" href="/demo/phase-d1/expected-output.json" download>
            Expected OCR JSON
          </a>
        </div>
      </header>

      <section role="note" className="rounded-xl border border-[var(--cc-warning)]/40 bg-[var(--cc-warning-soft)]/20 p-4 text-sm text-[var(--cc-text-soft)]">
        <div className="flex items-start gap-3">
          <Icon name="shield" className="size-5 shrink-0 text-[var(--cc-warning)]" />
          <p>
            <strong>Not medical advice or a valid prescription.</strong> The PDF contains no dosage instructions. Reminder times and taken/skipped events are fictional preview data. This page makes no authenticated API calls, sends no notifications, and resets local edits when refreshed.
          </p>
        </div>
      </section>

      {loading ? (
        <section className="grid gap-3" role="status" aria-busy="true">
          <span className="sr-only">Loading local Phase D.1 fixtures</span>
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </section>
      ) : null}
      {error ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-[var(--cc-danger)]">Could not load local demo fixtures: {error}</p>
          <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>Retry</Button>
        </div>
      ) : null}

      {fixtures && !loading ? (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-[var(--cc-text)]">Catalogue source records</h3>
                <p className="mt-1 text-sm text-[var(--cc-muted)]">
                  {fixtures.provenance.source_authority} · NLEM {fixtures.provenance.source_release}
                </p>
              </div>
              <a href={fixtures.provenance.source_url} target="_blank" rel="noreferrer" className="text-sm text-[var(--cc-primary)] hover:underline">
                Open official source
              </a>
            </div>
            <p className="mt-3 text-xs text-[var(--cc-muted)]">{fixtures.provenance.record_id_semantics}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {fixtures.catalogue_records.map((record) => (
                <article key={record.source_record_id} className="rounded-xl border border-[var(--cc-border)] bg-[var(--cc-bg)]/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 className="font-semibold text-[var(--cc-text)]">{record.canonical_name}</h4>
                    <Badge tone="info">NLEM source row</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-xs text-[var(--cc-muted)]">Ingredient</dt><dd className="text-[var(--cc-text-soft)]">{record.ingredient_name}</dd></div>
                    <div><dt className="text-xs text-[var(--cc-muted)]">Strength</dt><dd className="text-[var(--cc-text-soft)]">{record.strength_value} {record.strength_unit}</dd></div>
                    <div><dt className="text-xs text-[var(--cc-muted)]">Dosage form</dt><dd className="text-[var(--cc-text-soft)]">{record.dosage_form}</dd></div>
                    <div><dt className="text-xs text-[var(--cc-muted)]">Source record ID</dt><dd className="font-mono text-xs text-[var(--cc-text-soft)]">{record.source_record_id}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          </Card>

          <section aria-labelledby="d1-cabinet-heading" className="space-y-3">
            <div>
              <h3 id="d1-cabinet-heading" className="text-xl font-bold text-[var(--cc-text)]">Fictional Cabinet entries</h3>
              <p className="text-sm text-[var(--cc-muted)]">Display-only records. Source IDs here are not accepted by the authenticated Cabinet API.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {fixtures.cabinet.map((item) => {
                const record = recordById.get(item.catalogue_record_id);
                if (!record) {
                  return <Card key={item.id} role="alert">Cabinet fixture {item.id} references a missing catalogue source record.</Card>;
                }
                const reminder = item.reminder_id ? reminderById.get(item.reminder_id) : null;
                return (
                  <Card key={item.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4 className="font-semibold text-[var(--cc-text)]">{record.canonical_name}</h4>
                        <p className="mt-1 text-xs text-[var(--cc-muted)]">NLEM source record {record.source_record_id}</p>
                      </div>
                      <Badge tone={item.status === 'completed' ? 'neutral' : 'success'}>
                        {item.status === 'completed' ? 'Archived / completed' : 'Active fixture'}
                      </Badge>
                    </div>
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <div><dt className="text-xs text-[var(--cc-muted)]">Fixture schedule</dt><dd className="text-[var(--cc-text-soft)]">{item.schedule_text}</dd></div>
                      <div><dt className="text-xs text-[var(--cc-muted)]">Added</dt><dd className="text-[var(--cc-text-soft)]">{item.added_at}</dd></div>
                      {item.completed_at ? <div><dt className="text-xs text-[var(--cc-muted)]">Completed</dt><dd className="text-[var(--cc-text-soft)]">{item.completed_at}</dd></div> : null}
                      <div><dt className="text-xs text-[var(--cc-muted)]">Reminder</dt><dd className="text-[var(--cc-text-soft)]">
                        {reminder ? <a className="text-[var(--cc-primary)] hover:underline" href={`#${reminder.id}`}>{reminder.title}</a> : 'No reminder configured'}
                      </dd></div>
                    </dl>
                  </Card>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="d1-reminders-heading" className="space-y-3">
            <div>
              <h3 id="d1-reminders-heading" className="text-xl font-bold text-[var(--cc-text)]">Fictional Reminder and dose-history preview</h3>
              <p className="text-sm text-[var(--cc-muted)]">Editing and pause/resume below update this page only. Nothing is persisted or scheduled.</p>
            </div>
            <div className="grid gap-3">
              {reminders.map((reminder) => {
                const cabinetItem = fixtures.cabinet.find((item) => item.id === reminder.cabinet_id);
                const record = cabinetItem ? recordById.get(cabinetItem.catalogue_record_id) : null;
                return (
                  <Card id={reminder.id} key={reminder.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-[var(--cc-text)]">{reminder.title}</h4>
                        <p className="mt-1 text-sm text-[var(--cc-text-soft)]">{record?.canonical_name ?? 'Catalogue record unavailable'}</p>
                        <p className="mt-1 text-xs text-[var(--cc-muted)]">
                          {scheduleLabel(reminder.schedule_type)} · {reminder.scheduled_times.join(' and ')} · ends {reminder.ends_at}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={reminder.enabled ? 'success' : 'warning'}>{reminder.enabled ? 'Enabled in preview' : 'Paused in preview'}</Badge>
                        <Button
                          variant="secondary"
                          aria-label={`${reminder.enabled ? 'Pause' : 'Resume'} ${reminder.title}`}
                          onClick={() => setReminders((current) => current.map((item) =>
                            item.id === reminder.id ? { ...item, enabled: !item.enabled } : item,
                          ))}
                        >
                          {reminder.enabled ? 'Pause' : 'Resume'}
                        </Button>
                        <Button
                          variant="secondary"
                          aria-label={`Edit schedule for ${reminder.title}`}
                          onClick={() => { setEditingId(editingId === reminder.id ? null : reminder.id); setFormError(null); }}
                        >
                          {editingId === reminder.id ? 'Cancel edit' : 'Edit schedule'}
                        </Button>
                      </div>
                    </div>

                    {editingId === reminder.id ? (
                      <form className="mt-4 rounded-lg border border-[var(--cc-border)] p-3" onSubmit={(event) => saveSchedule(event, reminder)}>
                        <p className="text-xs text-[var(--cc-muted)]">Edit the synthetic preview schedule for this page session only.</p>
                        {formError ? <p role="alert" className="mt-2 text-sm text-[var(--cc-danger)]">{formError}</p> : null}
                        <div className="mt-3 flex flex-wrap gap-3">
                          <label className="text-sm text-[var(--cc-text-soft)]">Time 1
                            <input className="ml-2 rounded border border-[var(--cc-border)] bg-[var(--cc-bg)] p-1" type="time" name="firstTime" required defaultValue={reminder.scheduled_times[0]} />
                          </label>
                          {reminder.schedule_type === 'twice_daily' ? (
                            <label className="text-sm text-[var(--cc-text-soft)]">Time 2
                              <input className="ml-2 rounded border border-[var(--cc-border)] bg-[var(--cc-bg)] p-1" type="time" name="secondTime" required defaultValue={reminder.scheduled_times[1]} />
                            </label>
                          ) : null}
                        </div>
                        <Button type="submit" className="mt-3">Save local preview</Button>
                      </form>
                    ) : null}

                    <div className="mt-4 border-t border-[var(--cc-border)] pt-3">
                      <h5 className="text-sm font-semibold text-[var(--cc-text)]">Dose history fixture</h5>
                      {reminder.history.length > 0 ? (
                        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                          {reminder.history.map((entry) => (
                            <li key={`${entry.date}-${entry.time}`} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--cc-bg)]/70 px-3 py-2 text-sm">
                              <span className="text-[var(--cc-text-soft)]">{entry.date} · {entry.time}</span>
                              <Badge tone={entry.status === 'taken' ? 'success' : 'warning'}>
                                {entry.status === 'taken' ? 'Taken (fixture)' : 'Skipped (fixture)'}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="mt-2 text-sm text-[var(--cc-muted)]">No dose events in this fixture.</p>}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
