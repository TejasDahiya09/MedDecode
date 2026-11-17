import type {
  CatalogueFormulationIdentity,
  CatalogueMedicineDetail,
} from '../catalogue/medicine-catalogue-api';
import type { ContractV1MedicineMatch } from './prescription-api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const verifiedSourceKeys = new Set(['mohfw_india_nlem_2022', 'nlm_rxnorm_rxnconso']);

const unitAliases = new Map<string, string>([
  ['g', 'g'],
  ['gram', 'g'],
  ['grams', 'g'],
  ['mg', 'mg'],
  ['milligram', 'mg'],
  ['milligrams', 'mg'],
  ['mcg', 'mcg'],
  ['ug', 'mcg'],
  ['microgram', 'mcg'],
  ['micrograms', 'mcg'],
  ['mg/ml', 'mg/ml'],
  ['mcg/ml', 'mcg/ml'],
  ['ug/ml', 'mcg/ml'],
  ['mg/5ml', 'mg/5ml'],
  ['mcg/5ml', 'mcg/5ml'],
  ['ug/5ml', 'mcg/5ml'],
  ['%', '%'],
  ['percent', '%'],
  ['percentage', '%'],
  ['iu', 'iu'],
  ['iu/ml', 'iu/ml'],
  ['meq', 'meq'],
  ['meq/l', 'meq/l'],
  ['mmol', 'mmol'],
  ['mmol/l', 'mmol/l'],
]);

export type FormulationAssessment =
  | { readonly status: 'verified' }
  | { readonly status: 'different'; readonly reason: string }
  | { readonly status: 'insufficient'; readonly reason: string };

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function normalizeUnit(value: string): string | null {
  const compact = normalizeText(value).replace(/[µμ]/g, 'u').replace(/\s+/g, '');
  return unitAliases.get(compact) ?? null;
}

function normalizeStrength(value: number | string | null): string | null {
  if (value === null || (typeof value === 'number' && !Number.isFinite(value))) return null;
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text) || Number(text) <= 0) return null;
  const [whole = '0', fraction = ''] = text.split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function ingredientSignature(
  ingredients: readonly {
    readonly name: string;
    readonly strength_value: number | string | null;
    readonly strength_unit: string | null;
  }[],
): readonly string[] | null {
  if (ingredients.length === 0) return null;

  const entries: string[] = [];
  const names: string[] = [];
  for (const ingredient of ingredients) {
    const name = normalizeText(ingredient.name);
    const strength = normalizeStrength(ingredient.strength_value);
    const unit = ingredient.strength_unit ? normalizeUnit(ingredient.strength_unit) : null;
    if (!name || !strength || !unit) return null;
    names.push(name);
    entries.push(JSON.stringify([name, strength, unit]));
  }

  if (new Set(names).size !== entries.length) return null;
  return entries.sort((left, right) => left.localeCompare(right));
}

function canonicalNameStrengthConflict(detail: CatalogueMedicineDetail): boolean {
  if (detail.ingredients.length !== 1) return false;
  const declaredStrengths = Array.from(
    `${detail.canonical_name} ${detail.generic_name ?? ''}`.matchAll(
      /(\d+(?:\.\d+)?)\s*(mg\s*\/\s*(?:5\s*)?ml|mcg\s*\/\s*(?:5\s*)?ml|mg|mcg|[µμ]g|g|%)(?=\s|$|[^\p{L}])/giu,
    ),
  );
  if (declaredStrengths.length !== 1) return false;

  const value = declaredStrengths[0]?.[1] ?? '';
  const unit = declaredStrengths[0]?.[2] ?? '';
  const declaredValue = normalizeStrength(value);
  const declaredUnit = normalizeUnit(unit);
  const ingredient = detail.ingredients[0];
  const ingredientValue = ingredient ? normalizeStrength(ingredient.strength_value) : null;
  const ingredientUnit = ingredient?.strength_unit ? normalizeUnit(ingredient.strength_unit) : null;
  return Boolean(
    declaredValue
    && declaredUnit
    && ingredientValue
    && ingredientUnit
    && (declaredValue !== ingredientValue || declaredUnit !== ingredientUnit),
  );
}

function hasVerifiedSource(detail: CatalogueMedicineDetail): boolean {
  return detail.catalogue_source === 'official_catalogue'
    && detail.id_namespace === 'official_catalogue.formulation_id'
    && detail.sources.length === 1
    && verifiedSourceKeys.has(detail.sources[0] ?? '');
}

export function hasCompleteFormulationIdentity(
  identity: CatalogueFormulationIdentity | null | undefined,
): identity is CatalogueFormulationIdentity {
  return Boolean(
    identity
    && identity.salt_identity.trim()
    && identity.administration_route.trim()
    && identity.release_characteristics.trim()
    && identity.product_id.trim()
    && identity.manufacturer_id.trim()
    && identity.manufacturer_name.trim()
    && identity.source_record_id.trim(),
  );
}

function hasConflictingManufacturerName(detail: CatalogueMedicineDetail): boolean {
  const identity = detail.formulation_identity;
  return Boolean(
    detail.manufacturer_name
    && hasCompleteFormulationIdentity(identity)
    && normalizeText(detail.manufacturer_name) !== normalizeText(identity.manufacturer_name),
  );
}

