import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PrescriptionProcessingStepper } from '../../src/features/prescriptions/PrescriptionProcessingStepper';

afterEach(cleanup);
describe('V3 progress requires stored result evidence', () => {
  it('completed OCR with draft pauses for review', () => {
    render(<PrescriptionProcessingStepper status="completed" processing={null} reviewState="draft" />);
    expect(screen.getByText('OCR complete — Review Required')).toBeTruthy();
    expect(screen.queryByText('Results Ready')).toBeNull();
  });
  for (const status of ['queued', 'processing'] as const) {
    it(`shows confirmed ${status} job without claiming a result`, () => {
      render(<PrescriptionProcessingStepper status={status} processing={{ job_id: 'job', status, created_at: '', started_at: null, completed_at: null }} reviewState="confirmed" />);
      expect(screen.getByText('Review Confirmed — Intelligence Processing')).toBeTruthy();
      expect(screen.queryByText('Results Ready')).toBeNull();
    });
  }
  it('shows final result availability for legacy completed records', () => {
    render(<PrescriptionProcessingStepper status="completed" processing={null} resultAvailable />);
    expect(screen.getByText('Results Ready')).toBeTruthy();
  });
  it('does not equate completed status with a result', () => {
    render(<PrescriptionProcessingStepper status="completed" processing={null} />);
    expect(screen.queryByText('Results Ready')).toBeNull();
  });
  it('reports confirmed processing failure', () => {
    render(<PrescriptionProcessingStepper status="failed" processing={null} reviewState="confirmed" />);
    expect(screen.getByText('Intelligence processing failed')).toBeTruthy();
    expect(screen.queryByText('Results Ready')).toBeNull();
  });
});
