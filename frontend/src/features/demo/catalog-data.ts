import { medicines, type Medicine } from './demo-data';

export interface CatalogCategory { readonly id: string; readonly name: string }
export const catalogGroups = ['Pain relief', 'Antibiotics', 'Allergy care', 'Digestive care', 'Vitamins', 'Skin care', 'Cold & flu'] as const;
export const catalogForms = ['Tablet', 'Capsule', 'Syrup', 'Ointment', 'Drops', 'Liquid'] as const;
export const categoryStrip: readonly CatalogCategory[] = [
  { id: 'tablet', name: 'Tablets' }, { id: 'capsule', name: 'Capsules' }, { id: 'syrup', name: 'Syrups & liquids' },
  { id: 'ointment', name: 'Ointments' }, { id: 'vitamins', name: 'Vitamins' }, { id: 'first-aid', name: 'First aid' }, { id: 'daily-care', name: 'Daily care' },
];
export interface CatalogMedicine extends Medicine {
  readonly group: string;
  readonly catalogForm: string;
  readonly ingredientKey: string;
  readonly referenceStatus: 'Overview only' | 'Detailed example';
  readonly illustration: string;
  readonly tags: readonly string[];
  readonly shortDescription: string;
}
const names = ['Elm', 'Fern', 'Grove', 'Hazel', 'Iris', 'Juniper', 'Kestrel', 'Larch', 'Maple', 'Nova', 'Olive', 'Pine'];
// Catalog groups are fictional browsing labels, not indications or clinical classifications.
export const catalogMedicines: readonly CatalogMedicine[] = Array.from({ length: 16 }, (_, index) => {
  const original = medicines[index];
  const catalogForm = original ? ['Tablet', 'Capsule', 'Liquid', 'Tablet'][index]! : catalogForms[index % catalogForms.length]!;
  const group = catalogGroups[index % catalogGroups.length]!;
  const ingredientKey = index === 3 ? 'unavailable' : original ? ['A', 'B', 'A'][index]! : ['A', 'B', 'C', 'D'][index % 4]!;
  return {
    ...(original ?? { id: names[index - 4]!.toLowerCase(), name: `${names[index - 4]} ${catalogForm} — Sample ${String(index + 1).padStart(2, '0')}`, ingredient: `Illustrative ingredient ${ingredientKey}`, form: `${catalogForm} (example)`, category: 'Reference example', code: `MD / ${String(index + 1).padStart(3, '0')}` }),
    group, catalogForm, ingredientKey, referenceStatus: index % 3 === 0 ? 'Overview only' : 'Detailed example', illustration: catalogForm.toLowerCase(),
    tags: [catalogForm === 'Liquid' ? 'syrup' : catalogForm.toLowerCase(), ...(group === 'Vitamins' ? ['vitamins'] : []), ...(group === 'Skin care' ? ['first-aid'] : []), ...(group === 'Allergy care' || group === 'Digestive care' ? ['daily-care'] : [])],
    shortDescription: 'A fictional reference for exploring ingredient labels, formulations and information layouts.',
  };
});
export interface CatalogFilters { group: string; form: string; ingredient: string; reference: string; verification: string }
export const emptyCatalogFilters: CatalogFilters = { group: '', form: '', ingredient: '', reference: '', verification: '' };
export type CatalogSort = 'name_asc' | 'name_desc' | 'category' | 'formulation';
export function discoverCatalog(query: string, filters: CatalogFilters, category: string, sort: CatalogSort): CatalogMedicine[] {
  const normalized = query.trim().replace(/\s+/g, ' ').toLowerCase();
  const items = catalogMedicines.filter(item =>
    `${item.name} ${item.ingredient} ${item.form} ${item.code} ${item.group}`.toLowerCase().includes(normalized) &&
    (!filters.group || item.group === filters.group) && (!filters.form || item.catalogForm === filters.form) &&
    (!filters.ingredient || item.ingredientKey === filters.ingredient) && (!filters.reference || item.referenceStatus === filters.reference) &&
    (!filters.verification || filters.verification === 'fictional') && (!category || item.tags.includes(category)));
  return items.sort((a, b) => {
    const compare = (x: string, y: string) => x.localeCompare(y, 'en', { numeric: true });
    if (sort === 'name_desc') return compare(b.name, a.name);
    if (sort === 'category') return compare(a.group, b.group) || compare(a.name, b.name);
    if (sort === 'formulation') return compare(a.catalogForm, b.catalogForm) || compare(a.name, b.name);
    return compare(a.name, b.name);
  });
}
