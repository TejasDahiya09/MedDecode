import { StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { AppProviders } from '../../src/providers/AppProviders';
import { readThemeMode, themeStorageKey } from '../../src/providers/theme';

let systemDark = false;
const listeners = new Set<(event: MediaQueryListEvent) => void>();
const media = {
  get matches() { return systemDark; },
  addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
  removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
};
function changeSystem(dark: boolean) {
  act(() => {
    systemDark = dark;
    for (const listener of listeners) listener({ matches: dark } as MediaQueryListEvent);
  });
}
function mount() { return render(<StrictMode><AppProviders><App /></AppProviders></StrictMode>); }
beforeEach(() => {
  systemDark = false;
  listeners.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => media));
});

it.each(['light', 'dark', 'system'])('renders stored preference %s through providers', (mode) => {
  localStorage.setItem(themeStorageKey, mode);
  mount();
  expect(screen.getByRole('button', { name: `Use ${mode} theme` }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy();
});
it.each([null, 'invalid'])('falls back to system for preference %s', (value) => {
  if (value !== null) localStorage.setItem(themeStorageKey, value);
  expect(readThemeMode()).toBe('system');
  systemDark = true;
  mount();
  expect(document.documentElement.dataset.theme).toBe('dark');
});
it('supports blocked reads and writes with session-only selection', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Use dark theme' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
});
it('selects, persists and resolves light, dark and system modes', () => {
  mount();
  for (const mode of ['dark', 'light', 'system']) {
    fireEvent.click(screen.getByRole('button', { name: `Use ${mode} theme` }));
    expect(localStorage.getItem(themeStorageKey)).toBe(mode);
    expect(document.documentElement.dataset.theme).toBe(mode === 'system' ? 'light' : mode);
  }
  changeSystem(true);
  expect(document.documentElement.dataset.theme).toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: 'Use light theme' }));
  changeSystem(false);
  changeSystem(true);
  expect(document.documentElement.dataset.theme).toBe('light');
});
it('synchronizes storage updates and clearing', () => {
  mount();
  act(() => {
    localStorage.setItem(themeStorageKey, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: themeStorageKey }));
  });
  expect(document.documentElement.dataset.theme).toBe('dark');
  act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null })); });
  expect(screen.getByRole('button', { name: 'Use system theme' }).getAttribute('aria-pressed')).toBe('true');
});
it('cleans up listeners after Strict Mode and unmount', () => {
  const remove = vi.spyOn(window, 'removeEventListener');
  const view = mount();
  expect(listeners.size).toBe(1);
  view.unmount();
  expect(listeners.size).toBe(0);
  expect(remove.mock.calls.filter(([type]) => type === 'storage').length).toBe(2);
});
it('resynchronizes the OS preference when subscribing', () => {
  let calls = 0;
  vi.stubGlobal('matchMedia', () => {
    calls++;
    if (calls > 1) systemDark = true;
    return media;
  });
  render(<AppProviders><App /></AppProviders>);
  expect(document.documentElement.dataset.theme).toBe('dark');
});
it.each(['light', 'dark', 'system', 'invalid', null])('keeps initializer and provider consistent for %s', (value) => {
  if (value !== null) localStorage.setItem(themeStorageKey, value);
  systemDark = true;
  window.eval(readFileSync('public/theme-init.js', 'utf8'));
  const initial = document.documentElement.dataset.theme;
  mount();
  expect(document.documentElement.dataset.theme).toBe(initial);
  expect(document.documentElement.style.colorScheme).toBe(initial);
});
it('initializes safely without a theme-color element and with storage blocked', () => {
  document.head.innerHTML = '';
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
  expect(() => window.eval(readFileSync('public/theme-init.js', 'utf8'))).not.toThrow();
  expect(document.documentElement.dataset.theme).toBe('light');
});
it('renders without an API base or fabricated workflows', () => {
  vi.stubEnv('VITE_API_BASE_URL', '');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  mount();
  expect(screen.getByText('Intelligence Behind Every Prescription')).toBeTruthy();
  expect(screen.getByText(/Product workflows are not yet implemented/)).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});
