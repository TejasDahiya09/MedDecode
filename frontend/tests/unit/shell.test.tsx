import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../src/app/App';
import { destinations } from '../../src/app/navigation';
import { AppProviders } from '../../src/providers/AppProviders';
import { Badge, Button, Card, EmptyState, PageHeader, SectionHeader, Skeleton } from '../../src/components/ui';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
function mount(path = '/home') { return render(<MemoryRouter initialEntries={[path]}><AppProviders><AppRoutes /></AppProviders></MemoryRouter>); }

it.each(destinations)('renders the $label demo workspace', (destination) => {
  mount(destination.path);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(destination.path === '/home' ? 'Welcome, Demo User.' : destination.label);
  expect(document.title).toBe(`${destination.label} | MedDecode`);
  expect(document.querySelectorAll('.cc-shell-primary-nav > a')).toHaveLength(7);
  expect(document.querySelector('.md-sidebar')).toBeNull();
  expect(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getAllByRole('link', { name: destination.label })[0]!.getAttribute('aria-current')).toBe('page');
  expect(screen.queryByText('Not yet implemented')).toBeNull();
  expect(screen.getByText('Demo Mode')).toBeTruthy();
  expect(screen.getByText(/Synthetic examples/)).toBeTruthy();
});
it('provides a not-found route and Home recovery', () => {
  mount('/missing');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Page not found');
  fireEvent.click(screen.getByRole('link', { name: 'Return to Home' }));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome, Demo User.');
});
it('opens a labelled drawer and isolates the background until Escape', () => {
  mount();
  const trigger = screen.getByRole('button', { name: 'More sections' });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Explore MedDecode' });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(within(within(dialog).getByRole('navigation', {name:'All sections'})).getAllByRole('link')).toHaveLength(7);
  expect(document.querySelector('.md-shell-background')?.hasAttribute('inert')).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.querySelector('.md-shell-background')?.hasAttribute('inert')).toBe(false);
});
it('closes the drawer after navigation and marks More for other sections', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'More sections' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: /Compare Medicines/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Compare Medicines');
  expect(screen.getByRole('button', { name: 'More sections, current section: Compare Medicines' }).classList.contains('cc-mobile-nav-link--active')).toBe(true);
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
