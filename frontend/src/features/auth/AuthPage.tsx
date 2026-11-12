import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PublicThemeToggle } from '../../components/PublicThemeToggle';
import { PublicBrand } from '../landing/PublicChrome';
import { AuthRibbon } from './AuthRibbon';
import { AuthField } from './AuthField';
import { AuthGooglePresentation } from './AuthGooglePresentation';
import { authFieldError, authScreens, type AuthFieldName, type AuthScreen, type AuthValues } from './auth-presentation';
import './auth.css';
import { useAuth } from './AuthProvider';

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
   <div className="cc-login-security"><span id="auth-preview"><Icon name="shield" className="size-4" /> Secure account access</span><Link to="/">Back to MedDecode</Link><span className="md-auth-announcement" role="status" aria-live="polite" aria-atomic="true">{announcement}</span></div>
  </section>
 </main>;
}

export function AuthPage({ screen }: { readonly screen: AuthScreen }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState<AuthValues>({ fullName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Partial<Record<AuthFieldName, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<AuthFieldName, boolean>>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
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
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Partial<Record<AuthFieldName, string>> = {};
    for (const field of content.fields) next[field] = authFieldError(screen, field, values);
    setErrors(next);
    setTouched(Object.fromEntries(content.fields.map((field) => [field, true])));
    const firstInvalid = content.fields.find((field) => next[field]);
    if (firstInvalid) {
      setFeedback('Please check the highlighted fields.');
      (form.current?.elements.namedItem(firstInvalid) as HTMLInputElement | null)?.focus();
      return;
    }
    setPending(true); setFeedback(null);
    try {
      if (screen === 'sign-in') {
        const result = await auth.signIn(values.email.trim(), values.password);
        if (!result.ok) setFeedback(result.message);
        else {
          const requested = (location.state as { from?: unknown } | null)?.from;
          navigate(typeof requested === 'string' && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/home', { replace: true });
        }
      } else if (screen === 'sign-up') {
        const result = await auth.signUp(values.email.trim(), values.password, values.fullName.trim());
        if (!result.ok) setFeedback(result.message);
        else if (result.confirmationRequired) setFeedback('Check your email to confirm your account, then return to sign in.');
        else navigate('/home', { replace: true });
      } else if (screen === 'forgot-password') {
        const result = await auth.requestPasswordReset(values.email.trim());
        setFeedback(result.ok ? 'If the account exists, a recovery email has been requested.' : result.message);
      } else {
        const result = await auth.updatePassword(values.password);
        if (!result.ok) setFeedback(result.message); else { setFeedback('Password updated. You can continue to your workspace.'); navigate('/home', { replace: true }); }
      }
    } finally { setPending(false); }
  };

  return <AuthLayout screen={screen} announcement={feedback ?? ''}>
    {feedback ? <p className="md-auth-feedback" role="alert">{feedback}</p> : null}
    {screen === 'sign-in' || screen === 'sign-up' ? <AuthGooglePresentation screen={screen} onUnavailable={() => setFeedback('Google sign-in is not enabled. Use email and password.')} /> : null}
    <form ref={form} noValidate onSubmit={submit} aria-label={content.pageTitle} aria-describedby="auth-preview">
      {content.fields.map((field) => <AuthField key={field} field={field} screen={screen} value={values[field]} error={errors[field]} onChange={(value) => change(field, value)} onBlur={() => blur(field)} />)}
      <Button type="submit" className="cc-login-action cc-login-submit" disabled={pending}>{pending ? 'Please wait…' : content.action}</Button>
    </form>
    {screen === 'sign-in' ? <p className="cc-login-register">New to MedDecode? <Link to="/sign-up">Create an account</Link></p> : screen === 'sign-up' ? <p className="md-auth-secondary">Already registered? <Link to="/sign-in">Back to Sign In</Link></p> : <Link className="cc-login-recovery-link" to="/sign-in">Back to Sign In</Link>}
    {screen === 'reset-password' ? <Link className="cc-login-recovery-link" to="/forgot-password">Recovery request preview</Link> : null}
  </AuthLayout>;
}
