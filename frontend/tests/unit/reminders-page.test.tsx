import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/providers/AppProviders';
import { RemindersPage } from '../../src/features/reminders/RemindersPage';
import { createAuthTestClient, testSession } from './auth-test-client';
import * as remindersApi from '../../src/features/reminders/reminders-api';
import * as cabinetApi from '../../src/features/cabinet/medicine-cabinet-api';
import { ApiError } from '../../src/services/api-client';

const sampleReminderId = '11111111-1111-4111-8111-111111111111';
const sampleReminderId2 = '22222222-2222-4222-8222-222222222222';

const mockReminder1: remindersApi.MedicationReminder = {
  id: sampleReminderId,
  medicine_id: null,
  medicine_name: 'Metformin 500mg',
  dosage: '1 Tablet with dinner',
  scheduled_time: '19:00',
  scheduled_date: null,
  recurrence: 'daily',
  status: 'active',
  notes: 'Check blood glucose before dose',
  created_at: '2026-11-14T10:00:00Z',
  updated_at: '2026-11-14T10:00:00Z',
};

const mockReminder2: remindersApi.MedicationReminder = {
  id: sampleReminderId2,
  medicine_id: null,
  medicine_name: 'Vitamin D3 60000 IU',
  dosage: '1 Capsule weekly',
  scheduled_time: '10:00',
  scheduled_date: '2026-11-15',
  recurrence: 'weekly',
  status: 'active',
  notes: 'Take on Sunday mornings',
  created_at: '2026-11-14T10:00:00Z',
  updated_at: '2026-11-14T10:00:00Z',
};

function renderReminders() {
  const authClient = createAuthTestClient(testSession);
  return render(
    <AppProviders authClient={authClient} initialAuthSession={testSession}>
      <MemoryRouter initialEntries={['/reminders']}>
        <RemindersPage />
      </MemoryRouter>
    </AppProviders>,
  );
}

