import { describe, expect, it } from 'vitest';
import { catalogMedicines } from '../../src/features/demo/catalog-data';
import { comparisonFields, getMedicine, normalizeComparisonParams, swapComparisonParams, updateComparisonParams } from '../../src/features/demo/medicine-comparison';

describe('medicine comparison URL state', () => {
  it('exposes every canonical fictional medicine by stable ID', () => {
    expect(catalogMedicines).toHaveLength(16);
    expect(new Set(catalogMedicines.map(item => item.id)).size).toBe(16);
    expect(catalogMedicines.every(item => getMedicine(item.id) === item)).toBe(true);
  });
  it('keeps valid distinct selections and removes malformed values', () => {
    expect(normalizeComparisonParams(new URLSearchParams('a=pine&b=cedar')).toString()).toBe('a=pine&b=cedar');
    expect(normalizeComparisonParams(new URLSearchParams('a=missing&b=cedar')).toString()).toBe('b=cedar');
    expect(normalizeComparisonParams(new URLSearchParams('b=cedar')).toString()).toBe('b=cedar');
    expect(normalizeComparisonParams(new URLSearchParams('a=pine&b=pine')).toString()).toBe('a=pine');
  });
  it('updates, removes and swaps URL slots without medicine objects', () => {
    expect(updateComparisonParams(new URLSearchParams('a=pine'), 'b', 'cedar').toString()).toBe('a=pine&b=cedar');
    expect(updateComparisonParams(new URLSearchParams('a=pine&b=cedar'), 'a', null).toString()).toBe('b=cedar');
    expect(swapComparisonParams(new URLSearchParams('a=pine&b=cedar')).toString()).toBe('a=cedar&b=pine');
  });
  it('derives aligned fields without medical inference', () => {
    const fields = comparisonFields(getMedicine('pine')!, getMedicine('cedar')!);
    expect(fields.map(field => field.id)).toEqual(['name', 'ingredient', 'formulation', 'category', 'reference', 'overview', 'source', 'verification']);
    expect(fields.find(field => field.id === 'formulation')?.difference).toBe('Different formulation');
    expect(fields.some(field => /better|safer|recommended/i.test(`${field.a} ${field.b} ${field.difference}`))).toBe(false);
  });
});
