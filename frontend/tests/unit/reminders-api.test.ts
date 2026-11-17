import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createReminder,
  deleteReminder,
  fetchRecentDoseLogs,
  fetchReminders,
  logDose,
  parseDoseLog,
  parseReminder,
  parseRemindersResponse,
  updateReminder,
} from '../../src/features/reminders/reminders-api';
import * as apiClient from '../../src/services/api-client';

const validId = '11111111-1111-4111-8111-111111111111';
const medicineId = '22222222-2222-4222-8222-222222222222';

const validRaw = {
  id: validId,
  medicine_id: medicineId,
  medicine_name: 'Paracetamol 500mg',
  dosage: '1 Tablet',
  scheduled_time: '08:00',
  scheduled_date: '2026-11-14',
  recurrence: 'daily',
  status: 'active',
  notes: 'Take with food',
  created_at: '2026-11-14T08:00:00Z',
  updated_at: '2026-11-14T08:00:00Z',
};

describe('reminders-api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseReminder', () => {
    it('successfully parses a valid reminder object', () => {
      const parsed = parseReminder(validRaw);
      expect(parsed).not.toBeNull();
      expect(parsed?.id).toBe(validId);
      expect(parsed?.medicine_name).toBe('Paracetamol 500mg');
      expect(parsed?.scheduled_time).toBe('08:00');
      expect(parsed?.recurrence).toBe('daily');
      expect(parsed?.status).toBe('active');
    });

    it('rejects objects with invalid UUIDs', () => {
      expect(parseReminder({ ...validRaw, id: 'invalid-id' })).toBeNull();
    });

    it('rejects objects with empty medicine_name', () => {
      expect(parseReminder({ ...validRaw, medicine_name: '   ' })).toBeNull();
    });

    it('rejects objects with invalid scheduled_time', () => {
      expect(parseReminder({ ...validRaw, scheduled_time: 'invalid' })).toBeNull();
    });

    it('defaults unknown recurrence to daily and unknown status to active', () => {
      const parsed = parseReminder({ ...validRaw, recurrence: 'unknown', status: 'unknown' });
      expect(parsed?.recurrence).toBe('daily');
      expect(parsed?.status).toBe('active');
    });
  });

  describe('parseRemindersResponse', () => {
    it('parses wrapped items array response', () => {
      const res = parseRemindersResponse({ items: [validRaw], total: 1 });
      expect(res).not.toBeNull();
      expect(res?.items).toHaveLength(1);
      expect(res?.total).toBe(1);
    });

    it('parses unwrapped array response', () => {
      const res = parseRemindersResponse([validRaw]);
      expect(res).not.toBeNull();
      expect(res?.items).toHaveLength(1);
      expect(res?.total).toBe(1);
    });

    it('returns null on invalid response payload', () => {
      expect(parseRemindersResponse(null)).toBeNull();
      expect(parseRemindersResponse({ items: 'not-array' })).toBeNull();
    });
  });

  describe('API requests', () => {
    const token = 'test-token';

    it('fetchReminders calls GET /api/v1/reminders', async () => {
      const spy = vi.spyOn(apiClient, 'requestAuthenticatedJson').mockResolvedValueOnce({
        items: [validRaw],
        total: 1,
      });

      const result = await fetchReminders(token);
      expect(spy).toHaveBeenCalledWith('/api/v1/reminders', token);
      expect(result.items).toHaveLength(1);
    });

    it('createReminder calls POST /api/v1/reminders with payload', async () => {
      const spy = vi.spyOn(apiClient, 'requestAuthenticatedJson').mockResolvedValueOnce({
        reminder: validRaw,
      });

      const result = await createReminder(
        {
          medicine_name: 'Paracetamol 500mg',
          scheduled_time: '08:00',
          recurrence: 'daily',
        },
        token,
      );

      expect(spy).toHaveBeenCalledWith(
        '/api/v1/reminders',
        token,
        expect.objectContaining({
          method: 'POST',
        }),
      );
      expect(result.id).toBe(validId);
    });

    it('updateReminder calls PATCH /api/v1/reminders/:id', async () => {
      const spy = vi.spyOn(apiClient, 'requestAuthenticatedJson').mockResolvedValueOnce({
        reminder: { ...validRaw, status: 'paused' },
      });

      const result = await updateReminder(validId, { status: 'paused' }, token);
      expect(spy).toHaveBeenCalledWith(
        `/api/v1/reminders/${validId}`,
        token,
        expect.objectContaining({
          method: 'PATCH',
        }),
      );
      expect(result.status).toBe('paused');
    });

    it('deleteReminder calls DELETE /api/v1/reminders/:id', async () => {
      const spy = vi.spyOn(apiClient, 'requestAuthenticatedJson').mockResolvedValueOnce({});

      await deleteReminder(validId, token);
      expect(spy).toHaveBeenCalledWith(
        `/api/v1/reminders/${validId}`,
        token,
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });

    it('logDose calls POST /api/v1/reminders/:id/doses', async () => {
      const spy = vi.spyOn(apiClient, 'requestAuthenticatedJson').mockResolvedValueOnce({
        dose: {
          id: '33333333-3333-4333-8333-333333333333',
          reminder_id: validId,
          status: 'taken',
          dose_time: '2026-11-16T08:00:00Z',
          logged_at: '2026-11-16T08:00:05Z',
          medicine_name: 'Paracetamol 500mg',
        },
        reminder: { ...validRaw, last_taken_at: '2026-11-16T08:00:05Z' },
      });

      const result = await logDose(validId, { status: 'taken' }, token);
      expect(spy).toHaveBeenCalledWith(
        `/api/v1/reminders/${validId}/doses`,
        token,
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result.dose.status).toBe('taken');
      expect(result.reminder.last_taken_at).toBe('2026-11-16T08:00:05Z');
    });

    it('fetchRecentDoseLogs calls GET /api/v1/reminders/doses/recent', async () => {
      const spy = vi.spyOn(apiClient, 'requestAuthenticatedJson').mockResolvedValueOnce({
        items: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            reminder_id: validId,
            status: 'taken',
            dose_time: '2026-11-16T08:00:00Z',
            logged_at: '2026-11-16T08:00:05Z',
            medicine_name: 'Paracetamol 500mg',
          },
        ],
      });

      const result = await fetchRecentDoseLogs(token);
      expect(spy).toHaveBeenCalledWith('/api/v1/reminders/doses/recent?limit=20', token);
      expect(result).toHaveLength(1);
    });

    it('parseDoseLog validates and parses dose objects', () => {
      expect(parseDoseLog(null)).toBeNull();
      expect(parseDoseLog({ id: 'bad' })).toBeNull();
      const valid = parseDoseLog({
        id: '33333333-3333-4333-8333-333333333333',
        reminder_id: validId,
        status: 'taken',
        dose_time: '2026-11-16T08:00:00Z',
        logged_at: '2026-11-16T08:00:00Z',
      });
      expect(valid?.status).toBe('taken');
    });
  });
});
