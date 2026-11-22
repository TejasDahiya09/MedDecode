import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppRoutes } from '../../src/app/App';
import { destinations, mobileDestinations } from '../../src/app/navigation';
import { AppProviders } from '../../src/providers/AppProviders';
import { createAuthTestClient, mockVerifiedIdentity, testSession } from './auth-test-client';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  mockVerifiedIdentity();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/v1/prescriptions')) {
        return new Response(
          JSON.stringify({
            items: [],
            pagination: { limit: 20, offset: 0, returned: 0, has_more: false, next_offset: null },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});

function mount(path = '/home') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders authClient={createAuthTestClient()} initialAuthSession={testSession}>
        <AppRoutes />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('MedDecode Header Navigation & Redundancy Removal', () => {
  it('has the exact preferred desktop navigation order', () => {
    const expectedOrder = [
      'Home',
      'My Prescriptions',
      'Upload Prescription',
      'Medicine Library',
      'Compare Medicines',
      'My Cabinet',
      'Reminders',
      'Learn & Resources',
    ];
    const actualOrder = destinations.map((d) => d.label);
    expect(actualOrder).toEqual(expectedOrder);
  });

  it('includes Prescriptions and Library in mobile destinations', () => {
    const mobilePrescription = mobileDestinations.find((d) => d.path === '/prescriptions');
    expect(mobilePrescription).toBeDefined();
    expect(mobilePrescription?.path).toBe('/prescriptions');

    const mobileLibrary = mobileDestinations.find((d) => d.path === '/medicine-library');
    expect(mobileLibrary).toBeDefined();
    expect(mobileLibrary?.path).toBe('/medicine-library');
  });

  it('describes implemented workspace capabilities without placeholder or clinical overclaim wording', () => {
    expect(destinations.find((item) => item.path === '/upload-prescription')?.description)
      .toBe('Upload a PDF or image and track prescription processing.');
    expect(destinations.find((item) => item.path === '/compare-medicines')?.description)
      .toBe('Compare selected catalogue formulations without implying clinical equivalence.');
    expect(destinations.find((item) => item.path === '/my-cabinet')?.description)
      .toBe('Organize saved medicines, quantities, refill dates and expiry details.');
    expect(destinations.find((item) => item.path === '/reminders')?.description)
      .toBe('Create and manage medication schedules and recorded dose events.');
  });

  it('renders My Prescriptions in the primary navigation linking to /prescriptions', () => {
    mount('/home');
    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const prescriptionsLink = within(primaryNav).getByRole('link', { name: 'My Prescriptions' });
    expect(prescriptionsLink).toBeTruthy();
    expect(prescriptionsLink.getAttribute('href')).toBe('/prescriptions');
  });

  it('sets the active indicator on My Prescriptions for /prescriptions route', async () => {
    mount('/prescriptions');
    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const prescriptionsLink = within(primaryNav).getByRole('link', { name: 'My Prescriptions' });
    expect(prescriptionsLink.classList.contains('is-active')).toBe(true);
    expect(prescriptionsLink.getAttribute('aria-current')).toBe('page');
  });

  it('sets the active indicator on My Prescriptions for prescription detail /prescriptions/:id route', async () => {
    mount('/prescriptions/10000000-0000-4000-8000-000000000010');
    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const prescriptionsLink = within(primaryNav).getByRole('link', { name: 'My Prescriptions' });
    expect(prescriptionsLink.classList.contains('is-active')).toBe(true);
  });

  it('does NOT contain redundant standalone shortcut icons for Cabinet, Reminders, or Resources', () => {
    mount('/home');
    const utilities = document.querySelector('.cc-shell-utilities');
    expect(utilities).toBeTruthy();

    // Verify search trigger, theme toggle, and account menu exist
    expect(within(utilities as HTMLElement).getByRole('button', { name: /open section search/i })).toBeTruthy();
    expect(within(utilities as HTMLElement).getByRole('button', { name: /switch to (dark|light) mode/i })).toBeTruthy();
    expect(within(utilities as HTMLElement).getByLabelText('Account menu')).toBeTruthy();

    // Verify redundant standalone shortcut icons are completely absent
    expect(document.querySelector('.md-compact-utilities')).toBeNull();
    expect(document.querySelector('.md-direct-utility')).toBeNull();
    expect(within(utilities as HTMLElement).queryByRole('link', { name: /Cabinet shortcut/i })).toBeNull();
    expect(within(utilities as HTMLElement).queryByRole('link', { name: /Reminders shortcut/i })).toBeNull();
    expect(within(utilities as HTMLElement).queryByRole('link', { name: /Resources shortcut/i })).toBeNull();
  });

  it('offers the supported account page from the account menu', () => {
    mount('/home');
    const menu = document.querySelector('.cc-shell-account-menu');
    expect(menu).toBeTruthy();
    expect(within(menu as HTMLElement).getByRole('link', { name: 'Account & settings' }).getAttribute('href')).toBe('/account');
  });

  it('renders Cabinet, Reminders, and Resources in direct primary navigation links and overflow menu', () => {
    mount('/home');
    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const directNavLinks = Array.from(primaryNav.querySelectorAll(':scope > .cc-shell-nav-link'));
    const directLabels = directNavLinks.map((link) => link.textContent?.trim());
    expect(directLabels).toEqual([
      'Home',
      'My Prescriptions',
      'Upload Prescription',
      'Medicine Library',
      'Compare Medicines',
      'My Cabinet',
      'Reminders',
      'Learn & Resources',
    ]);

    // Ensure overflow menu exists for responsive screens (<1280px)
    const overflowMenu = primaryNav.querySelector('.md-overflow-menu');
    expect(overflowMenu).toBeTruthy();
    const overflowLinks = Array.from(overflowMenu!.querySelectorAll('a')).map((l) => l.textContent?.trim());
    expect(overflowLinks).toEqual(['My Cabinet', 'Reminders', 'Learn & Resources']);
  });
});
