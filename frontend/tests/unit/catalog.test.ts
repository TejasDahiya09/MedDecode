import { describe, expect, it } from 'vitest';
import { catalogMedicines, catalogGroups, catalogForms, discoverCatalog, emptyCatalogFilters } from '../../src/features/demo/catalog-data';
import { medicines } from '../../src/features/demo/demo-data';

describe('fictional catalog discovery', () => {
  it('adds 12 fictional entries while preserving the original four medicine fields', () => {
    expect(catalogMedicines).toHaveLength(16);
    medicines.forEach((item, i) => Object.entries(item).forEach(([key, value]) => expect(Reflect.get(catalogMedicines[i]!, key)).toEqual(value)));
    expect(new Set(catalogMedicines.map(item => item.id)).size).toBe(16);
  });
  it.each(['Aster', '  ASTER  ', '  ingredient    C ', 'Capsule', 'MD / 016'])('searches available fictional fields for %j', query => {
    expect(discoverCatalog(query, emptyCatalogFilters, '', 'name_asc').length).toBeGreaterThan(0);
  });
  it('has results for every offered group, form and ingredient', () => {
    catalogGroups.forEach(group => expect(discoverCatalog('', { ...emptyCatalogFilters, group }, '', 'name_asc').length).toBeGreaterThan(0));
    catalogForms.forEach(form => expect(discoverCatalog('', { ...emptyCatalogFilters, form }, '', 'name_asc').length).toBeGreaterThan(0));
    ['A', 'B', 'C', 'D'].forEach(ingredient => expect(discoverCatalog('', { ...emptyCatalogFilters, ingredient }, '', 'name_asc').length).toBeGreaterThan(0));
  });
  it('combines filters and category strip without changing the immutable catalog', () => {
    const before = JSON.stringify(catalogMedicines);
    const values = discoverCatalog('', { ...emptyCatalogFilters, form: 'Capsule', verification: 'fictional' }, 'capsule', 'name_asc');
    expect(values.length).toBeGreaterThan(0); expect(values.every(item => item.catalogForm === 'Capsule')).toBe(true);
    expect(discoverCatalog('', { ...emptyCatalogFilters, form: 'Capsule' }, 'tablet', 'name_asc')).toEqual([]);
    expect(JSON.stringify(catalogMedicines)).toBe(before);
  });
  it('sorts names in both directions and groups by category/formulation', () => {
    const asc = discoverCatalog('', emptyCatalogFilters, '', 'name_asc');
    expect(discoverCatalog('', emptyCatalogFilters, '', 'name_desc').map(item => item.id)).toEqual(asc.map(item => item.id).reverse());
    for (const sort of ['category', 'formulation'] as const) {
      const values = discoverCatalog('', emptyCatalogFilters, '', sort).map(item => sort === 'category' ? item.group : item.catalogForm);
      expect(values).toEqual([...values].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })));
    }
  });
  it('preserves Dune unavailable data and makes reference-status filters truthful layout labels', () => {
    expect(discoverCatalog('Dune', emptyCatalogFilters, '', 'name_asc')[0]?.ingredient).toBe('Not available in this demo');
    for (const reference of ['Overview only', 'Detailed example']) expect(discoverCatalog('', { ...emptyCatalogFilters, reference }, '', 'name_asc').every(item => item.referenceStatus === reference)).toBe(true);
    expect(discoverCatalog('<script>fictional</script>', emptyCatalogFilters, '', 'name_asc')).toEqual([]);
  });
});
