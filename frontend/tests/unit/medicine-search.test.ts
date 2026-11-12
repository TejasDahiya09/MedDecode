import { describe, expect, it } from 'vitest';
import { findExampleMedicines, normalizeMedicineQuery } from '../../src/features/demo/medicine-search';
import { medicines } from '../../src/features/demo/demo-data';

describe('fictional medicine search', () => {
  it.each([
    ['', ['aster', 'birch', 'cedar', 'dune']],
    ['ASTER', ['aster']],
    ['  Aster  ', ['aster']],
    ['ingredient A', ['aster', 'cedar']],
    ['  ingredient    A  ', ['aster', 'cedar']],
    ['Capsule', ['birch']],
    ['MD / 001', ['aster']],
    ['unmatched example', []],
    ['<script>synthetic</script>', []],
  ] as const)('matches %j against available fixture fields', (query, ids) => {
    expect(findExampleMedicines(query).map(item => item.id)).toEqual(ids);
  });
  it('normalizes the matching value without modifying fixtures or the entered string', () => {
    const query = '  Aster  ', before = JSON.stringify(medicines);
    expect(normalizeMedicineQuery(query)).toBe('aster');
    expect(query).toBe('  Aster  '); expect(JSON.stringify(medicines)).toBe(before);
    expect(findExampleMedicines(query)[0]).toBe(medicines[0]);
  });
});
