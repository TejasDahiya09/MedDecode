import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { MedicineIllustration } from './MedicineIllustration';
import { MedicineComparisonPicker } from './MedicineComparisonPicker';
import { comparisonFields, getMedicine, normalizeComparisonParams, swapComparisonParams, updateComparisonParams, type ComparisonSlot } from './medicine-comparison';
import './compare-medicines.css';

function SelectionCard({ slot, item, onChoose, onRemove }: { slot: ComparisonSlot; item: ReturnType<typeof getMedicine>; onChoose: () => void; onRemove: () => void }) {
  const label = `Medicine ${slot.toUpperCase()}`;
  return <article className={`md-compare-slot ${item ? 'is-selected' : 'is-empty'}`} aria-label={`${label}${item ? `: ${item.name}` : ': no selection'}`}>
    {item ? <><div className="md-compare-slot-art"><MedicineIllustration token={item.illustration} code={item.code} /></div><div className="md-compare-slot-body"><div className="md-compare-slot-label"><Badge>{label}</Badge><span>{item.referenceStatus}</span></div><h2>{item.name}</h2><p><strong>Ingredient:</strong> {item.ingredient}</p><p><strong>Formulation:</strong> {item.form}</p><div className="md-compare-slot-actions"><Button variant="secondary" onClick={onChoose} aria-label={`Change ${label}`}>Change medicine</Button><Button variant="ghost" onClick={onRemove} aria-label={`Remove ${item.name} from ${label}`}>Remove</Button></div></div></> : <div className="md-compare-empty"><span className="md-compare-empty-icon"><Icon name="plus" /></span><h2>Choose {label}</h2><p>Select a fictional reference from the medicine marketplace.</p><Button onClick={onChoose}>Choose medicine</Button></div>}
  </article>;
}

export function CompareMedicinesPage() {
  const [params, setParams] = useSearchParams(); const [picker, setPicker] = useState<ComparisonSlot | null>(null); const [message, setMessage] = useState('');
  const medicineAChoose = useRef<HTMLDivElement>(null); const medicineBChoose = useRef<HTMLDivElement>(null);
  const focusAfterClear = useRef(false);
  const focusAfterSlotChange = useRef<ComparisonSlot | null>(null);
  const canonical = normalizeComparisonParams(params); const a = getMedicine(canonical.get('a')); const b = getMedicine(canonical.get('b')); const adjusted = params.toString() !== canonical.toString();
  useEffect(() => {
    if (adjusted) setParams(canonical, { replace: true });
  }, [adjusted, canonical, setParams]);
  useEffect(() => {
    if (!a && !b && focusAfterClear.current) { focusAfterClear.current = false; medicineAChoose.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    const slot = focusAfterSlotChange.current;
    if (slot) {
      focusAfterSlotChange.current = null;
      (slot === 'a' ? medicineAChoose : medicineBChoose).current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [a, b]);
  const choose = (slot: ComparisonSlot, id: string) => { focusAfterSlotChange.current = slot; setParams(updateComparisonParams(canonical, slot, id)); setPicker(null); setMessage(`${getMedicine(id)?.name} selected as Medicine ${slot.toUpperCase()}.`); };
  const remove = (slot: ComparisonSlot) => { focusAfterSlotChange.current = slot; setParams(updateComparisonParams(canonical, slot, null)); setMessage(`Medicine ${slot.toUpperCase()} removed.`); };
  const swap = () => { setParams(swapComparisonParams(canonical)); setMessage('Medicine A and Medicine B swapped.'); };
  const clear = () => { focusAfterClear.current = true; setParams(new URLSearchParams()); setMessage('Comparison cleared. Choose Medicine A to begin.'); };
  const fields = a && b ? comparisonFields(a, b) : [];
  return <div className="md-page md-compare">
    <header className="md-compare-header"><div><div className="md-compare-title-line"><h1>Compare Medicines</h1><Badge>Demo Mode</Badge></div><p>Explore two fictional medicine references side by side.</p><p className="md-compare-safety"><Icon name="shield" />Example information only. Differences are not clinical recommendations.</p></div></header>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{message || (adjusted ? 'The comparison link was adjusted to use available, different fictional medicine references.' : '')}</p>
    <section className="md-compare-slots" aria-label="Medicine selections">
      <div ref={medicineAChoose}><SelectionCard slot="a" item={a} onChoose={() => setPicker('a')} onRemove={() => remove('a')} /></div>
      <div ref={medicineBChoose}><SelectionCard slot="b" item={b} onChoose={() => setPicker('b')} onRemove={() => remove('b')} /></div>
    </section>
    <div className="md-compare-actions" aria-label="Comparison controls"><Button variant="secondary" disabled={!a || !b} onClick={swap}><Icon name="arrow" />Swap medicines</Button><Button variant="secondary" disabled={!a && !b} onClick={clear}><Icon name="close" />Clear comparison</Button><Link className="cc-button cc-button--ghost" to="/medicine-insights">Browse Medicine Insights <Icon name="arrow" /></Link></div>
    {!a || !b ? <section className="md-compare-guidance"><span className="md-compare-guidance-icon"><Icon name="copy" /></span><div><h2>{a || b ? 'Choose another example to compare reference fields.' : 'Choose two medicine examples to explore their available reference information.'}</h2><p>No clinical comparison, recommendation or substitution assessment is performed.</p></div>{!a && !b && <Link className="cc-button cc-button--primary" to="/medicine-insights">Browse medicines</Link>}</section> : <section className="md-compare-details" aria-labelledby="comparison-details-title">
      <div className="md-compare-details-head"><div><p className="cc-eyebrow">Reference fields</p><h2 id="comparison-details-title">Side-by-side comparison</h2></div><div className="md-compare-column-names" aria-hidden="true"><span>Medicine A · {a.name}</span><span>Medicine B · {b.name}</span></div></div>
      <dl>{fields.map(field => <div className="md-compare-row" key={field.id}><dt>{field.label}{field.difference && <span className="md-compare-difference">{field.difference}</span>}</dt><dd><span className="md-compare-mobile-label">Medicine A · {a.name}</span>{field.a}</dd><dd><span className="md-compare-mobile-label">Medicine B · {b.name}</span>{field.b}</dd></div>)}</dl>
      <p className="md-compare-limit"><Icon name="shield" /><span><strong>Illustrative reference only.</strong> Matching or differing text does not establish equivalence, safety, suitability or interchangeability.</span></p>
    </section>}
    <p className="md-demo-footnote">In-memory only · Fictional examples · No clinical validation, account, cloud saving or background processing.</p>
    {picker && <MedicineComparisonPicker slot={picker} excludedId={(picker === 'a' ? b : a)?.id ?? null} onChoose={item => choose(picker, item.id)} onClose={() => setPicker(null)} />}
  </div>;
}
