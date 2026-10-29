import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ThemeControl } from '../components/ThemeControl';
import { cn } from '../utils/class-names';
import { destinations, mobileDestinations } from './navigation';
import './app-shell.css';

// Adapted from CampusConnect AppShell focus helpers and ExploreSheet.
const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function NavigationLinks({ onNavigate }: { readonly onNavigate?: () => void }) {
  return destinations.map((item) => (
    <NavLink key={item.path} to={item.path} end onClick={onNavigate} className={({ isActive }) => cn('cc-explore-link', isActive && 'is-active')}>
      <span className="cc-explore-icon"><Icon className="size-5" name={item.icon} /></span>
      <span>{item.label}</span>
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
    const desktop = matchMedia('(min-width: 1200px)');
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
        <nav className="cc-explore-body" aria-label="All sections"><NavigationLinks onNavigate={onClose} /></nav>
      </section>
    </div>
  );
}

export function AppShell() {
  const [drawer, setDrawer] = useState<'header' | 'more' | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const main = useRef<HTMLElement>(null);
  const location = useLocation();
  const destination = destinations.find((item) => item.path === location.pathname);
  const title = destination?.label ?? 'Page not found';
  // A stable setter avoids re-subscribing the drawer during unrelated provider updates.
  const close = useCallback(() => setDrawer(null), []);
  const previousPath = useRef<string | null>(null);
  useLayoutEffect(() => {
    document.title = `${title} | MedDecode`;
    const changed = previousPath.current !== null && previousPath.current !== location.pathname;
    previousPath.current = location.pathname;
    if (!changed) return;
    const frame = requestAnimationFrame(() => { main.current?.focus(); window.scrollTo(0, 0); });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, title]);
  function open(event: MouseEvent<HTMLButtonElement>, source: 'header' | 'more') { trigger.current = event.currentTarget; setDrawer(source); }
  const inMore = !!destination && !mobileDestinations.some((item) => item.path === location.pathname);

  return (
    <div className="cc-app-shell">
      <div className="md-shell-background" inert={drawer !== null}>
        <a className="cc-skip-link" href="#main-content">Skip to main content</a>
        <header className="cc-top-nav">
          <div className="cc-top-nav-inner">
            <Link aria-label="MedDecode home" className="cc-shell-brand" to="/home"><span className="cc-shell-brand-mark">M</span><span className="cc-shell-wordmark">MedDecode</span></Link>
            <button type="button" className="cc-shell-explore-trigger md-drawer-trigger" aria-label="Explore all sections" aria-haspopup="dialog" aria-controls="workspace-navigation" aria-expanded={drawer === 'header'} onClick={(event) => open(event, 'header')}><Icon name="dashboard" /><span>Explore</span></button>
            <div className="md-header-theme"><ThemeControl compact /></div>
          </div>
        </header>
        <div className="md-layout">
          <aside className="md-sidebar"><p className="cc-eyebrow">Your workspace</p><nav aria-label="Primary navigation"><NavigationLinks /></nav><p className="md-tagline">Intelligence Behind Every Prescription</p></aside>
          <main className="md-main" id="main-content" aria-label={title} tabIndex={-1} ref={main}><Outlet /></main>
        </div>
        <nav className="cc-mobile-nav" aria-label="Mobile navigation">
          {mobileDestinations.map((item) => <NavLink key={item.path} to={item.path} end className={({ isActive }) => cn('cc-mobile-nav-link', isActive && 'cc-mobile-nav-link--active')}><Icon className="size-5" name={item.icon} /><span>{item.label}</span></NavLink>)}
          <button type="button" className={cn('cc-mobile-nav-link', inMore && 'cc-mobile-nav-link--active')} aria-label={inMore ? `More sections, current section: ${title}` : 'More sections'} aria-haspopup="dialog" aria-controls="workspace-navigation" aria-expanded={drawer === 'more'} onClick={(event) => open(event, 'more')}><Icon className="size-5" name="menu" /><span>More</span></button>
        </nav>
      </div>
      {drawer ? <ExploreSheet onClose={close} triggerRef={trigger} /> : null}
    </div>
  );
}