describe('RemindersPage Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('VITE_API_BASE_URL', '/backend');
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    vi.spyOn(cabinetApi, 'fetchMedicineCabinet').mockResolvedValue({
      items: [],
      pagination: { limit: 20, offset: 0, returned: 0, has_more: false, next_offset: null },
    });
  });

  it('renders page header with title and Add Reminder button', async () => {
    vi.spyOn(remindersApi, 'fetchReminders').mockResolvedValueOnce({
      items: [],
      total: 0,
    });

    renderReminders();
    expect(screen.getByRole('heading', { level: 1, name: 'Medication Reminders' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add reminder/i })).toBeTruthy();
  });

  it('displays empty state with guided links when no reminders are scheduled', async () => {
    vi.spyOn(remindersApi, 'fetchReminders').mockResolvedValueOnce({
      items: [],
      total: 0,
    });

    renderReminders();
    expect(await screen.findByText('No reminders scheduled yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add first reminder' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View Medicine Cabinet' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Upload Prescription' })).toBeTruthy();
  });

  it('renders honest readiness banner when backend endpoint returns 404 with retry action', async () => {
    let callCount = 0;
    vi.spyOn(remindersApi, 'fetchReminders').mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new ApiError('Not Found', 404, 'http');
      }
      return { items: [mockReminder1], total: 1 };
    });

    renderReminders();

    // Shows patient-facing unavailable status
    expect(await screen.findByRole('heading', { name: 'Medication reminders are temporarily unavailable' })).toBeTruthy();
    expect(screen.getByText(/Reminder scheduling is not available right now/i)).toBeTruthy();

    // Add reminder button is disabled with explanatory title
    const addBtn = screen.getByRole('button', { name: /Add reminder/i });
    expect((addBtn as HTMLButtonElement).disabled).toBe(true);

    // Click retry
    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryBtn);

    // After retry succeeds, shows reminder
    expect(await screen.findByText('Metformin 500mg')).toBeTruthy();
    expect(callCount).toBe(2);
  });

  it('renders populated reminders divided into Today and Upcoming schedules', async () => {
    vi.spyOn(remindersApi, 'fetchReminders').mockResolvedValueOnce({
      items: [mockReminder1, mockReminder2],
      total: 2,
    });

    renderReminders();

    // Today's schedule contains daily metformin
    expect(await screen.findByText("Today's Schedule")).toBeTruthy();
    expect(screen.getByText('Metformin 500mg')).toBeTruthy();
    expect(screen.getByText('1 Tablet with dinner')).toBeTruthy();
    expect(screen.getByText('7:00 PM')).toBeTruthy(); // 19:00 in 12hr AM/PM
    expect(screen.getByText('“Check blood glucose before dose”')).toBeTruthy();

    // Upcoming contains weekly vitamin D3
    expect(screen.getByText('Upcoming & Periodic')).toBeTruthy();
    expect(screen.getByText('Vitamin D3 60000 IU')).toBeTruthy();
    expect(screen.getByText('10:00 AM')).toBeTruthy();
    expect(screen.getByText('Weekly')).toBeTruthy();
  });

  it('supports opening add dialog, validating inputs, and saving through real API', async () => {
    vi.spyOn(remindersApi, 'fetchReminders').mockResolvedValue({
      items: [],
      total: 0,
    });

    const createSpy = vi.spyOn(remindersApi, 'createReminder').mockResolvedValueOnce({
      id: '33333333-3333-4333-8333-333333333333',
      medicine_id: null,
      medicine_name: 'Amoxicillin 500mg',
      dosage: '1 Capsule 3 times daily',
      scheduled_time: '08:00',
      scheduled_date: null,
      recurrence: 'thrice_daily',
      status: 'active',
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    renderReminders();
    await screen.findByText('No reminders scheduled yet');

    // Open add modal
    fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }));
    expect(screen.getByRole('heading', { name: 'Add Medication Reminder' })).toBeTruthy();

    // Fill form
    const nameInput = screen.getByPlaceholderText(/e\.g\. Paracetamol/);
    fireEvent.change(nameInput, { target: { value: 'Amoxicillin 500mg' } });

    const dosageInput = screen.getByPlaceholderText(/e\.g\. 1 Tablet/);
    fireEvent.change(dosageInput, { target: { value: '1 Capsule 3 times daily' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          medicine_name: 'Amoxicillin 500mg',
          dosage: '1 Capsule 3 times daily',
          scheduled_time: '08:00',
        }),
        testSession.access_token,
      );
    });
  });

  it('toggles pause and resume status through real updateReminder API', async () => {
    vi.spyOn(remindersApi, 'fetchReminders').mockResolvedValue({
      items: [mockReminder1],
      total: 1,
    });

    const updateSpy = vi.spyOn(remindersApi, 'updateReminder').mockResolvedValueOnce({
      ...mockReminder1,
      status: 'paused',
    });

    renderReminders();
    expect(await screen.findByText('Metformin 500mg')).toBeTruthy();

    // Click Pause
    const pauseBtn = screen.getByRole('button', { name: /Pause reminder for Metformin 500mg/i });
    fireEvent.click(pauseBtn);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(sampleReminderId, { status: 'paused' }, testSession.access_token);
    });
  });

  it('handles delete confirmation flow through real deleteReminder API', async () => {
    vi.spyOn(remindersApi, 'fetchReminders').mockResolvedValue({
      items: [mockReminder1],
      total: 1,
    });

    const deleteSpy = vi.spyOn(remindersApi, 'deleteReminder').mockResolvedValueOnce();

    renderReminders();
    expect(await screen.findByText('Metformin 500mg')).toBeTruthy();

    // Click Delete button on card
    const deleteBtn = screen.getByRole('button', { name: /Delete reminder for Metformin 500mg/i });
    fireEvent.click(deleteBtn);

    // Confirmation dialog opens
    expect(screen.getByRole('heading', { name: 'Delete Reminder?' })).toBeTruthy();
    expect(screen.getByText(/Are you sure you want to delete the reminder for Metformin 500mg/i)).toBeTruthy();

    // Confirm deletion
    const confirmBtn = screen.getByRole('button', { name: 'Confirm deletion' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith(sampleReminderId, testSession.access_token);
    });
  });

  it('supports marking dose taken through logDose API', async () => {
    vi.spyOn(remindersApi, 'fetchReminders').mockResolvedValue({
      items: [mockReminder1],
      total: 1,
    });

    const logDoseSpy = vi.spyOn(remindersApi, 'logDose').mockResolvedValueOnce({
      dose: {
        id: '44444444-4444-4444-8444-444444444444',
        reminder_id: sampleReminderId,
        dose_time: new Date().toISOString(),
        status: 'taken',
        notes: null,
        logged_at: new Date().toISOString(),
        medicine_name: 'Metformin 500mg',
      },
      reminder: {
        ...mockReminder1,
        last_taken_at: new Date().toISOString(),
      },
    });

    renderReminders();
    expect(await screen.findByText('Metformin 500mg')).toBeTruthy();

    const takeBtn = screen.getByRole('button', { name: /Mark dose taken for Metformin 500mg/i });
    fireEvent.click(takeBtn);

    await waitFor(() => {
      expect(logDoseSpy).toHaveBeenCalledWith(
        sampleReminderId,
        { status: 'taken' },
        testSession.access_token,
      );
    });
  });

  it('supports marking dose skipped through logDose API', async () => {
    vi.spyOn(remindersApi, 'fetchReminders').mockResolvedValue({
      items: [mockReminder1],
      total: 1,
    });

    const logDoseSpy = vi.spyOn(remindersApi, 'logDose').mockResolvedValueOnce({
      dose: {
        id: '44444444-4444-4444-8444-444444444444',
        reminder_id: sampleReminderId,
        dose_time: new Date().toISOString(),
        status: 'skipped',
        notes: null,
        logged_at: new Date().toISOString(),
        medicine_name: 'Metformin 500mg',
      },
      reminder: mockReminder1,
    });

    renderReminders();
    expect(await screen.findByText('Metformin 500mg')).toBeTruthy();

    const skipBtn = screen.getByRole('button', { name: /Mark dose skipped for Metformin 500mg/i });
    fireEvent.click(skipBtn);

    await waitFor(() => {
      expect(logDoseSpy).toHaveBeenCalledWith(
        sampleReminderId,
        { status: 'skipped' },
        testSession.access_token,
      );
    });
  });

  it('renders recent dose activity section when dose records exist', async () => {
    vi.spyOn(remindersApi, 'fetchReminders').mockResolvedValue({
      items: [mockReminder1],
      total: 1,
    });
    vi.spyOn(remindersApi, 'fetchRecentDoseLogs').mockResolvedValueOnce([
      {
        id: '55555555-5555-4555-8555-555555555555',
        reminder_id: sampleReminderId,
        dose_time: new Date().toISOString(),
        status: 'taken',
        notes: null,
        logged_at: new Date().toISOString(),
        medicine_name: 'Metformin 500mg',
      },
    ]);

    renderReminders();
    expect(await screen.findByText('Recent Dose Activity')).toBeTruthy();
    expect(screen.getByText('Recorded adherence events')).toBeTruthy();
    expect(screen.getByText('Taken')).toBeTruthy();
  });
});
