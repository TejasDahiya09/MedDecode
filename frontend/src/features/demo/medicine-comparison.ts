import { catalogMedicines, type CatalogMedicine } from './catalog-data';

export type ComparisonSlot = 'a' | 'b';
export const medicineById = new Map(catalogMedicines.map(item => [item.id, item]));
export function getMedicine(id: string | null): CatalogMedicine | null { return id ? medicineById.get(id) ?? null : null; }
export function normalizeComparisonParams(input: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(), rawA = input.get('a'), rawB = input.get('b');
  const a = getMedicine(rawA), b = getMedicine(rawB);
  if (a) next.set('a', a.id);
  if (b && (!a || a.id !== b.id)) next.set('b', b.id);
  return next;
}
export function updateComparisonParams(current: URLSearchParams, slot: ComparisonSlot, id: string | null): URLSearchParams {
  const next = normalizeComparisonParams(current); if (id) next.set(slot, id); else next.delete(slot); return next;
}
export function swapComparisonParams(current: URLSearchParams): URLSearchParams {
  const normalized = normalizeComparisonParams(current), next = new URLSearchParams();
  const a = normalized.get('a'), b = normalized.get('b'); if (b) next.set('a', b); if (a) next.set('b', a); return next;
}
export interface ComparisonField { readonly id: string; readonly label: string; readonly a: string; readonly b: string; readonly difference: string | null }
const unavailable = 'Not available in this demo.';
export function comparisonFields(a: CatalogMedicine, b: CatalogMedicine): ComparisonField[] {
  const definitions = [
    ['name', 'Medicine name', (item: CatalogMedicine) => item.name], ['ingredient', 'Active ingredient', (item: CatalogMedicine) => item.ingredient],
    ['formulation', 'Formulation', (item: CatalogMedicine) => item.form], ['category', 'Illustrative catalog category', (item: CatalogMedicine) => `${item.group} (illustrative group)`],
    ['reference', 'Reference layout', (item: CatalogMedicine) => item.referenceStatus], ['overview', 'Available overview', (item: CatalogMedicine) => item.shortDescription],
    ['source', 'Source status', () => 'Fictional interface fixture'], ['verification', 'Clinical verification status', () => 'Clinical verification unavailable'],
  ] as const;
  return definitions.map(([id, label, getter]) => { const left = getter(a) || unavailable, right = getter(b) || unavailable; const missing = left === unavailable || right === unavailable; return { id, label, a: left, b: right, difference: missing ? 'Information unavailable' : left === right ? null : id === 'formulation' ? 'Different formulation' : id === 'ingredient' ? 'Different example ingredient' : 'Different example information' }; });
}
