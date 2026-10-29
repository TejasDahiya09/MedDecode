import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../src/app/App';
import { AppProviders } from '../../src/providers/AppProviders';
import { authFieldError, authScreens, type AuthScreen } from '../../src/features/auth/auth-presentation';

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
function mount(path: string) { return render(<AppProviders><MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter></AppProviders>); }
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } }); }
function fill(kind: AuthScreen) {
  if (kind === 'sign-up') change('Full name', 'Preview Reader');
  if (kind !== 'reset-password') change('Email address', 'preview@example.test');
  if (kind !== 'forgot-password') change(kind === 'reset-password' ? 'New password' : 'Password', 'Preview-only-42!');
  if (kind === 'sign-up' || kind === 'reset-password') change(kind === 'reset-password' ? 'Confirm new password' : 'Confirm password', 'Preview-only-42!');
}

it.each(Object.keys(authScreens) as AuthScreen[])('%s renders explicit labels, autocomplete and no initial errors', (kind) => {
  mount('/' + kind);
  const config = authScreens[kind];
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(config.title);
  expect(document.title).toBe(`${config.pageTitle} | MedDecode`);
  const form = screen.getByRole('form', { name: config.pageTitle });
  expect(form.querySelectorAll('input')).toHaveLength(config.fields.length);
  for (const field of config.fields) {
    const input = form.querySelector<HTMLInputElement>(`[name="${field}"]`)!;
    expect(document.querySelector(`label[for="${input.id}"]`)).toBeTruthy();
    expect(input.required).toBe(true);
    expect(input.autocomplete).toBe(field === 'fullName' ? 'name' : field === 'email' ? 'email' : kind === 'sign-in' ? 'current-password' : 'new-password');
    expect(input.type).toBe(field === 'email' ? 'email' : field === 'fullName' ? 'text' : 'password');
  }
  expect(screen.queryByRole('alert')).toBeNull();
  expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).toBeNull();
});

it.each(Object.keys(authScreens) as AuthScreen[])('%s announces invalid submission and focuses the first invalid field', (kind) => {
  mount('/' + kind);
  fireEvent.submit(screen.getByRole('form'));
  expect(screen.getByRole('alert').textContent).toBe('Please check the highlighted fields.');
  const invalid = [...document.querySelectorAll<HTMLInputElement>('[aria-invalid="true"]')];
  expect(invalid).toHaveLength(authScreens[kind].fields.length);
  expect(document.activeElement).toBe(invalid[0]);
  for (const input of invalid) {
    const ids = input.getAttribute('aria-describedby')!.split(' ');
    expect(ids.every((id) => document.getElementById(id))).toBe(true);
  }
});

it.each(Object.keys(authScreens) as AuthScreen[])('%s submits only an honest unavailable message without requests or persistence', (kind) => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const network = vi.spyOn(XMLHttpRequest.prototype, 'send');
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  const log = vi.spyOn(console, 'log');
  mount('/' + kind); fill(kind);
  fireEvent.submit(screen.getByRole('form'));
  expect(screen.getByRole('status').textContent).toBe(authScreens[kind].unavailable);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(fetch).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});

it('validates after interaction, keeps input, and clears corrected errors', () => {
  mount('/sign-up');
  change('Full name', 'Preview Reader'); change('Email address', 'invalid');
  fireEvent.blur(screen.getByLabelText('Email address'));
  expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  change('Password', 'short'); change('Confirm password', 'different');
  fireEvent.submit(screen.getByRole('form'));
  expect(screen.getByText('Use 8–128 characters for this preview.', { selector: '.cc-login-field-error' })).toBeTruthy();
  expect(screen.getByText('Passwords do not match.')).toBeTruthy();
  change('Email address', 'preview@example.test'); change('Password', 'Preview-only-42!'); change('Confirm password', 'Preview-only-42!');
  expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe('Preview Reader');
  change('Password', 'Different-preview-42!');
  expect(screen.getByText('Passwords do not match.')).toBeTruthy();
  change('Confirm password', 'Different-preview-42!');
  expect(screen.queryByText('Passwords do not match.')).toBeNull();
});

it('rejects whitespace-only identity fields and documents a provisional password baseline', () => {
  const values = { fullName: ' ', email: ' ', password: 'a'.repeat(129), confirmPassword: '' };
  expect(authFieldError('sign-up', 'fullName', values)).toBe('Enter your full name.');
  expect(authFieldError('sign-up', 'email', values)).toBe('Enter your email address.');
  expect(authFieldError('reset-password', 'password', values)).toBe('Use 8–128 characters for this preview.');
  expect(authFieldError('sign-in', 'password', { ...values, password: 'x' })).toBeUndefined();
});

it('password visibility toggles retain values, have accessible state and never submit', () => {
  mount('/reset-password');
  change('New password', 'Preview-only-42!'); change('Confirm new password', 'Preview-only-42!');
  const toggle = screen.getByRole('button', { name: 'Show new password' });
  fireEvent.click(toggle);
  expect((screen.getByLabelText('New password', { exact: true }) as HTMLInputElement).type).toBe('text');
  expect(screen.getByRole('button', { name: 'Hide new password' }).getAttribute('aria-pressed')).toBe('true');
  expect((screen.getByLabelText('Confirm new password', { exact: true }) as HTMLInputElement).type).toBe('password');
  expect(screen.getByRole('status').textContent).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Hide new password' }));
  expect((screen.getByLabelText('New password', { exact: true }) as HTMLInputElement).value).toBe('Preview-only-42!');
});

it('navigates between forms and clears ephemeral values when leaving a form', () => {
  mount('/sign-in'); change('Password', 'Preview-only-42!');
  fireEvent.click(screen.getByRole('link', { name: 'Forgot password?' }));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Let's get you back in.");
  fireEvent.click(screen.getByRole('link', { name: 'Back to Sign In' }));
  expect((screen.getByLabelText('Password', { exact: true }) as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('link', { name: 'Create an account' }));
  expect(screen.getByLabelText('Full name')).toBeTruthy();
});

it('uses existing theme controls without discarding form values', () => {
  mount('/sign-in'); change('Email address', 'preview@example.test');
  for (const theme of ['dark', 'light', 'system']) {
    fireEvent.click(screen.getByRole('button', { name: /Theme preference:/ }));
    fireEvent.click(screen.getByRole('button', { name: `Use ${theme} theme` }));
    expect(localStorage.getItem('meddecode-theme')).toBe(theme);
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('preview@example.test');
  }
});

it('renders reset UI without processing recovery query or fragment values', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const reads = vi.spyOn(Storage.prototype, 'getItem');
  mount('/reset-password?token=synthetic-not-consumed#access_token=synthetic-not-consumed');
  expect(screen.getByLabelText('New password', { exact: true })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  expect(reads.mock.calls.every(([key]) => key === 'meddecode-theme')).toBe(true);
});
