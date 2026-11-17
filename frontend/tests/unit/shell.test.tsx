import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../src/app/App';
import { destinations } from '../../src/app/navigation';
import { AppProviders } from '../../src/providers/AppProviders';
import { Badge, Button, Card, EmptyState, PageHeader, SectionHeader, Skeleton } from '../../src/components/ui';
import { createAuthTestClient, mockVerifiedIdentity, testSession } from './auth-test-client';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  mockVerifiedIdentity();
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    const url = String(input);
    if (url.includes('/api/v1/auth/me')) {
      return new Response(JSON.stringify({ user: testSession.user }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/v1/prescriptions')) {
      return new Response(JSON.stringify({ items: [], pagination: { limit: 20, offset: 0, returned: 0, has_more: false, next_offset: null } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
function mount(path = '/home') { return render(<MemoryRouter initialEntries={[path]}><AppProviders authClient={createAuthTestClient()} initialAuthSession={testSession}><AppRoutes /></AppProviders></MemoryRouter>); }

it.each(destinations)('renders the $label workspace route', async (destination) => {
  mount(destination.path);
  const expectedHeadingPattern =
    destination.path === '/home'
      ? /Welcome back/
      : destination.path === '/prescriptions'
        ? /Prescriptions/
        : destination.path === '/reminders'
          ? /Medication Reminders|Reminders/
          : new RegExp(destination.label);
  expect(await screen.findByRole('heading', { level: 1, name: expectedHeadingPattern })).toBeTruthy();
  expect(document.title).toBe(`${destination.label} | MedDecode`);
  expect(document.querySelectorAll('.cc-shell-primary-nav > a')).toHaveLength(destinations.length);
  expect(document.querySelector('.md-sidebar')).toBeNull();
  expect(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getAllByRole('link', { name: destination.label })[0]!.getAttribute('aria-current')).toBe('page');
  if (destination.path === '/upload-prescription') expect(screen.getByText('Secure upload')).toBeTruthy();
  if (destination.path === '/medicine-library' || destination.path === '/medicine-insights') {
    expect(screen.getByText(/Explore official Indian medicine formulations/)).toBeTruthy();
    expect(screen.queryByText('Demo Mode')).toBeNull();
  }
  if (destination.path === '/compare-medicines') {
    expect(screen.getByText(/Clinical Independence Standard/)).toBeTruthy();
    expect(screen.queryByText('Demo Mode')).toBeNull();
  }
  if (destination.path === '/my-cabinet') {
    expect(screen.getByText(/Add entries from the supported medicine reference/)).toBeTruthy();
  }
});
it('provides a not-found route and Home recovery', async () => {
  mount('/missing');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Page not found');
  fireEvent.click(screen.getByRole('link', { name: 'Return to Home' }));
  expect(await screen.findByRole('heading', { name: /Welcome back/ })).toBeTruthy();
});
it('opens a labelled drawer and isolates the background until Escape', () => {
  mount();
  const trigger = screen.getByRole('button', { name: 'Explore all sections' });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Explore MedDecode' });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(within(within(dialog).getByRole('navigation', {name:'All sections'})).getAllByRole('link')).toHaveLength(destinations.length);
  expect(document.querySelector('.md-shell-background')?.hasAttribute('inert')).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.querySelector('.md-shell-background')?.hasAttribute('inert')).toBe(false);
});
it('closes the complete directory after navigation and keeps the route active', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Explore all sections' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /Compare Medicines/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Compare Medicines');
  expect(within(screen.getByRole('navigation',{name:'Primary navigation'})).getAllByRole('link',{name:'Compare Medicines'})[0]!.getAttribute('aria-current')).toBe('page');
});
it('keeps fictional catalogue fixtures behind a separate labelled demo route', () => {
  mount('/demo/medicine-insights');
  expect(screen.getByRole('heading', { name: 'Fictional interface fixtures' })).toBeTruthy();
  expect(screen.getByText('Demo Mode')).toBeTruthy();
  expect(screen.getByText('Fictional references, thoughtfully organized.')).toBeTruthy();
});
it('reused buttons are non-submit by default, with explicit submit preserved', () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(<form onSubmit={submit}><Button>Open</Button><Button type="submit">Save</Button><Button loading>Working</Button></form>);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(submit).toHaveBeenCalledOnce();
  expect((screen.getByRole('button', { name: 'Working' }) as HTMLButtonElement).disabled).toBe(true);
});
it('retains the shared component markup without data services', () => {
  const { container } = render(<><PageHeader title="Preview" description="Structure only" /><Card><SectionHeader title="Section" /><Badge>Preview</Badge><EmptyState title="Unavailable" description="Not implemented" /><Skeleton className="h-4" /></Card></>);
  expect(container.querySelector('.cc-card')).toBeTruthy();
  expect(container.querySelector('.cc-badge')).toBeTruthy();
  expect(container.querySelector('.cc-skeleton')?.getAttribute('aria-hidden')).toBe('true');
});
