/**
 * Prescription Review Domain Operations
 * Immutable state transformations conforming to Review Contract v1.
 */

import {
  REVIEW_CONFIRMATION_STATEMENT,
  REVIEW_CONTRACT_VERSION,
  REVIEW_EDITABLE_FIELDS,
  type PrescriptionReviewContractV1,
  type ReviewEditableField,
  type ReviewFieldProvenanceMapV1,
  type ReviewMedicineEntryV1,
  type ReviewMedicineFieldsV1,
  type ReviewValueWithUnitV1,
  type ReviewWarningItem,
} from './types';

export class PrescriptionReviewDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PrescriptionReviewDomainError';
  }
}

export function emptyValueWithUnit(): ReviewValueWithUnitV1 {
  return { value: null, unit: null };
}

export function emptyMedicineFields(): ReviewMedicineFieldsV1 {
  return {
    medicineName: null,
    brandName: null,
    genericName: null,
    strength: emptyValueWithUnit(),
    dosageForm: null,
    dose: emptyValueWithUnit(),
    frequency: null,
    timing: null,
    route: null,
    duration: emptyValueWithUnit(),
    quantity: emptyValueWithUnit(),
    notes: null,
  };
}

export function getFieldValue(
  fields: ReviewMedicineFieldsV1,
  field: ReviewEditableField,
): string | null {
  switch (field) {
    case 'strengthValue':
      return fields.strength.value;
    case 'strengthUnit':
      return fields.strength.unit;
    case 'doseValue':
      return fields.dose.value;
    case 'doseUnit':
      return fields.dose.unit;
    case 'durationValue':
      return fields.duration.value;
    case 'durationUnit':
      return fields.duration.unit;
    case 'quantityValue':
      return fields.quantity.value;
    case 'quantityUnit':
      return fields.quantity.unit;
    default:
      return fields[field];
  }
}

export function defaultProvenance(
  fields: ReviewMedicineFieldsV1,
  source: 'ocr_observed' | 'user_corrected',
): ReviewFieldProvenanceMapV1 {
  const result: Record<string, { source: string; evidenceReference: null }> = {};
  for (const field of REVIEW_EDITABLE_FIELDS) {
    const val = getFieldValue(fields, field);
    result[field] = {
      source: val === null ? 'unresolved' : source,
      evidenceReference: null,
    };
  }
  return result as unknown as ReviewFieldProvenanceMapV1;
}

export function updateMedicineFields(
  fields: ReviewMedicineFieldsV1,
  updates: Partial<Record<ReviewEditableField, string | null>>,
): ReviewMedicineFieldsV1 {
  const next: { -readonly [K in keyof ReviewMedicineFieldsV1]: ReviewMedicineFieldsV1[K] } = {
    medicineName: fields.medicineName,
    brandName: fields.brandName,
    genericName: fields.genericName,
    strength: { value: fields.strength.value, unit: fields.strength.unit },
    dosageForm: fields.dosageForm,
    dose: { value: fields.dose.value, unit: fields.dose.unit },
    frequency: fields.frequency,
    timing: fields.timing,
    route: fields.route,
    duration: { value: fields.duration.value, unit: fields.duration.unit },
    quantity: { value: fields.quantity.value, unit: fields.quantity.unit },
    notes: fields.notes,
  };

  for (const [field, val] of Object.entries(updates) as [ReviewEditableField, string | null][]) {
    const trimmed = typeof val === 'string' && val.trim() ? val.trim() : null;
    switch (field) {
      case 'strengthValue':
        next.strength = { ...next.strength, value: trimmed };
        break;
      case 'strengthUnit':
        next.strength = { ...next.strength, unit: trimmed };
        break;
      case 'doseValue':
        next.dose = { ...next.dose, value: trimmed };
        break;
      case 'doseUnit':
        next.dose = { ...next.dose, unit: trimmed };
        break;
      case 'durationValue':
        next.duration = { ...next.duration, value: trimmed };
        break;
      case 'durationUnit':
        next.duration = { ...next.duration, unit: trimmed };
        break;
      case 'quantityValue':
        next.quantity = { ...next.quantity, value: trimmed };
        break;
      case 'quantityUnit':
        next.quantity = { ...next.quantity, unit: trimmed };
        break;
      default:
        (next as unknown as Record<string, string | null>)[field] = trimmed;
        break;
    }
  }

  return next;
}

