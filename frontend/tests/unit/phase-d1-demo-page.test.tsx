import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixtures from '../../public/demo/phase-d1/fixtures.json';
import { PhaseD1DemoPage } from '../../src/features/demo/PhaseD1DemoPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PhaseD1DemoPage', () => {
  it('loads the source-backed fixture, shows cabinet/reminder coverage, and keeps edits local', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(fixtures), { headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <PhaseD1DemoPage />
      </MemoryRouter>,
    );

    expect(await screen.findAllByText('Paracetamol - Tablet 500 mg')).toHaveLength(3);
    expect(screen.getAllByText('Paracetamol - Oral liquid 120 mg/5 mL (p)')).toHaveLength(3);
    expect(screen.getAllByText('Diclofenac - Tablet 50 mg')).toHaveLength(3);
    expect(screen.getAllByText('Ibuprofen - Tablet 200 mg')).toHaveLength(3);
    expect(screen.getAllByText('Mefenamic acid - Oral liquid 100 mg/5 mL (p)')).toHaveLength(3);
    expect(screen.getByText('Fictional Cabinet entries')).toBeTruthy();
    expect(screen.getByText('Fictional Reminder and dose-history preview')).toBeTruthy();
    expect(screen.getByText('Skipped (fixture)')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/demo/phase-d1/fixtures.json', expect.objectContaining({ signal: expect.any(AbortSignal) }));

    const pause = screen.getByRole('button', { name: 'Pause Morning demo reminder' });
    fireEvent.click(pause);
    expect(screen.getByRole('button', { name: 'Resume Morning demo reminder' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit schedule for Morning demo reminder' }));
    fireEvent.change(screen.getByLabelText('Time 1'), { target: { value: '10:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save local preview' }));
    await waitFor(() => expect(screen.getByText(/Daily · 10:30 · ends/)).toBeTruthy());
  });

  it('shows a retryable error instead of an empty page when the local fixture cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('unavailable', { status: 503 })));
    render(
      <MemoryRouter>
        <PhaseD1DemoPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
