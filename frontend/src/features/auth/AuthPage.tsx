import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ThemeControl } from '../../components/ThemeControl';
import { PublicBrand } from '../landing/PublicChrome';
import { AuthRibbon } from './AuthRibbon';
import { AuthField } from './AuthField';
import { authFieldError, authScreens, type AuthFieldName, type AuthScreen, type AuthValues } from './auth-presentation';
import './auth.css';

// CampusConnect LoginStory and PremiumAuthLayout, with MedDecode presentation only.
function AuthLayout({ screen, children }: { readonly screen: AuthScreen; readonly children: ReactNode }) {
  const content = authScreens[screen];
  return <main className={`cc-login-page${screen === 'sign-up' ? ' cc-auth-premium-page--register' : ''}`} id="main-content" tabIndex={-1}>
    <a className="cc-skip-link" href="#auth-form">Skip to form</a>
    <section aria-label="MedDecode introduction" className="cc-login-story">
      <PublicBrand />
      <div className="cc-login-story-copy"><p className="cc-login-story-title">A clearer way to understand.</p><p>Medicine information, made easier to understand.</p></div>
      <AuthRibbon />
    </section>
    <section className="cc-login-panel" aria-labelledby="auth-page-title" id="auth-form" tabIndex={-1}>
      <div className="cc-login-panel-top"><span className="cc-login-mobile-brand"><PublicBrand /></span><ThemeControl compact /></div>
      <div className="cc-login-form-wrap">
        <p className="cc-login-kicker">MedDecode account access</p><h1 id="auth-page-title">{content.title}</h1><p className="cc-login-intro">{content.description}</p>
        <p className="md-auth-preview" id="auth-preview">Presentation preview. Account actions are not connected. Nothing is sent.</p>
        <div className="cc-login-form-body">{children}</div>
      </div>
      <p className="cc-login-security"><Icon name="copy" className="size-4" />Authentication integration is coming next.</p>
    </section>
  </main>;
}

export function AuthPage({ screen }: { readonly screen: AuthScreen }) {
  const [values, setValues] = useState<AuthValues>({ fullName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Partial<Record<AuthFieldName, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<AuthFieldName, boolean>>>({});
  const [feedback, setFeedback] = useState<'invalid' | 'unavailable' | null>(null);
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

  return <AuthLayout screen={screen}>
    {feedback === 'invalid' ? <p className="md-auth-feedback" role="alert">Please check the highlighted fields.</p> : null}
    <div className="md-auth-announcement" role="status" aria-live="polite" aria-atomic="true">{feedback === 'unavailable' ? <p className="md-auth-feedback">{content.unavailable}</p> : null}</div>
    <form ref={form} noValidate onSubmit={submit} aria-label={content.pageTitle} aria-describedby="auth-preview">
      {content.fields.map((field) => <AuthField key={field} field={field} screen={screen} value={values[field]} error={errors[field]} onChange={(value) => change(field, value)} onBlur={() => blur(field)} />)}
      <Button type="submit" className="cc-login-action cc-login-submit">{content.action}</Button>
    </form>
    <div className="cc-login-register">
      {screen === 'sign-in' ? <p>New to MedDecode? <Link to="/sign-up">Create an account</Link></p> : <Link to="/sign-in">Back to Sign In</Link>}
      {screen === 'reset-password' ? <Link to="/forgot-password">Recovery request preview</Link> : null}
      <Link to="/">Back to MedDecode</Link>
    </div>
  </AuthLayout>;
}
