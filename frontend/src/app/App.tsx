import { lazy, Suspense, useLayoutEffect, useRef, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { LandingPage } from '../features/landing/LandingPage';
import { PublicLayout } from '../features/landing/PublicChrome';
import { AuthPage } from '../features/auth/AuthPage';
import { authScreens, type AuthScreen } from '../features/auth/auth-presentation';
import { AppShell } from './AppShell';
import { destinations } from './navigation';
import { NotFound } from './SectionPlaceholder';
import { DemoProvider } from '../features/demo/DemoProvider';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { WorkspacePage } from './WorkspacePage';
import { RouteLoadingState } from './RouteLoadingState';

const DemoWorkspaceRoute = lazy(() => import('../features/demo/DemoWorkspaceRoute').then((module) => ({ default: module.DemoWorkspaceRoute })));
const PrescriptionHistoryPage = lazy(() => import('../features/prescriptions/PrescriptionHistoryPage').then((module) => ({ default: module.PrescriptionHistoryPage })));
const PrescriptionResultsPage = lazy(() => import('../features/prescriptions/PrescriptionResultsPage').then((module) => ({ default: module.PrescriptionResultsPage })));
const PrescriptionReviewWorkspace = lazy(() => import('../features/prescription-review/PrescriptionReviewWorkspace').then((module) => ({ default: module.PrescriptionReviewWorkspace })));
const AccountPage = lazy(() => import('../features/profile/AccountPage').then((module) => ({ default: module.AccountPage })));

const ProcessingRpcTestPanel = import.meta.env.DEV
  ? lazy(() => import('../features/dev/ProcessingRpcTestPanel'))
  : null;
const FictionalIntelligenceDemo = import.meta.env.DEV
  ? lazy(() => import('../features/dev/FictionalIntelligenceDemo'))
  : null;

function MedicineInsightsRedirect() {
  const location = useLocation();
  return <Navigate to={`/medicine-library${location.search}`} replace />;
}

function DeferredRoute({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return (
    <Suspense fallback={<RouteLoadingState label={label} />}>
      {children}
    </Suspense>
  );
}

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
      <Route element={<DemoProvider><Outlet /></DemoProvider>}>
       <Route path="demo" element={<Navigate replace to="/demo/home" />} />
       <Route path="demo/:section" element={<DeferredRoute label="demonstration workspace"><DemoWorkspaceRoute /></DeferredRoute>} />
      </Route>
      <Route element={<ProtectedRoute />}>
       {ProcessingRpcTestPanel ? <Route path="__dev/processing-rpc-test" element={<Suspense fallback={<main tabIndex={-1}><RouteLoadingState label="local test panel" /></main>}><ProcessingRpcTestPanel /></Suspense>} /> : null}
       {FictionalIntelligenceDemo ? <Route path="__dev/fictional-intelligence" element={<Suspense fallback={<main tabIndex={-1}><RouteLoadingState label="fictional fixture" /></main>}><FictionalIntelligenceDemo /></Suspense>} /> : null}
       <Route element={<AppShell />}>
        {destinations.filter((d) => d.path !== '/prescriptions').map((destination) => <Route key={destination.path} path={destination.path} element={<WorkspacePage key={destination.path} path={destination.path} />} />)}
        <Route path="prescriptions" element={<DeferredRoute label="prescription history"><PrescriptionHistoryPage /></DeferredRoute>} />
        <Route path="prescriptions/:id" element={<DeferredRoute label="prescription analysis"><PrescriptionResultsPage /></DeferredRoute>} />
        <Route path="prescriptions/:id/review" element={<DeferredRoute label="prescription review"><PrescriptionReviewWorkspace /></DeferredRoute>} />
        <Route path="account" element={<DeferredRoute label="account information"><AccountPage /></DeferredRoute>} />
        <Route path="medicine-insights" element={<MedicineInsightsRedirect />} />
        <Route path="cabinet" element={<Navigate replace to="/my-cabinet" />} />
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
