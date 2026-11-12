import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Button } from '../../components/ui';
import { useAuth } from './AuthProvider';

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <main className="md-auth-route-state" aria-busy="true"><p>Verifying your MedDecode session…</p></main>;
  if (auth.status === 'unauthenticated') return <Navigate replace to="/sign-in" state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;
  if (auth.status === 'error') return <main className="md-auth-route-state"><h1>Session verification unavailable</h1><p>{auth.error}</p><Button type="button" onClick={() => void auth.retry()}>Try again</Button></main>;
  return <Outlet />;
}
