import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuthFieldName, AuthScreen } from './auth-presentation';

// SVG and control treatment selected from CampusConnect LoginForm.tsx.
function PasswordVisibilityIcon({ visible }: { readonly visible: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24">{visible ? <>
    <path d="M3 3l18 18" />
    <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.5 10.5 0 0 1 12 4c5.5 0 9 5.1 9 8a10.8 10.8 0 0 1-2 3.8M6.6 6.6C4.3 8.1 3 10.4 3 12c0 2.9 3.5 8 9 8 1.4 0 2.7-.3 3.8-.8" />
  </> : <><path d="M3 12c0-2.9 3.5-8 9-8s9 5.1 9 8-3.5 8-9 8-9-5.1-9-8Z" /><circle cx="12" cy="12" r="3" /></>}</svg>;
}

export function AuthField({ field, screen, value, error, onChange, onBlur }: {
  readonly field: AuthFieldName;
  readonly screen: AuthScreen;
  readonly value: string;
  readonly error?: string;
  readonly onChange: (value: string) => void;
  readonly onBlur: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const isPassword = field === 'password' || field === 'confirmPassword';
  const label = field === 'fullName' ? 'Full name' : field === 'email' ? 'Email address' : field === 'confirmPassword' ? (screen === 'reset-password' ? 'Confirm new password' : 'Confirm password') : screen === 'reset-password' ? 'New password' : 'Password';
  const id = `auth-${field}`;
  const policyHint = field === 'password' && screen !== 'sign-in';
  const descriptions = [policyHint ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const input = <input
    className={screen === 'sign-in' ? undefined : 'cc-field'} id={id} name={field} value={value} required
    type={isPassword ? (visible ? 'text' : 'password') : field === 'email' ? 'email' : 'text'}
    autoComplete={field === 'fullName' ? 'name' : field === 'email' ? 'email' : screen === 'sign-in' ? 'current-password' : 'new-password'}
    placeholder={field === 'email' && screen === 'sign-in' ? 'you@example.com' : undefined}
    autoCapitalize={field === 'fullName' ? 'words' : 'none'} spellCheck={false}
    minLength={policyHint ? 8 : undefined} maxLength={isPassword && screen !== 'sign-in' ? 128 : undefined}
    aria-invalid={Boolean(error)} aria-describedby={descriptions}
    onChange={(event) => onChange(event.target.value)} onBlur={onBlur}
  />;
  return <div className={screen === 'sign-in' ? 'cc-login-field-group' : 'cc-login-field-group cc-label'}>
    {field === 'password' && screen === 'sign-in' ? <div className="cc-login-label-row"><label htmlFor={id}>{label}</label><Link to="/forgot-password">Forgot password?</Link></div> : <label htmlFor={id}>{label}</label>}
    {isPassword ? <div className="cc-login-password-field">{input}<button
      type="button" className="cc-login-password-toggle" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
      aria-pressed={visible} aria-controls={id} onClick={() => setVisible((current) => !current)}
    ><PasswordVisibilityIcon visible={visible} /></button></div> : input}
    {policyHint ? <p className="md-auth-help" id={`${id}-help`}>Use 8–128 characters.<span className="sr-only"> Client preview only. The final policy will be confirmed during integration.</span></p> : null}
    {error ? <p className="cc-login-field-error" id={`${id}-error`}>{error}</p> : null}
  </div>;
}
