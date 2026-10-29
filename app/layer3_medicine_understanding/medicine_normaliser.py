import re

from app.schemas.medicine import (
    MedicineUsageRecord,
)


def normalize_medicine_record(
    record: MedicineUsageRecord,
) -> MedicineUsageRecord:
    """
    Normalize medicine information without changing its meaning.

    This component standardizes representation only.

    It does not:
    - identify canonical medicine identity
    - perform brand-to-generic conversion
    - query a medicine database
    - infer missing information

    Canonical medicine matching belongs to Layer 4.
    """

    record.normalized_medicine_name = (
        normalize_medicine_name(
            record.raw_medicine_name
        )
    )

    record.dosage_form = (
        normalize_dosage_form(
            record.dosage_form
        )
    )

    normalize_strength(
        record
    )

    return record


def normalize_medicine_name(
    name: str | None,
) -> str | None:
    """
    Normalize formatting of a medicine name.

    Examples:

        PARACETAMOL
        -> paracetamol

        Paracetamol
        -> paracetamol

        Paracetamol   500
        -> paracetamol 500

    No canonical identity is inferred.
    """

    if name is None:
        return None

    normalized = " ".join(
        name.split()
    )

    if not normalized:
        return None

    normalized = normalized.lower()

    return normalized


def normalize_dosage_form(
    dosage_form: str | None,
) -> str | None:
    """
    Normalize dosage-form formatting.

    The parser already performs primary alias resolution.
    This function acts as a defensive normalization boundary.
    """

    if dosage_form is None:
        return None

    normalized = (
        dosage_form
        .strip()
        .lower()
    )

    if not normalized:
        return None

    return normalized


def normalize_strength(
    record: MedicineUsageRecord,
) -> None:
    """
    Normalize structured strength representation.

    Strength is already structurally parsed by medicine_parser.
    This function ensures its unit representation remains
    consistent.
    """

    if record.strength.unit is not None:

        record.strength.unit = (
            record.strength.unit
            .strip()
            .lower()
        )

        if not record.strength.unit:
            record.strength.unit = None

    if record.strength.value is not None:

        record.strength.value = float(
            record.strength.value
        )