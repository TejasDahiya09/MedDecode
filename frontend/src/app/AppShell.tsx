import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { RouteSearch, WorkspaceHeader } from './WorkspaceHeader';
import { cn } from '../utils/class-names';
import { destinations, mobileDestinations } from './navigation';
import './app-shell.css';

// Adapted from CampusConnect AppShell focus helpers and ExploreSheet.
const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function NavigationLinks({ onNavigate }: { readonly onNavigate?: () => void }) {
  return destinations.map((item) => (
    <NavLink key={item.path} to={item.path} end onClick={onNavigate} className={({ isActive }) => cn('cc-explore-link', isActive && 'is-active')}>
      <span className="cc-explore-icon"><Icon className="size-5" name={item.icon} /></span>
      <span><strong>{item.label}</strong><small>{item.description}</small></span>
    </NavLink>
  ));
}

function ExploreSheet({ onClose, triggerRef }: { readonly onClose: () => void; readonly triggerRef: RefObject<HTMLButtonElement | null> }) {
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    const restoreFocus = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(focusableSelector)?.focus());
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter((element) => !element.hidden);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const desktop = matchMedia('(min-width: 1120px)');
    const resize = (event: MediaQueryListEvent) => { if (event.matches) onClose(); };
    desktop.addEventListener('change', resize);
    window.addEventListener('keydown', keyboard);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener('change', resize);
      window.removeEventListener('keydown', keyboard);
      // A completed navigation schedules main focus after this cleanup.
      if (restoreFocus?.isConnected && restoreFocus.getClientRects().length) restoreFocus.focus();
    };
  }, [onClose, triggerRef]);

  return (
    <div className="cc-explore-backdrop">
      <div className="cc-explore-scrim" aria-hidden="true" onClick={onClose} />
      <section className="cc-explore-sheet" id="workspace-navigation" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel}>
        <header className="cc-explore-header">
          <div><p className="cc-eyebrow">MedDecode workspace</p><h2 id={titleId}>Explore MedDecode</h2></div>
          <button className="cc-button cc-button--ghost md-close" type="button" aria-label="Close navigation" onClick={onClose}><Icon className="size-5" name="close" /></button>
        </header>
        <div className="cc-explore-body"><div className="md-mobile-search"><RouteSearch /></div><nav aria-label="All sections"><NavigationLinks onNavigate={onClose} /></nav></div>
      </section>
    </div>
  );
}

export function AppShell() {
  const [drawer, setDrawer] = useState<'header' | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const main = useRef<HTMLElement>(null);
  const location = useLocation();
  const destination = destinations.find((item) => item.path === location.pathname);
  let title = destination?.label;
  if (!title) {
    if (location.pathname === '/prescriptions') {
      title = 'Prescription History';
    } else if (location.pathname.startsWith('/prescriptions/')) {
      title = 'Prescription Analysis';
    } else {
      title = 'Page not found';
    }
  }
  // A stable setter avoids re-subscribing the drawer during unrelated provider updates.
  const close = useCallback(() => setDrawer(null), []);
  const previousPath = useRef<string | null>(null);
  useLayoutEffect(() => {
    document.title = `${title} | MedDecode`;
    const changed = previousPath.current !== null && previousPath.current !== location.pathname;
    previousPath.current = location.pathname;
    if (changed) close();
    if (!changed) return;
    const frame = requestAnimationFrame(() => { main.current?.focus(); window.scrollTo(0, 0); });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, title, close]);
  function open(event: MouseEvent<HTMLButtonElement>, source: 'header') { trigger.current = event.currentTarget; setDrawer(source); }

  return (
    <div className="cc-app-shell">
      <div className="md-shell-background" inert={drawer !== null}>
        <a className="cc-skip-link" href="#main-content">Skip to main content</a>
        <WorkspaceHeader onExplore={(event) => open(event, 'header')} expanded={drawer === 'header'} />
        <main className="md-main" id="main-content" aria-label={title} tabIndex={-1} ref={main}><Outlet /></main>
        <nav className="cc-mobile-nav" aria-label="Mobile navigation">
          {mobileDestinations.map((item) => <NavLink key={item.path} to={item.path} end className={({ isActive }) => cn('cc-mobile-nav-link', isActive && 'cc-mobile-nav-link--active')}><Icon className="size-5" name={item.icon} /><span>{item.label}</span></NavLink>)}

        </nav>
      </div>
      {drawer ? <ExploreSheet onClose={close} triggerRef={trigger} /> : null}
    </div>
  );
}
