import { lazy, Suspense, useLayoutEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LandingPage } from '../features/landing/LandingPage';
import { PublicLayout } from '../features/landing/PublicChrome';
import { AuthPage } from '../features/auth/AuthPage';
import { authScreens, type AuthScreen } from '../features/auth/auth-presentation';
import { AppShell } from './AppShell';
import { destinations } from './navigation';
import { NotFound } from './SectionPlaceholder';
import { DemoProvider } from '../features/demo/DemoProvider';
import { DemoWorkspace } from '../features/demo/DemoWorkspace';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { PrescriptionHistoryPage } from '../features/prescriptions/PrescriptionHistoryPage';
import { PrescriptionResultsPage } from '../features/prescriptions/PrescriptionResultsPage';

const ProcessingRpcTestPanel = import.meta.env.DEV
  ? lazy(() => import('../features/dev/ProcessingRpcTestPanel'))
  : null;
const FictionalIntelligenceDemo = import.meta.env.DEV
  ? lazy(() => import('../features/dev/FictionalIntelligenceDemo'))
  : null;

export function AppRoutes() {
  return (
    <>
    <RouteFocus />
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<LandingPage />} />
      </Route>
      <Route path="get-started" element={<Navigate replace to="/sign-up" />} />
      {(Object.keys(authScreens) as AuthScreen[]).map((screen) => <Route key={screen} path={screen} element={<AuthPage key={screen} screen={screen} />} />)}
      <Route element={<ProtectedRoute />}>
       {ProcessingRpcTestPanel ? <Route path="__dev/processing-rpc-test" element={<Suspense fallback={<main tabIndex={-1}><p>Loading local test panel…</p></main>}><ProcessingRpcTestPanel /></Suspense>} /> : null}
       {FictionalIntelligenceDemo ? <Route path="__dev/fictional-intelligence" element={<Suspense fallback={<main tabIndex={-1}><p>Loading fictional fixture…</p></main>}><FictionalIntelligenceDemo /></Suspense>} /> : null}
       <Route element={<DemoProvider><AppShell /></DemoProvider>}>
        {destinations.map((destination) => <Route key={destination.path} path={destination.path} element={<DemoWorkspace key={destination.path} path={destination.path} />} />)}
        <Route path="prescriptions" element={<PrescriptionHistoryPage />} />
        <Route path="prescriptions/:id" element={<PrescriptionResultsPage />} />
       </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  );
}

// Covers public/workspace transitions; the established shell keeps its own title handling.
function RouteFocus() {
  const location = useLocation();
  const previous = useRef(location.pathname);
  useLayoutEffect(() => {
    const changed = previous.current !== location.pathname;
    previous.current = location.pathname;
    if (!changed && (location.pathname !== '/' || !location.hash)) return;
    const frame = requestAnimationFrame(() => {
      const section = location.pathname === '/' && location.hash ? document.getElementById(location.hash.slice(1)) : null;
      const target = section ?? document.querySelector<HTMLElement>('main');
      target?.focus();
      if (section) section.scrollIntoView();
      else window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.hash, location.key]);
  return null;
}

export function App() { return <BrowserRouter><AppRoutes /></BrowserRouter>; }
