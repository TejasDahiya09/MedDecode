import { useState, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './ThemeProvider';
import { AuthProvider } from '../features/auth/AuthProvider';
import type { AuthSession, BrowserAuthClient } from '../features/auth/auth-client';

export function AppProviders({ children, authClient, initialAuthSession }: PropsWithChildren<{ authClient?: BrowserAuthClient; initialAuthSession?: AuthSession | null }>) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } },
  }));
  return <ThemeProvider><QueryClientProvider client={queryClient}><AuthProvider client={authClient} initialSession={initialAuthSession}>{children}</AuthProvider></QueryClientProvider></ThemeProvider>;
}
