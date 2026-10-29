import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { PublicThemeToggle } from '../../components/PublicThemeToggle';
import { safetyDisclaimer } from './landing-content';
import './landing.css';

const publicLinks = [
  { path: '/#product', label: 'Features' },
  { path: '/#how-it-works', label: 'How it works' },
  { path: '/#trust', label: 'Responsible use' },
] as const;

export function PublicBrand() {
  return <Link aria-label="MedDecode home" className="cc-public-brand" to="/"><span aria-hidden="true" className="cc-public-brand-mark"><span>M</span></span><span className="md-public-wordmark">MedDecode</span></Link>;
}

// Source: CampusConnect PublicChrome. One shared theme control replaces duplicated toggles.
function PublicHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const header = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const closeMenu = () => setOpen(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 16);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  useEffect(() => {
    if (!open) return;
    header.current?.querySelector<HTMLAnchorElement>('.cc-public-mobile-nav > a')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      menuButton.current?.focus();
    };
    const closeOutside = (event: PointerEvent) => {
      if (!header.current?.contains(event.target as Node)) setOpen(false);
    };
    const desktop = window.matchMedia('(min-width: 1100px)');
    const resize = () => {
      if (!desktop.matches) return;
      setOpen(false);
      header.current?.querySelector<HTMLAnchorElement>('.cc-public-brand')?.focus();
    };
    desktop.addEventListener('change', resize);
    window.addEventListener('keydown', close);
    window.addEventListener('pointerdown', closeOutside);
    return () => {
      desktop.removeEventListener('change', resize);
      window.removeEventListener('keydown', close);
      window.removeEventListener('pointerdown', closeOutside);
    };
  }, [open]);
  return (
    <header className={`cc-public-header${scrolled ? ' cc-public-header--scrolled' : ''}`} ref={header}
      onBlurCapture={(event) => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) closeMenu(); }}>
      <div className="cc-public-header-inner">
        <PublicBrand />
        <nav aria-label="Public navigation" className="cc-public-desktop-nav">
          {publicLinks.map((item) => <Link className="cc-public-nav-link" key={item.path} to={item.path} aria-current={location.pathname === '/' && location.hash === item.path.slice(1) ? 'location' : undefined}>{item.label}</Link>)}
        </nav>
        <div className="md-public-actions">
          <PublicThemeToggle />
          <div className="cc-public-desktop-actions"><Link className="cc-public-signin" to="/sign-in">Sign In</Link><Link className="cc-public-get-started" to="/get-started">Get Started</Link></div>
          <button aria-expanded={open} aria-controls="public-mobile-navigation" aria-label={open ? 'Close Explore menu' : 'Open Explore menu'} className="cc-public-menu-trigger" onClick={() => setOpen((value) => !value)} ref={menuButton} type="button"><Icon name={open ? 'close' : 'dashboard'} /><span>{open ? 'Close' : 'Explore'}</span></button>
        </div>
      </div>
      {open ? <nav aria-label="Mobile public navigation" className="cc-public-mobile-nav" id="public-mobile-navigation">
        {publicLinks.map((item) => <Link key={item.path} to={item.path} onClick={closeMenu}>{item.label}</Link>)}
        <div className="cc-public-mobile-cta"><Link className="cc-public-signin" onClick={closeMenu} to="/sign-in">Sign In</Link><Link className="cc-public-get-started" onClick={closeMenu} to="/get-started">Get Started</Link></div>
      </nav> : null}
    </header>
  );
}

function PublicFooter() {
  return <footer className="cc-public-footer"><div className="cc-public-footer-inner">
    <div><PublicBrand /><p>Intelligence Behind Every Prescription</p><p className="md-footer-disclaimer">{safetyDisclaimer}</p></div>
    <nav aria-label="Footer navigation" className="cc-public-footer-nav">
      <div><strong>Explore</strong>{publicLinks.map((item) => <Link key={item.path} to={item.path}>{item.label}</Link>)}</div>
      <div><strong>Access</strong><Link to="/get-started">Get Started</Link><Link to="/sign-in">Sign In</Link><Link to="/home">Workspace preview</Link></div>
      <div><strong>Learning</strong><Link to="/learn-resources">Learn &amp; Resources preview</Link><p>Educational resources are planned.</p></div>
    </nav>
  </div></footer>;
}

export function PublicLayout() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    document.title = 'MedDecode | Intelligence Behind Every Prescription';
  }, [pathname]);
  return <div className="cc-public-page cc-landing-page"><a className="cc-skip-link" href="#main-content">Skip to main content</a><PublicHeader /><main id="main-content" tabIndex={-1}><Outlet /></main><PublicFooter /></div>;
}
