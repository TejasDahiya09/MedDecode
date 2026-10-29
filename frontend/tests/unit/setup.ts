import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

beforeEach(() => {
  if (typeof window === 'undefined') return;
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="#f8fafc">';
});
afterEach(() => {
  if (typeof window !== 'undefined') cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
