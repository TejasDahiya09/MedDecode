import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../src/app/App';
import { AppProviders } from '../../src/providers/AppProviders';
import { createAuthTestClient } from './auth-test-client';
import { capabilities } from '../../src/features/landing/landing-content';

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
function mount(path = '/') { return render(<AppProviders authClient={createAuthTestClient(null)}><MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter></AppProviders>); }

it('renders the public landing without workspace chrome, forms, records or API calls', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const { container } = mount();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Understand your prescriptions. Know your medicines.');
  expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).toBeNull();
  expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).toBeNull();
  expect(container.querySelector('input, form')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByText(/These capabilities describe the intended product/)).toBeTruthy();
  expect(document.title).toBe('MedDecode | Intelligence Behind Every Prescription');
});
it.each(['get-started', 'sign-in'])('provides an honest authentication UI /%s destination', async (intent) => {
  mount('/' + intent);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(intent === 'get-started' ? 'Create your account.' : 'Welcome back.');
  expect(screen.getByText(/Secure account access/)).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Back to MedDecode' }));
  fireEvent.click(screen.getByRole('link', { name: 'Workspace preview' }));
  expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Welcome back.');
});
it('adapts the showcase to all six planned capabilities', () => {
  mount();
  const group = screen.getByRole('group', { name: 'Explore planned capabilities' });
  expect(within(group).getAllByRole('button')).toHaveLength(6);
  for (const item of capabilities) {
    const button = within(group).getByRole('button', { name: new RegExp(item.title) });
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('#landing-module-scene h3')?.textContent).toBe(item.title);
  }
});
it('exposes semantic sections, a three-step process, and relevant footer destinations', () => {
  mount();
  for (const id of ['product', 'how-it-works', 'trust']) expect(document.getElementById(id)).toBeTruthy();
  expect(document.querySelectorAll('.cc-journey-steps > li')).toHaveLength(3);
  const footer = screen.getByRole('navigation', { name: 'Footer navigation' });
  expect(within(footer).getByRole('link', { name: 'Learn & Resources preview' }).getAttribute('href')).toBe('/learn-resources');
  expect(screen.queryByRole('link', { name: /Privacy Policy|Terms|Contact support/ })).toBeNull();
});
it('opens and dismisses the public disclosure with Escape', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open Explore menu' }));
  expect(screen.getByRole('navigation', { name: 'Mobile public navigation' })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('navigation', { name: 'Mobile public navigation' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Open Explore menu' }).getAttribute('aria-expanded')).toBe('false');
});
