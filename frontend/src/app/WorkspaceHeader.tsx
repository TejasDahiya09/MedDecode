import { useEffect, useId, useRef, useState, type MouseEvent, type PropsWithChildren } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { PublicThemeToggle } from '../components/PublicThemeToggle';
import { destinations } from './navigation';
import { useAuth } from '../features/auth/AuthProvider';

// CampusConnect AccountMenu dropdown surface and native disclosure semantics.
function Disclosure({ label, className = '', active = false, avatar, children }: PropsWithChildren<{ label: string; className?: string; active?: boolean; avatar?: string }>) {
  const root = useRef<HTMLDetailsElement>(null);
  const location = useLocation();
  useEffect(() => {
    const node = root.current;
    if (node) node.open = false;
  }, [location]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && root.current) root.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && root.current?.open) { root.current.open = false; root.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  return <details className={`cc-shell-menu-root ${className}`} ref={root}><summary aria-label={label} title={label} className={avatar ? 'cc-shell-avatar' : label === 'Workspace shortcuts' ? 'cc-shell-utility' : `cc-shell-nav-link md-more-trigger${active ? ' is-active' : ''}`}>{avatar ?? (label === 'Workspace shortcuts' ? <Icon name="dashboard" /> : <>More <Icon name="chevron" className="size-4" /></>)}</summary>{children}</details>;
}

export function RouteSearch({ onNavigate }: { onNavigate?: () => void } = {}) {
  const resultsId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const matches = destinations.filter(item => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  function select(path: string) { setOpen(false); setQuery(''); navigate(path); input.current?.blur(); onNavigate?.(); }
  return <div className="md-search-wrap" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); input.current?.focus(); } if (event.key === 'ArrowDown' && event.target === input.current) { event.preventDefault(); event.currentTarget.querySelector<HTMLAnchorElement>('.cc-shell-menu-item')?.focus(); } }}>
    <form className="cc-global-search-form" role="search" onSubmit={event => { event.preventDefault(); if (matches[0]) select(matches[0].path); }}>
      <Icon name="search" className="cc-global-search-icon" /><input ref={input} aria-label="Find a workspace section" aria-expanded={open} aria-controls={resultsId} className="cc-global-search-input" placeholder="Search MedDecode" value={query} onChange={event => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} /><button className="md-search-submit" type="submit" aria-label="Go to matching section"><Icon name="arrow" /></button>
    </form>
    {open && <div id={resultsId} className="md-search-results"><p>Find a workspace section · Demo navigation</p>{matches.map(item => <Link key={item.path} className="cc-shell-menu-item" to={item.path} onClick={event => { event.preventDefault(); select(item.path); }}><Icon name={item.icon} className="size-4" />{item.label}</Link>)}{!matches.length && <p>No matching sections.</p>}</div>}
  </div>;
}

export function WorkspaceHeader({ onExplore, expanded }: { onExplore: (event: MouseEvent<HTMLButtonElement>) => void; expanded: boolean }) {
  const auth = useAuth();
  const { pathname } = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchContainer = useRef<HTMLDivElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const accountName = auth.user?.email ?? 'Not signed in';
  const accountInitials = auth.user?.email?.split('@')[0]?.split(/[._-]/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'A';
  return <header className="cc-top-nav"><div className="cc-top-nav-inner">
    <Link aria-label="MedDecode home" className="cc-shell-brand" to="/home"><span className="cc-shell-brand-mark">M</span><span className="cc-shell-wordmark">MedDecode</span></Link>
    <nav className="cc-shell-primary-nav" aria-label="Primary navigation">
      {destinations.map((item, index) => {
        const isCurrentActive = item.path === '/prescriptions'
          ? pathname === '/prescriptions' || pathname.startsWith('/prescriptions/')
          : (item.path === '/medicine-library'
             ? pathname === '/medicine-library' || pathname === '/medicine-insights'
             : pathname === item.path);
        return (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path !== '/prescriptions'}
            className={({ isActive }) =>
              `cc-shell-nav-link${index > 4 ? ' md-wide-link' : ''}${isCurrentActive || isActive ? ' is-active' : ''}`
            }
          >
            {item.label}
          </NavLink>
        );
      })}
      <Disclosure label="More workspace sections" className="md-desktop-more" active={destinations.slice(5).some(item => item.path === pathname)}><nav className="cc-shell-dropdown md-overflow-menu" aria-label="More workspace sections">{destinations.slice(5).map(item => <NavLink key={item.path} to={item.path} className={({ isActive }) => `cc-shell-menu-item${isActive ? ' is-selected' : ''}`}><Icon name={item.icon} className="size-4" />{item.label}</NavLink>)}</nav></Disclosure>
    </nav>
    <button type="button" className="cc-shell-explore-trigger" aria-label="Explore all sections" aria-haspopup="dialog" aria-controls="workspace-navigation" aria-expanded={expanded} onClick={onExplore}><Icon name="dashboard" /><span>Explore</span></button>
    <div ref={searchContainer} className={`cc-shell-search${searchOpen ? ' is-open' : ''}`} onKeyDown={event => { if (event.key === 'Escape') { setSearchOpen(false); searchTrigger.current?.focus(); } }}><RouteSearch onNavigate={() => setSearchOpen(false)} /></div>
    <div className="cc-shell-utilities">
      <button ref={searchTrigger} className="cc-shell-utility cc-shell-search-trigger" aria-label="Open section search" title="Search MedDecode sections" aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); if (!searchOpen) requestAnimationFrame(() => searchContainer.current?.querySelector('input')?.focus()); }}><Icon name="search" /></button>
      <div className="cc-shell-theme"><PublicThemeToggle /></div>
      <Disclosure label="Account menu" avatar={accountInitials}><div className="cc-shell-dropdown cc-shell-account-menu"><div className="cc-shell-account-identity"><span className="cc-shell-avatar" aria-hidden="true">{accountInitials}</span><div><strong>{accountName}</strong><small>{auth.user ? 'Verified account' : 'No authenticated session'}</small></div></div><div className="cc-shell-menu-section"><Link className="cc-shell-menu-item" to="/account"><Icon name="shield" className="size-4" />Account &amp; settings</Link><Link className="cc-shell-menu-item" to="/home"><Icon name="home" className="size-4" />Home</Link><Link className="cc-shell-menu-item" to="/prescriptions"><Icon name="inbox" className="size-4" />My Prescriptions</Link><Link className="cc-shell-menu-item" to="/my-cabinet"><Icon name="briefcase" className="size-4" />My Cabinet</Link>{auth.user ? <button type="button" className="cc-shell-menu-item" onClick={() => void auth.signOut()}><Icon name="arrow" className="size-4" />Sign out</button> : <Link className="cc-shell-menu-item" to="/sign-in"><Icon name="arrow" className="size-4" />Sign in</Link>}</div></div></Disclosure>
    </div>
  </div></header>;
}
