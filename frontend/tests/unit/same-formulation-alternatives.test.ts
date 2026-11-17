import { describe, expect, it } from 'vitest';
import type { CatalogueMedicineDetail } from '../../src/features/catalogue/medicine-catalogue-api';
import type { ContractV1MedicineMatch } from '../../src/features/prescriptions/prescription-api';
import {
  assessSameFormulation,
  matchesReportedCatalogueMatch,
  parseOfficialCatalogueId,
} from '../../src/features/prescriptions/same-formulation-alternatives';

const originalId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';
const originalIdentity = {
  salt_identity: 'Paracetamol',
  administration_route: 'oral',
  release_characteristics: 'immediate release',
  product_id: 'product-a',
  manufacturer_id: 'manufacturer-a',
  manufacturer_name: 'Manufacturer A',
  source_record_id: 'NLEM:2.1.5:f1',
};

function formulationIdentity(overrides: Partial<typeof originalIdentity> = {}) {
  return { ...originalIdentity, ...overrides };
}

function medicineDetail(overrides: Partial<CatalogueMedicineDetail> = {}): CatalogueMedicineDetail {
  return {
    id: originalId,
    canonical_name: 'PARACETAMOL 500 MG TABLET',
    generic_name: 'Paracetamol',
    brand_name: null,
    dosage_form: 'Tablet',
    strength_value: 500,
    strength_unit: 'mg',
    manufacturer_name: null,
    catalogue_source: 'official_catalogue',
    id_namespace: 'official_catalogue.formulation_id',
    ingredients: [{ name: 'Paracetamol', strength_value: 500, strength_unit: 'mg' }],
    aliases: [],
    sources: ['mohfw_india_nlem_2022'],
    prices: [],
    formulation_identity: formulationIdentity(),
    ...overrides,
  };
}