function reportedIdentityMatches(
  detail: CatalogueFormulationIdentity | null | undefined,
  reported: CatalogueFormulationIdentity | null | undefined,
): boolean {
  return hasCompleteFormulationIdentity(detail)
    && hasCompleteFormulationIdentity(reported)
    && normalizeText(detail.salt_identity) === normalizeText(reported.salt_identity)
    && normalizeText(detail.administration_route) === normalizeText(reported.administration_route)
    && normalizeText(detail.release_characteristics) === normalizeText(reported.release_characteristics)
    && detail.product_id === reported.product_id
    && detail.manufacturer_id === reported.manufacturer_id
    && normalizeText(detail.manufacturer_name) === normalizeText(reported.manufacturer_name)
    && detail.source_record_id === reported.source_record_id;
}

function compareFormulationIdentity(
  original: CatalogueFormulationIdentity | null | undefined,
  candidate: CatalogueFormulationIdentity | null | undefined,
): FormulationAssessment | null {
  if (!hasCompleteFormulationIdentity(original) || !hasCompleteFormulationIdentity(candidate)) {
    return {
      status: 'insufficient',
      reason: 'Salt, route, release, product, manufacturer, or source-record evidence is incomplete.',
    };
  }
  if (normalizeText(original.salt_identity) !== normalizeText(candidate.salt_identity)) {
    return { status: 'different', reason: 'The verified salt identities do not match.' };
  }
  if (normalizeText(original.administration_route) !== normalizeText(candidate.administration_route)) {
    return { status: 'different', reason: 'The verified administration routes do not match.' };
  }
  if (normalizeText(original.release_characteristics) !== normalizeText(candidate.release_characteristics)) {
    return { status: 'different', reason: 'The verified release characteristics do not match.' };
  }
  return null;
}

export function parseOfficialCatalogueId(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^official_catalogue:([0-9a-f-]+)$/i.exec(value);
  if (!match || !uuidPattern.test(match[1] ?? '')) return null;
  return match[1] ?? null;
}

export function hasCompleteIngredientEvidence(
  ingredients: readonly {
    readonly name: string;
    readonly strength_value: number | string | null;
    readonly strength_unit: string | null;
  }[],
): boolean {
  return ingredientSignature(ingredients) !== null;
}

export function matchesReportedCatalogueMatch(
  detail: CatalogueMedicineDetail,
  match: ContractV1MedicineMatch,
): boolean {
  const id = parseOfficialCatalogueId(match.medicine_external_id);
  const reportedIngredients = match.ingredients ?? [];
  const detailSignature = ingredientSignature(detail.ingredients);
  const reportedSignature = ingredientSignature(reportedIngredients);
  return match.status === 'matched'
    && id !== null
    && detail.id.toLowerCase() === id.toLowerCase()
    && hasVerifiedSource(detail)
    && Boolean(detail.dosage_form?.trim())
    && Boolean(match.dosage_form?.trim())
    && !hasConflictingManufacturerName(detail)
    && reportedIdentityMatches(detail.formulation_identity, match.formulation_identity)
    && normalizeText(detail.dosage_form ?? '') === normalizeText(match.dosage_form ?? '')
    && detailSignature !== null
    && reportedSignature !== null
    && detailSignature.length === reportedSignature.length
    && detailSignature.every((entry, index) => entry === reportedSignature[index]);
}

export function assessSameFormulation(
  original: CatalogueMedicineDetail,
  candidate: CatalogueMedicineDetail,
): FormulationAssessment {
  if (!hasVerifiedSource(original) || !hasVerifiedSource(candidate)) {
    return { status: 'insufficient', reason: 'Official source provenance is missing or ambiguous.' };
  }
  if (hasConflictingManufacturerName(original) || hasConflictingManufacturerName(candidate)) {
    return { status: 'insufficient', reason: 'Manufacturer identity evidence conflicts.' };
  }
  if (original.id.toLowerCase() === candidate.id.toLowerCase()) {
    return { status: 'different', reason: 'The candidate is the original catalogue record.' };
  }
  if (!original.dosage_form?.trim() || !candidate.dosage_form?.trim()) {
    return { status: 'insufficient', reason: 'Dosage-form evidence is incomplete.' };
  }

  const originalIngredients = ingredientSignature(original.ingredients);
  const candidateIngredients = ingredientSignature(candidate.ingredients);
  if (!originalIngredients || !candidateIngredients) {
    return { status: 'insufficient', reason: 'Ingredient, strength, or unit evidence is incomplete or unsupported.' };
  }
  if (canonicalNameStrengthConflict(original) || canonicalNameStrengthConflict(candidate)) {
    return { status: 'different', reason: 'The canonical name conflicts with the structured ingredient strength.' };
  }
  if (
    originalIngredients.length !== candidateIngredients.length
    || originalIngredients.some((ingredient, index) => ingredient !== candidateIngredients[index])
  ) {
    return { status: 'different', reason: 'Ingredient composition, strength, or unit does not match exactly.' };
  }
  if (normalizeText(original.dosage_form) !== normalizeText(candidate.dosage_form)) {
    return { status: 'different', reason: 'Dosage forms do not match exactly.' };
  }

  const identityAssessment = compareFormulationIdentity(
    original.formulation_identity,
    candidate.formulation_identity,
  );
  if (identityAssessment) return identityAssessment;

  return { status: 'verified' };
}
