import { Button } from '../../components/ui';
import type { AuthScreen } from './auth-presentation';

// Original CampusConnect multicolor Google mark; no OAuth dependency.
function GoogleMark({ compact }: { readonly compact: boolean }) {
  return (
    <svg aria-hidden="true" className={compact ? 'size-4' : 'size-5'} viewBox="0 0 24 24">
      <path
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.41Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.98-.9 6.63-2.36l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.39 13.93A6.02 6.02 0 0 1 6.07 12c0-.67.12-1.32.32-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.63.39 3.17 1.04 4.55l3.35-2.62Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.94c1.47 0 2.79.5 3.82 1.5l2.88-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"
        fill="#EA4335"
      />
    </svg>
  );
}


export function AuthGooglePresentation({ screen, onUnavailable }: { readonly screen: AuthScreen; readonly onUnavailable: () => void }) {
 const login = screen === 'sign-in';
 return <>
  <Button aria-describedby="auth-preview" className={login ? 'cc-login-action cc-login-google' : 'md-auth-google'} onClick={onUnavailable} type="button" variant="secondary"><GoogleMark compact={!login} /><span>Continue with Google</span></Button>
  {login ? <div className="cc-login-divider" role="separator"><span /><small>or continue with email</small><span /></div> : <div className="md-auth-divider" role="separator"><span /><span>or continue with email</span><span /></div>}
 </>;
}