describe('same-formulation evidence assessment', () => {
  it('accepts exact source-backed ingredients, strengths, units, dosage forms and structured identity', () => {
    const result = assessSameFormulation(
      medicineDetail(),
      medicineDetail({
        id: candidateId,
        canonical_name: 'PARACETAMOL 500 MG TABLET - RECORD B',
        formulation_identity: formulationIdentity({
          product_id: 'product-b',
          manufacturer_id: 'manufacturer-b',
          manufacturer_name: 'Manufacturer B',
          source_record_id: 'NLEM:2.1.5:f2',
        }),
      }),
    );
    expect(result).toEqual({ status: 'verified' });
  });

  it('matches combination ingredient sets independent of order', () => {
    const original = medicineDetail({
      ingredients: [
        { name: 'Ingredient A', strength_value: 500, strength_unit: 'mg' },
        { name: 'Ingredient B', strength_value: 125, strength_unit: 'mg' },
      ],
    });
    const candidate = medicineDetail({
      id: candidateId,
      ingredients: [
        { name: 'Ingredient B', strength_value: '125.0', strength_unit: 'milligrams' },
        { name: 'Ingredient A', strength_value: '500.00', strength_unit: 'mg' },
      ],
    });
    expect(assessSameFormulation(original, candidate).status).toBe('verified');
  });

  it('rejects a partial combination or a different strength', () => {
    const original = medicineDetail({
      ingredients: [
        { name: 'Ingredient A', strength_value: 500, strength_unit: 'mg' },
        { name: 'Ingredient B', strength_value: 125, strength_unit: 'mg' },
      ],
    });
    const partial = medicineDetail({
      id: candidateId,
      ingredients: [{ name: 'Ingredient A', strength_value: 500, strength_unit: 'mg' }],
    });
    const wrongStrength = medicineDetail({
      id: candidateId,
      ingredients: [{ name: 'Paracetamol', strength_value: 650, strength_unit: 'mg' }],
    });
    expect(assessSameFormulation(original, partial).status).toBe('different');
    expect(assessSameFormulation(medicineDetail(), wrongStrength).status).toBe('different');
  });

  it('rejects a source record whose single-ingredient name conflicts with its structured strength', () => {
    const conflictingRecord = medicineDetail({
      id: candidateId,
      canonical_name: 'PARACETAMOL 650 MG TABLET',
      ingredients: [{ name: 'Paracetamol', strength_value: 500, strength_unit: 'mg' }],
    });
    expect(assessSameFormulation(medicineDetail(), conflictingRecord).status).toBe('different');
  });

  it('requires exact dosage form and validated unit aliases without cross-scale conversion', () => {
    const differentForm = medicineDetail({ id: candidateId, dosage_form: 'Oral liquid' });
    const differentScale = medicineDetail({
      id: candidateId,
      ingredients: [{ name: 'Paracetamol', strength_value: 0.5, strength_unit: 'g' }],
    });
    const alias = medicineDetail({
      id: candidateId,
      ingredients: [{ name: 'Paracetamol', strength_value: 500, strength_unit: 'milligrams' }],
    });
    expect(assessSameFormulation(medicineDetail(), differentForm).status).toBe('different');
    expect(assessSameFormulation(medicineDetail(), differentScale).status).toBe('different');
    expect(assessSameFormulation(medicineDetail(), alias).status).toBe('verified');
  });

  it('fails closed for missing, unsupported or ambiguous provenance and strength data', () => {
    const unknownUnit = medicineDetail({
      id: candidateId,
      ingredients: [{ name: 'Paracetamol', strength_value: 500, strength_unit: 'tablet' }],
    });
    const missingStrength = medicineDetail({
      id: candidateId,
      ingredients: [{ name: 'Paracetamol', strength_value: null, strength_unit: 'mg' }],
    });
    const unknownSource = medicineDetail({ id: candidateId, sources: ['unverified-source'] });
    const ambiguousSources = medicineDetail({
      id: candidateId,
      sources: ['mohfw_india_nlem_2022', 'nlm_rxnorm_rxnconso'],
    });
    const incompleteIdentity = medicineDetail({
      id: candidateId,
      formulation_identity: formulationIdentity({ manufacturer_id: '' }),
    });
    const conflictingManufacturer = medicineDetail({
      id: candidateId,
      manufacturer_name: 'Conflicting manufacturer',
    });
    expect(assessSameFormulation(medicineDetail(), unknownUnit).status).toBe('insufficient');
    expect(assessSameFormulation(medicineDetail(), missingStrength).status).toBe('insufficient');
    expect(assessSameFormulation(medicineDetail(), unknownSource).status).toBe('insufficient');
    expect(assessSameFormulation(medicineDetail(), ambiguousSources).status).toBe('insufficient');
    expect(assessSameFormulation(medicineDetail(), incompleteIdentity).status).toBe('insufficient');
    expect(assessSameFormulation(medicineDetail(), conflictingManufacturer).status).toBe('insufficient');
  });

  it('requires structured salt, route, release, product and source identity instead of name-derived clues', () => {
    const injection = medicineDetail({
      id: candidateId,
      formulation_identity: formulationIdentity({ administration_route: 'intramuscular' }),
    });
    const extendedRelease = medicineDetail({
      id: candidateId,
      formulation_identity: formulationIdentity({ release_characteristics: 'extended release' }),
    });
    const differentSalt = medicineDetail({
      id: candidateId,
      formulation_identity: formulationIdentity({ salt_identity: 'different salt' }),
    });
    const noIdentity = medicineDetail({
      id: candidateId,
      canonical_name: 'PARACETAMOL 500 MG ORAL EXTENDED-RELEASE TABLET',
      formulation_identity: null,
    });
    expect(assessSameFormulation(medicineDetail(), injection).status).toBe('different');
    expect(assessSameFormulation(medicineDetail(), extendedRelease).status).toBe('different');
    expect(assessSameFormulation(medicineDetail(), differentSalt).status).toBe('different');
    expect(assessSameFormulation(medicineDetail(), noIdentity).status).toBe('insufficient');
  });

  it('requires a distinct candidate catalogue record', () => {
    expect(assessSameFormulation(medicineDetail(), medicineDetail()).status).toBe('different');
  });

  it('parses only explicitly namespaced official catalogue UUIDs', () => {
    expect(parseOfficialCatalogueId(`official_catalogue:${candidateId}`)).toBe(candidateId);
    expect(parseOfficialCatalogueId(candidateId)).toBeNull();
    expect(parseOfficialCatalogueId('official_catalogue:not-a-uuid')).toBeNull();
  });

  it('confirms that the result match agrees with its official catalogue source record', () => {
    const match: ContractV1MedicineMatch = {
      status: 'matched',
      confidence: 1,
      medicine_external_id: `official_catalogue:${originalId}`,
      brand_name: null,
      dosage_form: 'tablet',
      ingredients: [{ name: 'paracetamol', strength_value: 500, strength_unit: 'mg' }],
      formulation_identity: formulationIdentity(),
    };
    expect(matchesReportedCatalogueMatch(medicineDetail(), match)).toBe(true);
    expect(matchesReportedCatalogueMatch(
      medicineDetail({ ingredients: [{ name: 'Paracetamol', strength_value: 650, strength_unit: 'mg' }] }),
      match,
    )).toBe(false);
    expect(matchesReportedCatalogueMatch(
      medicineDetail(),
      { ...match, formulation_identity: null },
    )).toBe(false);
  });
});
