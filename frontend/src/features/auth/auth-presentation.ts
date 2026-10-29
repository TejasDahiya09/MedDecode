export type AuthScreen = 'sign-in' | 'sign-up' | 'forgot-password' | 'reset-password';
export type AuthFieldName = 'fullName' | 'email' | 'password' | 'confirmPassword';
export type AuthValues = Record<AuthFieldName, string>;

export const authScreens: Record<AuthScreen, {
  title: string;
  pageTitle: string;
  description: string;
  action: string;
  fields: readonly AuthFieldName[];
  unavailable: string;
}> = {
  'sign-in': {
    title: 'Welcome back.', pageTitle: 'Sign In',
    description: 'Sign in to continue your MedDecode experience.', action: 'Sign In',
    fields: ['email', 'password'],
    unavailable: 'Sign-in is not connected yet. No credentials were sent and no session was created.',
  },
  'sign-up': {
    title: 'Create your account.', pageTitle: 'Create Account',
    description: 'Start your MedDecode journey with the basics.', action: 'Create Account',
    fields: ['fullName', 'email', 'password', 'confirmPassword'],
    unavailable: 'Account creation is not connected yet. No details were sent and no account was created.',
  },
  'forgot-password': {
    title: "Let's get you back in.", pageTitle: 'Forgot Password',
    description: 'Enter your email address to preview the recovery request form.', action: 'Request reset link',
    fields: ['email'],
    unavailable: 'Password recovery is not connected yet. No recovery email was sent.',
  },
  'reset-password': {
    title: 'Choose a new password.', pageTitle: 'Reset Password',
    description: 'Secure recovery verification and password submission will be connected later.', action: 'Update password',
    fields: ['password', 'confirmPassword'],
    unavailable: 'Secure recovery verification and password submission are not connected yet. Your password has not changed.',
  },
};

// Provisional client-side preview baseline, not an authentication-provider policy.
export function authFieldError(screen: AuthScreen, field: AuthFieldName, values: AuthValues): string | undefined {
  const value = values[field];
  if (field === 'fullName') return value.trim() ? undefined : 'Enter your full name.';
  if (field === 'email') {
    if (!value.trim()) return 'Enter your email address.';
    // Mirrors HTML email syntax without imposing a speculative top-level-domain rule.
    return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(value.trim()) ? undefined : 'Enter a valid email address.';
  }
  if (field === 'confirmPassword') {
    if (!value) return 'Confirm your password.';
    return value === values.password ? undefined : 'Passwords do not match.';
  }
  if (!value) return screen === 'reset-password' ? 'Enter a new password.' : 'Enter your password.';
  if (screen !== 'sign-in' && (value.length < 8 || value.length > 128)) return 'Use 8–128 characters for this preview.';
  return undefined;
}
