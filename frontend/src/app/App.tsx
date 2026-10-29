import { useLayoutEffect, useRef } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LandingPage } from '../features/landing/LandingPage';
import { PublicLayout, AccessComingNext } from '../features/landing/PublicChrome';
import { AppShell } from './AppShell';
import { destinations } from './navigation';
import { NotFound, SectionPlaceholder } from './SectionPlaceholder';

export function AppRoutes() {
  return (
    <>
    <RouteFocus />
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<LandingPage />} />
        <Route path="get-started" element={<AccessComingNext intent="get-started" />} />
        <Route path="sign-in" element={<AccessComingNext intent="sign-in" />} />
      </Route>
      <Route element={<AppShell />}>
        {destinations.map((destination) => <Route key={destination.path} path={destination.path} element={<SectionPlaceholder destination={destination} />} />)}
        <Route path="*" element={<NotFound />} />
      </Route>
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
    if (!changed && !location.hash) return;
    const frame = requestAnimationFrame(() => {
      const section = location.hash ? document.getElementById(location.hash.slice(1)) : null;
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