export function deriveUnresolvedFields(medicines: readonly ReviewMedicineEntryV1[]): string[] {
  const unresolved: string[] = [];
  for (const medicine of medicines.filter((m) => m.status === 'active')) {
    for (const field of REVIEW_EDITABLE_FIELDS) {
      const val = getFieldValue(medicine.current, field);
      if (val === null || medicine.provenance[field]?.source === 'unresolved') {
        unresolved.push(`medicines.${medicine.medicineId}.${field}`);
      }
    }
  }
  return unresolved.sort();
}

export function deriveMedicineWarnings(medicine: ReviewMedicineEntryV1): ReviewWarningItem[] {
  const warnings: ReviewWarningItem[] = [];

  // Check uncertain medicine name
  if (!medicine.current.medicineName) {
    warnings.push({
      code: 'MISSING_MEDICINE_NAME',
      message: 'Medicine name is missing. Please provide a verified formulation name.',
      field: 'medicineName',
      severity: 'danger',
    });
  } else if (medicine.provenance.medicineName?.isUncertain) {
    warnings.push({
      code: 'UNCERTAIN_MEDICINE_NAME',
      message: 'OCR confidence for medicine name was ambiguous or low. Please review against physical prescription.',
      field: 'medicineName',
      severity: 'warning',
    });
  }

  // Check strength
  if (!medicine.current.strength.value) {
    warnings.push({
      code: 'MISSING_STRENGTH',
      message: 'Strength is not specified. Confirm dosage amount if applicable.',
      field: 'strengthValue',
      severity: 'info',
    });
  } else if (medicine.provenance.strengthValue?.isUncertain) {
    warnings.push({
      code: 'UNCERTAIN_STRENGTH',
      message: 'OCR was uncertain about numeric strength value.',
      field: 'strengthValue',
      severity: 'warning',
    });
  }

  // Check dosage form
  if (!medicine.current.dosageForm) {
    warnings.push({
      code: 'MISSING_DOSAGE_FORM',
      message: 'Dosage form (e.g. tablet, capsule, syrup) is unspecified.',
      field: 'dosageForm',
      severity: 'info',
    });
  }

  // Check frequency & timing
  if (!medicine.current.frequency && !medicine.current.timing) {
    warnings.push({
      code: 'UNKNOWN_FREQUENCY',
      message: 'Dosage schedule or intake frequency was not recognized.',
      field: 'frequency',
      severity: 'warning',
    });
  }

  // Check duration
  if (!medicine.current.duration.value) {
    warnings.push({
      code: 'MISSING_DURATION',
      message: 'Treatment duration is unspecified.',
      field: 'durationValue',
      severity: 'info',
    });
  }

  return warnings;
}

export function isFieldModified(medicine: ReviewMedicineEntryV1, field: ReviewEditableField): boolean {
  if (medicine.origin === 'user_added') return true;
  if (!medicine.original) return true;
  const originalVal = getFieldValue(medicine.original, field);
  const currentVal = getFieldValue(medicine.current, field);
  return originalVal !== currentVal;
}

export function isFieldUncertain(medicine: ReviewMedicineEntryV1, field: ReviewEditableField): boolean {
  return Boolean(medicine.provenance[field]?.isUncertain);
}

// ---------------- DOMAIN MUTATIONS ----------------

