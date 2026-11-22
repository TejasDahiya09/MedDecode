import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteLoadingState } from '../../src/app/RouteLoadingState';

describe('RouteLoadingState', () => {
  it('announces a readable loading state without corrupted characters', () => {
    render(<RouteLoadingState label="prescription review" />);

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toBe('Loading prescription review...');
    expect(status.textContent).not.toMatch(/[ÃÂâ]/u);
  });
});
