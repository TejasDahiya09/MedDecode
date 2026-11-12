import { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, EmptyState } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { MedicineCatalogDialog } from './MedicineCatalogDialog';
import { MedicineCategoryNav } from './MedicineCategoryNav';
import { MedicineCatalogHero, MedicineIllustration } from './MedicineIllustration';
import { catalogForms, catalogGroups, categoryStrip, discoverCatalog, emptyCatalogFilters, type CatalogFilters, type CatalogMedicine, type CatalogSort } from './catalog-data';
import './medicine-insights.css';

function MedicineFilters({ value, onApply, onClear }: { value: CatalogFilters; onApply: (value: CatalogFilters) => void; onClear: () => void }) {
  const [draft, setDraft] = useState(value);
  const fields = [
    { key: 'group', label: 'Category', all: 'All categories', options: catalogGroups.map(v => [v, v]) },
    { key: 'form', label: 'Formulation', all: 'All formulations', options: catalogForms.map(v => [v, v]) },
    { key: 'ingredient', label: 'Ingredient', all: 'All ingredients', options: ['A', 'B', 'C', 'D'].map(v => [v, `Example ingredient ${v}`]).concat([['unavailable', 'Unavailable in example']]) },
    { key: 'reference', label: 'Reference data', all: 'All reference layouts', options: ['Overview only', 'Detailed example'].map(v => [v, v]) },
    { key: 'verification', label: 'Demo verification', all: 'All entries', options: [['fictional', 'Fictional example only']] },
  ] as const;
  return <form className="cc-market-filters" onSubmit={event => { event.preventDefault(); onApply(draft); }}>
    <div className="cc-market-filter-heading"><Icon name="filter" /><h2>Refine your finds</h2></div>
    {fields.map(field => <label className="cc-label" key={field.key}>{field.label}<select className="cc-field" value={draft[field.key]} data-active={!!draft[field.key]} onChange={event => setDraft({ ...draft, [field.key]: event.target.value })}><option value="">{field.all}</option>{field.options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>)}
    <div className="cc-market-filter-actions"><Button type="submit">Apply filters</Button><Button variant="ghost" onClick={onClear}>Clear all</Button></div>
    <p className="cc-market-hint">Groups describe fictional catalog examples, not treatment uses. Reference detail is a layout label, not clinical verification.</p>
  </form>;
}

export function MedicineInsightsPage() {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<CatalogFilters>(emptyCatalogFilters);
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<CatalogSort>('name_asc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CatalogMedicine | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [message, setMessage] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLElement>(null);
  const id = useId();
  const matches = discoverCatalog(query, filters, category, sort);
  const pages = Math.max(1, Math.ceil(matches.length / 12));
  const currentPage = Math.min(page, pages);
  const shown = matches.slice((currentPage - 1) * 12, currentPage * 12);
  const filterCount = Object.values(filters).filter(Boolean).length;
  function clearSearch() { setQuery(''); setPage(1); setMessage('Search cleared.'); requestAnimationFrame(() => search.current?.focus()); }
  function clearAll() { setFilters(emptyCatalogFilters); setCategory(''); setQuery(''); setSort('name_asc'); setPage(1); setFiltersOpen(false); setMessage('All catalog filters cleared.'); requestAnimationFrame(() => search.current?.focus()); }
  function open(item: CatalogMedicine) { setSelected(item); setMessage(`${item.name} details opened. Fictional example; not clinically verified.`); }
  function close() { setSelected(null); setMessage('Details closed. Returned to the catalog.'); }
  function apply(next: CatalogFilters) { setFilters(next); setPage(1); setFiltersOpen(false); setMessage('Catalog filters applied.'); if (!filtersOpen) requestAnimationFrame(() => { results.current?.focus({ preventScroll: true }); results.current?.scrollIntoView({ block: 'nearest' }); }); }
  function changePage(next: number) { setPage(next); requestAnimationFrame(() => { results.current?.focus(); results.current?.scrollIntoView({ block: 'start' }); }); }
  const filterForm = <MedicineFilters key={JSON.stringify(filters)} value={filters} onApply={apply} onClear={clearAll} />;

  return <div className="md-page md-catalog cc-marketplace">
    <header className="cc-market-header"><div><h1>Medicine Insights</h1><p>Fictional references, thoughtfully organized.</p><p className="md-catalog-disclaimer">Illustrative groups only. No clinical validation or treatment guidance.</p></div><Badge>Demo Mode</Badge></header>
    <MedicineCatalogHero />
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{message}</p>
    <div className="cc-market-layout">
      <aside className="cc-market-filter-rail" aria-label="Medicine catalog filters">{filterForm}<p className="cc-market-rail-note"><Icon name="shield" />Explore examples. No clinical assessment is performed.</p></aside>
      <div className="cc-market-workspace">
        <MedicineCategoryNav categories={categoryStrip} selected={category} onSelect={value => { setCategory(value); setPage(1); }} />
        <div className="cc-market-toolbar">
          <form className="cc-market-search" role="search" aria-label="Fictional medicine search" onSubmit={event => { event.preventDefault(); setMessage('Search applied to the fictional catalog.'); }}><label className="sr-only" htmlFor={`${id}-search`}>Search example medicines</label><Icon name="search" /><input id={`${id}-search`} ref={search} type="search" autoComplete="off" maxLength={100} placeholder="Search medicines, ingredients or references" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} aria-describedby={`${id}-count`} />{query !== '' && <button type="button" aria-label="Clear search" onClick={clearSearch}><Icon name="close" /></button>}</form>
          <div className="cc-market-toolbar-actions"><Button className="cc-market-filter-trigger" variant="secondary" aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={event => { event.currentTarget.focus({ preventScroll: true }); setFiltersOpen(true); }}><Icon name="filter" />Filters{filterCount ? <span className="cc-market-filter-count">{filterCount}</span> : null}</Button><label className="cc-market-sort"><span className="sr-only">Sort medicine examples</span><select className="cc-field" value={sort} onChange={event => { setSort(event.target.value as CatalogSort); setPage(1); }}><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option><option value="category">Category</option><option value="formulation">Formulation</option></select></label></div>
        </div>
        {(filterCount || category || query) ? <div className="cc-market-active-filters" aria-label="Applied catalog filters">{category && <button type="button" className="cc-filter-chip" onClick={() => { setCategory(''); setPage(1); }}>Category: {categoryStrip.find(item => item.id === category)?.name}<Icon name="close" /></button>}{Object.entries(filters).filter(([, value]) => value).map(([key, value]) => <button key={key} type="button" className="cc-filter-chip" aria-label={`Remove ${key} filter`} onClick={() => { setFilters({ ...filters, [key]: '' }); setPage(1); }}>{key}: {value}<Icon name="close" /></button>)}<button type="button" className="cc-market-clear" onClick={clearAll}>Clear all filters</button></div> : null}
        <section className="cc-market-results" ref={results} tabIndex={-1} aria-labelledby={`${id}-results`}>
          <div className="cc-market-section-heading"><div><h2 id={`${id}-results`}>Explore medicine examples</h2><p id={`${id}-count`} role="status" aria-live="polite" aria-atomic="true">{matches.length} fictional {matches.length === 1 ? 'reference' : 'references'} · Page {currentPage} of {pages}</p></div></div>
          {shown.length ? <div className="cc-market-grid">{shown.map(item => <article className="cc-market-product" key={item.id}>
            <button type="button" className="cc-market-product-link md-catalog-open" aria-label={`View details for ${item.name}`} aria-haspopup="dialog" onClick={event => { event.currentTarget.focus({ preventScroll: true }); open(item); }}><div className="cc-market-product-media"><MedicineIllustration token={item.illustration} code={item.code} /></div><div className="cc-market-product-body"><h3>{item.name}</h3><p className="md-catalog-ingredient"><span className="md-catalog-ingredient-label">Ingredient: </span>{item.ingredient}</p><p className="cc-market-product-condition"><span className="md-catalog-form-desktop">{item.form}</span><span className="md-catalog-form-mobile">{item.catalogForm}</span><br /><span className="md-catalog-group">{item.group} · Illustrative group</span></p><span className="md-catalog-reference-status">{item.referenceStatus}</span><span className="md-catalog-view">View reference <Icon name="arrow" /></span></div></button>
            <div className="cc-market-product-footer"><span>Fictional example</span><Link className="cc-market-share" to={`/compare-medicines?a=${encodeURIComponent(item.id)}`} aria-label={`Compare ${item.name}`} title={`Open ${item.name} as Medicine A`}><Icon name="copy" className="size-4" /><span>Compare</span></Link></div>
          </article>)}</div> : <div className="cc-card"><EmptyState icon="search" title="No examples found" description="Try another term or clear the catalog filters." action={<Button onClick={clearAll}>Clear all filters</Button>} /></div>}
          <nav className="cc-market-pagination" aria-label="Medicine catalog pages"><Button variant="secondary" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>Previous</Button><span>Page {currentPage} of {pages}</span><Button variant="secondary" disabled={currentPage === pages} onClick={() => changePage(currentPage + 1)}>Next</Button></nav>
        </section>
      </div>
    </div>
    <p className="md-demo-footnote">In-memory only · Fictional examples · No account, cloud saving or background notifications.</p>
    {filtersOpen && <MedicineCatalogDialog title="Refine your medicine examples" onClose={() => setFiltersOpen(false)}><div className="md-catalog-modal">{filterForm}</div></MedicineCatalogDialog>}
    {selected && <MedicineCatalogDialog title={selected.name} onClose={close}><div className="md-catalog-modal md-catalog-details"><div className="md-catalog-detail-art"><MedicineIllustration token={selected.illustration} code={selected.code} /></div><div className="md-catalog-meta"><Badge>Fictional example</Badge><Badge tone="warning">Clinical verification unavailable</Badge><Badge>{selected.code}</Badge></div><p>{selected.shortDescription}</p><section><h3>Overview</h3><dl><div><dt>Active ingredient</dt><dd>{selected.ingredient}</dd></div><div><dt>Formulation</dt><dd>{selected.form}</dd></div><div><dt>Catalog category</dt><dd>{selected.group} (illustrative group)</dd></div><div><dt>Reference layout</dt><dd>{selected.referenceStatus}</dd></div><div><dt>Source</dt><dd>Fictional interface fixture</dd></div></dl></section><section><h3>General information</h3><p>{selected.referenceStatus === 'Overview only' ? 'This overview-only example does not include further reference information. The catalog category is an illustrative grouping.' : 'This reference demonstrates information layout. Categories and illustrations are not treatment indications or real packaging.'}</p></section><section><h3>Precautions &amp; interactions</h3><p>Not available in this demo. No safety assessment has been performed.</p></section><Link className="cc-button cc-button--primary" to={`/compare-medicines?a=${encodeURIComponent(selected.id)}`}>Compare Medicines<Icon name="arrow" className="size-4" /></Link><p className="md-catalog-modal-note">Opens this fictional reference as Medicine A. Choose a different Medicine B to compare available fields.</p><Button variant="secondary" onClick={close}>Back to catalog</Button></div></MedicineCatalogDialog>}
  </div>;
}