export function createInitialReviewDraft(input: {
  prescriptionId: string;
  revisionId: string;
  evidence: PrescriptionReviewContractV1['evidence'];
  medicines: readonly {
    medicineId: string;
    fields: ReviewMedicineFieldsV1;
    provenance?: Partial<ReviewFieldProvenanceMapV1>;
  }[];
  now?: string;
}): PrescriptionReviewContractV1 {
  const now = input.now ?? new Date().toISOString();
  const medicines: ReviewMedicineEntryV1[] = input.medicines.map((m, index) => {
    const baseProv = defaultProvenance(m.fields, 'ocr_observed');
    const entry: ReviewMedicineEntryV1 = {
      medicineId: m.medicineId,
      origin: 'extracted',
      status: 'active',
      position: index + 1,
      original: { ...m.fields },
      current: { ...m.fields },
      provenance: { ...baseProv, ...(m.provenance ?? {}) },
      addedByCommandId: null,
      removedAt: null,
    };
    return {
      ...entry,
      reviewWarnings: deriveMedicineWarnings(entry),
    };
  });

  return {
    schemaVersion: REVIEW_CONTRACT_VERSION,
    prescriptionId: input.prescriptionId,
    evidence: input.evidence,
    revisionId: input.revisionId,
    revisionNumber: 1,
    baseRevisionId: null,
    status: 'draft',
    lockVersion: 0,
    medicines,
    unresolvedFields: deriveUnresolvedFields(medicines),
    confirmation: {
      status: 'pending',
      statement: REVIEW_CONFIRMATION_STATEMENT,
      confirmedAt: null,
      idempotencyKey: null,
    },
    canonicalInputFingerprint: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function editMedicineFields(
  review: PrescriptionReviewContractV1,
  command: {
    expectedLockVersion: number;
    medicineId: string;
    updates: Partial<Record<ReviewEditableField, string | null>>;
    now?: string;
  },
): PrescriptionReviewContractV1 {
  if (review.status === 'confirmed') {
    throw new PrescriptionReviewDomainError('REVIEW_IMMUTABLE', 'Confirmed review revisions are immutable.');
  }
  if (review.lockVersion !== command.expectedLockVersion) {
    throw new PrescriptionReviewDomainError('REVIEW_STALE', 'The review was updated by another session. Please reload to inspect the latest revision.');
  }

  const now = command.now ?? new Date().toISOString();
  let found = false;

  const medicines = review.medicines.map((medicine) => {
    if (medicine.medicineId !== command.medicineId) return medicine;
    found = true;
    if (medicine.status !== 'active') {
      throw new PrescriptionReviewDomainError('REVIEW_INVALID_TRANSITION', 'Removed medicines must be restored before editing.');
    }

    const current = updateMedicineFields(medicine.current, command.updates);
    const provenance = { ...medicine.provenance };

    for (const [field, val] of Object.entries(command.updates) as [ReviewEditableField, string | null][]) {
      const origVal = medicine.original ? getFieldValue(medicine.original, field) : null;
      const isBackToOrig = medicine.original !== null && origVal === val;

      provenance[field] = {
        source: isBackToOrig ? 'ocr_observed' : val === null ? 'unresolved' : 'user_corrected',
        evidenceReference: null,
        isUncertain: isBackToOrig ? medicine.provenance[field]?.isUncertain : false,
      };
    }

    const updatedEntry: ReviewMedicineEntryV1 = {
      ...medicine,
      current,
      provenance,
    };

    return {
      ...updatedEntry,
      reviewWarnings: deriveMedicineWarnings(updatedEntry),
    };
  });

  if (!found) {
    throw new PrescriptionReviewDomainError('REVIEW_MEDICINE_NOT_FOUND', 'Medicine was not found in this revision.');
  }

  return {
    ...review,
    lockVersion: review.lockVersion + 1,
    medicines,
    unresolvedFields: deriveUnresolvedFields(medicines),
    updatedAt: now,
  };
}

export function addMedicine(
  review: PrescriptionReviewContractV1,
  command: {
    expectedLockVersion: number;
    medicineId: string;
    fields: ReviewMedicineFieldsV1;
    position?: number;
    commandId?: string;
    now?: string;
  },
): PrescriptionReviewContractV1 {
  if (review.status === 'confirmed') {
    throw new PrescriptionReviewDomainError('REVIEW_IMMUTABLE', 'Confirmed review revisions are immutable.');
  }
  if (review.lockVersion !== command.expectedLockVersion) {
    throw new PrescriptionReviewDomainError('REVIEW_STALE', 'The review was updated by another session. Please reload.');
  }
  if (review.medicines.some((m) => m.medicineId === command.medicineId)) {
    throw new PrescriptionReviewDomainError('REVIEW_DUPLICATE_MEDICINE', 'Medicine identifier already exists.');
  }
  if (!command.fields.medicineName?.trim()) {
    throw new PrescriptionReviewDomainError('REVIEW_INVALID', 'A user-added medicine requires a medicine name.');
  }

  const now = command.now ?? new Date().toISOString();
  const activeCount = review.medicines.filter((m) => m.status === 'active').length;
  const position = command.position ?? activeCount + 1;

  const shifted = review.medicines.map((m) =>
    m.status === 'active' && m.position >= position ? { ...m, position: m.position + 1 } : m,
  );

  const baseProv = defaultProvenance(command.fields, 'user_corrected');
  const newEntry: ReviewMedicineEntryV1 = {
    medicineId: command.medicineId,
    origin: 'user_added',
    status: 'active',
    position,
    original: null,
    current: { ...command.fields },
    provenance: baseProv,
    addedByCommandId: command.commandId ?? `cmd-${Date.now()}`,
    removedAt: null,
  };

  const withWarnings: ReviewMedicineEntryV1 = {
    ...newEntry,
    reviewWarnings: deriveMedicineWarnings(newEntry),
  };

  const allMedicines = [...shifted, withWarnings].sort((a, b) => a.position - b.position);

  return {
    ...review,
    lockVersion: review.lockVersion + 1,
    medicines: allMedicines,
    unresolvedFields: deriveUnresolvedFields(allMedicines),
    updatedAt: now,
  };
}

export function removeMedicine(
  review: PrescriptionReviewContractV1,
  command: {
    expectedLockVersion: number;
    medicineId: string;
    now?: string;
  },
): PrescriptionReviewContractV1 {
  if (review.status === 'confirmed') {
    throw new PrescriptionReviewDomainError('REVIEW_IMMUTABLE', 'Confirmed review revisions are immutable.');
  }
  if (review.lockVersion !== command.expectedLockVersion) {
    throw new PrescriptionReviewDomainError('REVIEW_STALE', 'The review was updated by another session.');
  }

  const now = command.now ?? new Date().toISOString();
  const target = review.medicines.find((m) => m.medicineId === command.medicineId);
  if (!target) {
    throw new PrescriptionReviewDomainError('REVIEW_MEDICINE_NOT_FOUND', 'Medicine was not found in this revision.');
  }
  if (target.status === 'removed') return review;

  const medicines = review.medicines.map((m) =>
    m.medicineId === command.medicineId ? { ...m, status: 'removed' as const, removedAt: now } : m,
  );

  return {
    ...review,
    lockVersion: review.lockVersion + 1,
    medicines,
    unresolvedFields: deriveUnresolvedFields(medicines),
    updatedAt: now,
  };
}

export function restoreMedicine(
  review: PrescriptionReviewContractV1,
  command: {
    expectedLockVersion: number;
    medicineId: string;
    now?: string;
  },
): PrescriptionReviewContractV1 {
  if (review.status === 'confirmed') {
    throw new PrescriptionReviewDomainError('REVIEW_IMMUTABLE', 'Confirmed review revisions are immutable.');
  }
  if (review.lockVersion !== command.expectedLockVersion) {
    throw new PrescriptionReviewDomainError('REVIEW_STALE', 'The review was updated by another session.');
  }

  const now = command.now ?? new Date().toISOString();
  const target = review.medicines.find((m) => m.medicineId === command.medicineId);
  if (!target) {
    throw new PrescriptionReviewDomainError('REVIEW_MEDICINE_NOT_FOUND', 'Medicine was not found in this revision.');
  }
  if (target.status === 'active') return review;

  const activeCount = review.medicines.filter((m) => m.status === 'active').length;
  const insertionPosition = Math.min(target.position, activeCount + 1);

  const medicines = review.medicines.map((m) => {
    if (m.medicineId === command.medicineId) {
      return { ...m, status: 'active' as const, position: insertionPosition, removedAt: null };
    }
    return m.status === 'active' && m.position >= insertionPosition
      ? { ...m, position: m.position + 1 }
      : m;
  });

  return {
    ...review,
    lockVersion: review.lockVersion + 1,
    medicines: medicines.sort((a, b) => a.position - b.position),
    unresolvedFields: deriveUnresolvedFields(medicines),
    updatedAt: now,
  };
}

export function restoreOriginalMedicineValues(
  review: PrescriptionReviewContractV1,
  command: {
    expectedLockVersion: number;
    medicineId: string;
    now?: string;
  },
): PrescriptionReviewContractV1 {
  if (review.status === 'confirmed') {
    throw new PrescriptionReviewDomainError('REVIEW_IMMUTABLE', 'Confirmed review revisions are immutable.');
  }
  if (review.lockVersion !== command.expectedLockVersion) {
    throw new PrescriptionReviewDomainError('REVIEW_STALE', 'The review was updated by another session.');
  }

  const now = command.now ?? new Date().toISOString();
  const target = review.medicines.find((m) => m.medicineId === command.medicineId);
  if (!target) {
    throw new PrescriptionReviewDomainError('REVIEW_MEDICINE_NOT_FOUND', 'Medicine was not found in this revision.');
  }
  if (!target.original) {
    throw new PrescriptionReviewDomainError('REVIEW_INVALID_TRANSITION', 'A user-added medicine has no OCR original to restore.');
  }

  const provenance = defaultProvenance(target.original, 'ocr_observed');
  const medicines = review.medicines.map((m) => {
    if (m.medicineId === command.medicineId) {
      const restored: ReviewMedicineEntryV1 = {
        ...m,
        current: { ...target.original! },
        provenance,
      };
      return {
        ...restored,
        reviewWarnings: deriveMedicineWarnings(restored),
      };
    }
    return m;
  });

  return {
    ...review,
    lockVersion: review.lockVersion + 1,
    medicines,
    unresolvedFields: deriveUnresolvedFields(medicines),
    updatedAt: now,
  };
}

export function restoreOriginalFieldValue(
  review: PrescriptionReviewContractV1,
  command: {
    expectedLockVersion: number;
    medicineId: string;
    field: ReviewEditableField;
    now?: string;
  },
): PrescriptionReviewContractV1 {
  const target = review.medicines.find((m) => m.medicineId === command.medicineId);
  if (!target?.original) {
    throw new PrescriptionReviewDomainError('REVIEW_INVALID_TRANSITION', 'No original OCR value exists for this field.');
  }
  const originalVal = getFieldValue(target.original, command.field);
  return editMedicineFields(review, {
    expectedLockVersion: command.expectedLockVersion,
    medicineId: command.medicineId,
    updates: { [command.field]: originalVal },
    now: command.now,
  });
}

export function reorderMedicines(
  review: PrescriptionReviewContractV1,
  command: {
    expectedLockVersion: number;
    orderedMedicineIds: readonly string[];
    now?: string;
  },
): PrescriptionReviewContractV1 {
  if (review.status === 'confirmed') {
    throw new PrescriptionReviewDomainError('REVIEW_IMMUTABLE', 'Confirmed review revisions are immutable.');
  }
  if (review.lockVersion !== command.expectedLockVersion) {
    throw new PrescriptionReviewDomainError('REVIEW_STALE', 'The review was updated by another session.');
  }

  const now = command.now ?? new Date().toISOString();
  const active = review.medicines.filter((m) => m.status === 'active');

  if (
    new Set(command.orderedMedicineIds).size !== command.orderedMedicineIds.length ||
    command.orderedMedicineIds.length !== active.length ||
    active.some((m) => !command.orderedMedicineIds.includes(m.medicineId))
  ) {
    throw new PrescriptionReviewDomainError('REVIEW_INVALID', 'Reorder must contain every active medicine exactly once.');
  }

  const positions = new Map(command.orderedMedicineIds.map((id, index) => [id, index + 1]));
  const medicines = review.medicines.map((m) =>
    m.status === 'active' ? { ...m, position: positions.get(m.medicineId)! } : m,
  );

  return {
    ...review,
    lockVersion: review.lockVersion + 1,
    medicines: medicines.sort((a, b) => a.position - b.position),
    updatedAt: now,
  };
}

export function saveReviewDraft(
  review: PrescriptionReviewContractV1,
  command: {
    expectedLockVersion: number;
    now?: string;
  },
): PrescriptionReviewContractV1 {
  if (review.status === 'confirmed') {
    throw new PrescriptionReviewDomainError('REVIEW_IMMUTABLE', 'Confirmed review revisions are immutable.');
  }
  if (review.lockVersion !== command.expectedLockVersion) {
    throw new PrescriptionReviewDomainError('REVIEW_STALE', 'The review was updated by another session.');
  }
  const now = command.now ?? new Date().toISOString();
  return {
    ...review,
    updatedAt: now,
  };
}

export function confirmReview(
  review: PrescriptionReviewContractV1,
  command: {
    expectedLockVersion: number;
    idempotencyKey: string;
    now?: string;
  },
): PrescriptionReviewContractV1 {
  if (review.status === 'confirmed') {
    if (review.confirmation.idempotencyKey === command.idempotencyKey) return review;
    throw new PrescriptionReviewDomainError('REVIEW_INVALID_TRANSITION', 'This revision is already confirmed.');
  }
  if (review.lockVersion !== command.expectedLockVersion) {
    throw new PrescriptionReviewDomainError('REVIEW_STALE', 'The review was changed by another session.');
  }
  const activeMedicines = review.medicines.filter((m) => m.status === 'active');
  if (activeMedicines.length === 0) {
    throw new PrescriptionReviewDomainError('REVIEW_INVALID_TRANSITION', 'At least one active medicine is required for confirmation.');
  }
  if (activeMedicines.some((m) => !m.current.medicineName?.trim())) {
    throw new PrescriptionReviewDomainError('REVIEW_INVALID', 'Every active medicine must have a valid medicine name.');
  }

  const now = command.now ?? new Date().toISOString();
  return {
    ...review,
    status: 'confirmed',
    lockVersion: review.lockVersion + 1,
    confirmation: {
      status: 'confirmed',
      statement: REVIEW_CONFIRMATION_STATEMENT,
      confirmedAt: now,
      idempotencyKey: command.idempotencyKey.trim(),
    },
    updatedAt: now,
  };
}

export function createDraftFromConfirmed(
  review: PrescriptionReviewContractV1,
  command: {
    revisionId: string;
    now?: string;
  },
): PrescriptionReviewContractV1 {
  if (review.status !== 'confirmed') {
    throw new PrescriptionReviewDomainError('REVIEW_INVALID_TRANSITION', 'Only a confirmed revision can be reopened as a new draft.');
  }
  const now = command.now ?? new Date().toISOString();
  return {
    ...review,
    revisionId: command.revisionId,
    revisionNumber: review.revisionNumber + 1,
    baseRevisionId: review.revisionId,
    status: 'draft',
    lockVersion: 0,
    confirmation: {
      status: 'pending',
      statement: REVIEW_CONFIRMATION_STATEMENT,
      confirmedAt: null,
      idempotencyKey: null,
    },
    canonicalInputFingerprint: null,
    medicines: review.medicines.map((m) => ({ ...m, addedByCommandId: null })),
    createdAt: now,
    updatedAt: now,
  };
}
