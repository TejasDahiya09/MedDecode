import { useId, useMemo, useRef, useState } from 'react';
import { Button, EmptyState } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { catalogMedicines, discoverCatalog, emptyCatalogFilters, type CatalogMedicine } from './catalog-data';
import { MedicineCatalogDialog } from './MedicineCatalogDialog';
import { MedicineIllustration } from './MedicineIllustration';
import type { ComparisonSlot } from './medicine-comparison';

export function MedicineComparisonPicker({ slot, excludedId, onChoose, onClose }: { slot: ComparisonSlot; excludedId: string | null; onChoose: (item: CatalogMedicine) => void; onClose: () => void }) {
  const [query, setQuery] = useState(''); const input = useRef<HTMLInputElement>(null); const countId = useId();
  const matches = useMemo(() => discoverCatalog(query, emptyCatalogFilters, '', 'name_asc'), [query]);
  const available = matches.filter(item => item.id !== excludedId);
  const clear = () => { setQuery(''); requestAnimationFrame(() => input.current?.focus()); };
  return <MedicineCatalogDialog title={`Choose Medicine ${slot.toUpperCase()}`} onClose={onClose}><div className="md-compare-picker">
    <form className="cc-market-search md-compare-picker-search" role="search" onSubmit={event => event.preventDefault()}><label className="sr-only" htmlFor={`${countId}-search`}>Search by medicine name or ingredient</label><Icon name="search" /><input ref={input} id={`${countId}-search`} type="search" autoComplete="off" placeholder="Search names or ingredients" value={query} onChange={event => setQuery(event.target.value)} aria-describedby={countId} />{query && <button type="button" aria-label="Clear medicine search" onClick={clear}><Icon name="close" /></button>}</form>
    <p id={countId} className="md-compare-picker-count" role="status" aria-live="polite">{available.length} of {catalogMedicines.length} fictional references available</p>
    {available.length ? <div className="md-compare-picker-list" role="list">{available.map(item => <button type="button" role="listitem" className="md-compare-picker-item" key={item.id} onClick={() => onChoose(item)}><span className="md-compare-picker-art"><MedicineIllustration token={item.illustration} code={item.code} /></span><span><strong>{item.name}</strong><small>{item.ingredient}</small><small>{item.form}</small></span><Icon name="arrow" /></button>)}</div> : <EmptyState icon="search" title="No medicine examples found" description="Try another name or ingredient." action={<Button variant="secondary" onClick={clear}>Clear search</Button>} />}
  </div></MedicineCatalogDialog>;
}
