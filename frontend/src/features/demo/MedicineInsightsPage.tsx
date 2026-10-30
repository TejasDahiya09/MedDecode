import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, EmptyState } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { medicines, type Medicine } from './demo-data';
import { findExampleMedicines, normalizeMedicineQuery } from './medicine-search';
import './medicine-insights.css';

export function MedicineInsightsPage() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Medicine | null>(medicines[0]!);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const page = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const origin = useRef<string | null>(null);
  const focusNext = useRef<'details' | 'origin' | 'search' | null>(null);
  const compact = useRef(true);
  const detailFocus = useRef<HTMLElement | null>(null);
  const id = useId();
  const detailId = `${id}-details`, headingId = `${id}-selected`, resultsId = `${id}-results`, countId = `${id}-count`;
  const matches = findExampleMedicines(query);
  const normalized = normalizeMedicineQuery(query);

  useLayoutEffect(() => {
    const node = page.current;
    if (!node) return;
    const style = getComputedStyle(node);
    compact.current = node.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0') < 60 * parseFloat(getComputedStyle(document.documentElement).fontSize || '16');
    if (typeof ResizeObserver === 'undefined') return;
    // Match the container query, using content width rather than viewport alone.
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const next = entry.contentRect.width < 60 * parseFloat(getComputedStyle(document.documentElement).fontSize);
      const active = document.activeElement;
      if (next !== compact.current && active instanceof HTMLElement) {
        const remembered = detailFocus.current;
        if (remembered?.isConnected && (active === document.body || node.querySelector('.md-insights-details')?.contains(active))) {
          if (next) {
            setDetailsOpen(true);
            requestAnimationFrame(() => { if (remembered.isConnected) remembered.focus({ preventScroll: true }); });
          } else if (remembered.classList.contains('md-insights-compact-only')) {
            requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
          }
        }
      }
      compact.current = next;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const destination = focusNext.current;
    focusNext.current = null;
    if (!destination) return;
    const frame = requestAnimationFrame(() => {
      const element = destination === 'details' ? heading.current : destination === 'origin' ? buttons.current.get(origin.current ?? '') ?? search.current : search.current;
      element?.focus({ preventScroll: true });
      const surface = destination === 'details' ? element?.closest('.md-insights-details') : element;
      surface?.scrollIntoView({ block: destination === 'details' ? 'start' : 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, detailsOpen, query]);

  function select(item: Medicine) {
    origin.current = item.id;
    setSelected(item);
    setAnnouncement(`${item.name} selected. Fictional details shown; clinical verification unavailable.`);
    if (compact.current) { focusNext.current = 'details'; setDetailsOpen(true); }
  }
  function closeDetails() {
    focusNext.current = 'origin'; setDetailsOpen(false);
    setAnnouncement('Details closed. Returned to the example directory.');
  }
  function clearSearch() {
    focusNext.current = 'search'; setQuery(''); setDetailsOpen(false);
    setAnnouncement('Search cleared.');
  }
  function clearSelection() {
    focusNext.current = 'origin'; setSelected(null); setDetailsOpen(false);
    setAnnouncement('Selection cleared. Choose a fictional example to view its details.');
  }

  return <div className="md-page md-insights-page" data-detail-open={detailsOpen} ref={page}>
    <header className="md-insights-intro">
      <div className="md-insights-heading-row"><h1 className="cc-page-title">Medicine Insights</h1><Badge>Demo Mode</Badge></div>
      <p className="cc-page-description">Browse fictional medicine examples and inspect their available reference fields.</p>
      <p className="md-insights-explanation"><Icon name="shield" /><span>Fictional examples only. Medicine information is not clinically verified.</span></p>
    </header>
    <div className="md-insights-toolbar">
      <form className="md-insights-search" role="search" aria-label="Example medicine search" onSubmit={event => { event.preventDefault(); setAnnouncement('Search applied to the fictional directory.'); }}>
        <label className="sr-only" htmlFor={`${id}-search`}>Search example medicines</label><Icon name="search" />
        <input id={`${id}-search`} ref={search} type="search" autoComplete="off" maxLength={100} value={query} placeholder="Search names, ingredients or references" aria-controls={resultsId} aria-describedby={countId} onChange={event => setQuery(event.target.value)} />
        {query !== '' && <button type="button" aria-label="Clear search" title="Clear search" onClick={clearSearch}><Icon name="close" /></button>}
      </form>
    </div>
    <p className="md-insights-count" id={countId} role="status" aria-live="polite" aria-atomic="true">{matches.length} example {matches.length === 1 ? 'entry' : 'entries'}{normalized ? ` matching “${query.trim().replace(/\s+/g, ' ')}”` : ''}</p>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    <div className="md-insights-workspace">
      <section className="md-insights-directory" id={resultsId} aria-labelledby={`${id}-directory`}>
        <h2 className="cc-section-title" id={`${id}-directory`}>Example directory</h2>
        {matches.length ? <ul className="md-insights-list">{matches.map(item => <li key={item.id}>
          <button type="button" className={`md-insights-record${selected?.id === item.id ? ' is-selected' : ''}`} aria-pressed={selected?.id === item.id} aria-controls={detailId} ref={node => { if (node) buttons.current.set(item.id, node); else buttons.current.delete(item.id); }} onClick={() => select(item)}>
            <span className="md-insights-record-icon" aria-hidden="true"><Icon name="inbox" /></span>
            <span className="md-insights-record-copy"><strong>{item.name}</strong><span>Ingredient: {item.ingredient}</span><small>{item.form}</small></span>
            <Icon name="arrow" className="md-insights-record-arrow" />
          </button>
        </li>)}</ul> : <div className="cc-card"><EmptyState icon="search" title="No examples found" description="Try another sample name, ingredient, formulation or reference code, or clear your search." /></div>}
      </section>
      <section className="cc-card md-insights-details" id={detailId} aria-labelledby={selected ? headingId : `${id}-empty`} onFocusCapture={event => { if (event.target instanceof HTMLElement) detailFocus.current = event.target; }} onBlurCapture={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) detailFocus.current = null; }}>
        {selected ? <>
          <button className="md-insights-back md-insights-compact-only" type="button" onClick={closeDetails}><Icon name="arrow" />Back to results</button>
          <header className="md-insights-identity"><span className="cc-icon-box"><Icon name="inbox" className="size-6" /></span><div><Badge>Fictional example</Badge><h2 id={headingId} tabIndex={-1} ref={heading}>{selected.name}</h2><span className="md-insights-reference">{selected.code}</span></div></header>
          <div><Badge tone="warning">Clinical verification unavailable</Badge></div>
          <div className="md-insights-information">
            <section><h3>Overview</h3><dl className="md-insights-facts"><div><dt>Active ingredient</dt><dd>{selected.ingredient}</dd></div><div><dt>Formulation</dt><dd>{selected.form}</dd></div><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Source</dt><dd>Fictional interface fixture</dd></div></dl></section>
            <section><h3>General information</h3><p>This card demonstrates the layout of a medicine reference. It is not a verified medicine entry.</p></section>
            <section><h3>Precautions &amp; interactions</h3><p>Not available in this demo. No safety assessment has been performed.</p></section>
          </div>
          <div className="md-insights-detail-actions"><Link className="cc-button cc-button--primary" to="/compare-medicines">Compare Medicines<Icon name="arrow" className="size-4" /></Link><Button variant="ghost" onClick={clearSelection}>Clear selection</Button><button className="cc-button cc-button--secondary md-insights-compact-only" type="button" onClick={closeDetails}>Close details</button></div>
          <p className="md-insights-help">Opens the comparison demo with its default examples.</p>
        </> : <div><h2 className="sr-only" id={`${id}-empty`}>No medicine selected</h2><EmptyState icon="inbox" title="Choose an example" description="Select a fictional directory entry to inspect its available fields." /></div>}
      </section>
    </div>
    <p className="md-demo-footnote">In-memory only · No account, cloud saving or background notifications.</p>
  </div>;
}
