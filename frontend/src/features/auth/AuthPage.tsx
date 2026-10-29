import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PublicThemeToggle } from '../../components/PublicThemeToggle';
import { PublicBrand } from '../landing/PublicChrome';
import { AuthRibbon } from './AuthRibbon';
import { AuthField } from './AuthField';
import { AuthGooglePresentation } from './AuthGooglePresentation';
import { authFieldError, authScreens, type AuthFieldName, type AuthScreen, type AuthValues } from './auth-presentation';
import './auth.css';

// CampusConnect LoginStory and PremiumAuthLayout, with MedDecode presentation only.
function AuthLayout({ screen, children, announcement }: { readonly screen: AuthScreen; readonly children: ReactNode; readonly announcement: string }) {
 const content = authScreens[screen];
 const story = screen === 'sign-up' ? ['Your medicine journey starts here.', 'One place to understand prescriptions and keep medicine information organized.'] : screen === 'forgot-password' ? ["Let's get you back in.", 'A simple step back to your MedDecode account.'] : screen === 'reset-password' ? ['A fresh start, made simple.', 'Return to your prescriptions and medicine information.'] : ['A clearer way to understand.', 'Your prescriptions and medicine information, made easier to understand.'];
 return <main className={`cc-login-page${screen === 'sign-in' ? '' : ' cc-auth-premium-page'}${screen === 'sign-up' ? ' cc-auth-premium-page--register' : ''}`} id="main-content" tabIndex={-1}>
  <a className="cc-skip-link" href="#auth-form">Skip to form</a>
  <section aria-label="MedDecode introduction" className="cc-login-story">
   <PublicBrand /><div className="cc-login-story-copy"><p className="cc-login-story-title">{story[0]}</p><p>{story[1]}</p></div><AuthRibbon />
  </section>
  <section className={`cc-login-panel${screen === 'sign-in' ? '' : ' cc-auth-premium-panel'}`} aria-labelledby="auth-page-title" id="auth-form" tabIndex={-1}>
   <div className="cc-login-panel-top"><span className="cc-login-mobile-brand"><PublicBrand /></span><PublicThemeToggle /></div>
   <div className={`cc-login-form-wrap${screen === 'sign-in' ? '' : ' cc-auth-premium-form'}`}>
    <p className="cc-login-kicker">MedDecode access</p><h1 id="auth-page-title">{content.title}</h1><p className="cc-login-intro">{content.description}</p>
    <div className="cc-login-form-body">{children}</div>
   </div>
   <div className="cc-login-security"><span id="auth-preview"><Icon name="shield" className="size-4" /> Account access is not connected yet.</span><Link to="/">Back to MedDecode</Link><span className="md-auth-announcement" role="status" aria-live="polite" aria-atomic="true">{announcement}</span></div>
  </section>
 </main>;
}

export function AuthPage({ screen }: { readonly screen: AuthScreen }) {
  const [values, setValues] = useState<AuthValues>({ fullName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Partial<Record<AuthFieldName, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<AuthFieldName, boolean>>>({});
  const [feedback, setFeedback] = useState<'invalid' | 'unavailable' | 'google' | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const content = authScreens[screen];
  useLayoutEffect(() => { document.title = `${content.pageTitle} | MedDecode`; }, [content.pageTitle]);

  const change = (field: AuthFieldName, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    setFeedback(null);
    setErrors((current) => {
      const updated = { ...current };
      if (touched[field] || current[field]) updated[field] = authFieldError(screen, field, next);
      if (field === 'password' && (touched.confirmPassword || current.confirmPassword)) updated.confirmPassword = authFieldError(screen, 'confirmPassword', next);
      return updated;
    });
  };
  const blur = (field: AuthFieldName) => {
    setTouched((current) => ({ ...current, [field]: true }));
    setErrors((current) => ({ ...current, [field]: authFieldError(screen, field, values) }));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Partial<Record<AuthFieldName, string>> = {};
    for (const field of content.fields) next[field] = authFieldError(screen, field, values);
    setErrors(next);
    setTouched(Object.fromEntries(content.fields.map((field) => [field, true])));
    const firstInvalid = content.fields.find((field) => next[field]);
    if (firstInvalid) {
      setFeedback('invalid');
      (form.current?.elements.namedItem(firstInvalid) as HTMLInputElement | null)?.focus();
    } else setFeedback('unavailable');
  };

  return <AuthLayout screen={screen} announcement={feedback === 'unavailable' ? content.unavailable : feedback === 'google' ? 'Google sign-in is not connected yet. Nothing was sent.' : ''}>
    {feedback === 'invalid' ? <p className="md-auth-feedback" role="alert">Please check the highlighted fields.</p> : null}
    {screen === 'sign-in' || screen === 'sign-up' ? <AuthGooglePresentation screen={screen} onUnavailable={() => setFeedback('google')} /> : null}
    <form ref={form} noValidate onSubmit={submit} aria-label={content.pageTitle} aria-describedby="auth-preview">
      {content.fields.map((field) => <AuthField key={field} field={field} screen={screen} value={values[field]} error={errors[field]} onChange={(value) => change(field, value)} onBlur={() => blur(field)} />)}
      <Button type="submit" className="cc-login-action cc-login-submit">{content.action}</Button>
    </form>
    {screen === 'sign-in' ? <p className="cc-login-register">New to MedDecode? <Link to="/sign-up">Create an account</Link></p> : screen === 'sign-up' ? <p className="md-auth-secondary">Already registered? <Link to="/sign-in">Back to Sign In</Link></p> : <Link className="cc-login-recovery-link" to="/sign-in">Back to Sign In</Link>}
    {screen === 'reset-password' ? <Link className="cc-login-recovery-link" to="/forgot-password">Recovery request preview</Link> : null}
  </AuthLayout>;
}
