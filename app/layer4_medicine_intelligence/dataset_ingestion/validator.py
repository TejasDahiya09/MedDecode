"""
Validation layer for the MedDecode medicine dataset ingestion pipeline.

Responsibilities:
- Validate normalized medicine records
- Detect missing required fields
- Detect invalid numeric values
- Detect incomplete ingredient records
- Detect duplicate ingredients within one medicine record
- Detect invalid aliases
- Detect invalid price records
- Validate interaction relationships
- Validate similarity relationships
- Separate warnings from validation errors

This module does NOT:
- query the database
- find duplicate medicines already stored in the database
- decide whether a record should be inserted or updated
- merge records
- write data to PostgreSQL/Supabase

Pipeline position:

Raw CSV
    ↓
loader.py
    ↓
mapper.py
    ↓
transformer.py
    ↓
normalizer.py
    ↓
validator.py
    ↓
candidate_finder.py
    ↓
merger.py
    ↓
database_writer.py
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from .models import (
    CandidateSearchResult,
    MedicineInteractionRecord,
    MedicineRecord,
    MedicineSimilarityRecord,
    ValidationIssue,
    ValidationResult,
    ValidationStatus,
)


# ============================================================
# BASIC HELPERS
# ============================================================


def _is_blank(value: Optional[str]) -> bool:
    """
    Return True when a string is missing or empty.
    """

    return value is None or not str(value).strip()


def _add_error(
    errors: list[ValidationIssue],
    field_name: str,
    message: str,
    value: object = None,
) -> None:
    """
    Add a validation error.
    """

    errors.append(
        ValidationIssue(
            field_name=field_name,
            message=message,
            value=value,
        )
    )


def _add_warning(
    warnings: list[ValidationIssue],
    field_name: str,
    message: str,
    value: object = None,
) -> None:
    """
    Add a validation warning.
    """

    warnings.append(
        ValidationIssue(
            field_name=field_name,
            message=message,
            value=value,
        )
    )


# ============================================================
# DECIMAL VALIDATION
# ============================================================


def _validate_positive_decimal(
    value: Optional[Decimal],
    field_name: str,
    errors: list[ValidationIssue],
    allow_zero: bool = False,
) -> None:
    """
    Validate a decimal numeric value.

    If the value is present:
    - it must be numeric
    - it must be positive
    - zero may optionally be allowed
    """

    if value is None:
        return

    try:
        decimal_value = Decimal(str(value))
    except Exception:
        _add_error(
            errors=errors,
            field_name=field_name,
            message="Value must be a valid decimal number.",
            value=value,
        )
        return

    if allow_zero:
        if decimal_value < 0:
            _add_error(
                errors=errors,
                field_name=field_name,
                message="Value cannot be negative.",
                value=value,
            )
    else:
        if decimal_value <= 0:
            _add_error(
                errors=errors,
                field_name=field_name,
                message="Value must be greater than zero.",
                value=value,
            )


# ============================================================
# CORE MEDICINE VALIDATION
# ============================================================


def _validate_core_fields(
    medicine: MedicineRecord,
    errors: list[ValidationIssue],
    warnings: list[ValidationIssue],
) -> None:
    """
    Validate core medicine identity fields.
    """

    # canonical_name is required by the ingestion contract.
    if _is_blank(medicine.canonical_name):
        _add_error(
            errors=errors,
            field_name="canonical_name",
            message="Canonical medicine name is required.",
            value=medicine.canonical_name,
        )

    # normalized_name should have been created by normalizer.py.
    if _is_blank(medicine.normalized_name):
        _add_error(
            errors=errors,
            field_name="normalized_name",
            message=(
                "Normalized medicine name is required after "
                "normalization."
            ),
            value=medicine.normalized_name,
        )

    # A medicine without brand or generic information is not
    # necessarily invalid because some datasets may only provide
    # canonical_name.
    if (
        _is_blank(medicine.brand_name)
        and _is_blank(medicine.generic_name)
    ):
        _add_warning(
            warnings=warnings,
            field_name="brand_name/generic_name",
            message=(
                "Neither brand_name nor generic_name is provided. "
                "Canonical name will be the only identity label."
            ),
        )


# ============================================================
# PHARMACEUTICAL FIELD VALIDATION
# ============================================================


def _validate_pharmaceutical_fields(
    medicine: MedicineRecord,
    errors: list[ValidationIssue],
    warnings: list[ValidationIssue],
) -> None:
    """
    Validate strength and pharmaceutical information.
    """

    _validate_positive_decimal(
        value=medicine.strength_value,
        field_name="strength_value",
        errors=errors,
    )

    # Strength value without unit is ambiguous.
    if (
        medicine.strength_value is not None
        and _is_blank(medicine.strength_unit)
    ):
        _add_warning(
            warnings=warnings,
            field_name="strength_unit",
            message=(
                "strength_value is present but strength_unit "
                "is missing."
            ),
            value=medicine.strength_value,
        )

    # A unit without a numeric value is also incomplete.
    if (
        medicine.strength_value is None
        and not _is_blank(medicine.strength_unit)
    ):
        _add_warning(
            warnings=warnings,
            field_name="strength_value",
            message=(
                "strength_unit is present but strength_value "
                "is missing."
            ),
            value=medicine.strength_unit,
        )


# ============================================================
# MANUFACTURER VALIDATION
# ============================================================


def _validate_manufacturer(
    medicine: MedicineRecord,
    errors: list[ValidationIssue],
    warnings: list[ValidationIssue],
) -> None:
    """
    Validate manufacturer information.
    """

    manufacturer = medicine.manufacturer

    if manufacturer is None:
        return

    if _is_blank(manufacturer.name):
        _add_error(
            errors=errors,
            field_name="manufacturer.name",
            message=(
                "Manufacturer object exists but manufacturer "
                "name is missing."
            ),
        )

    if _is_blank(manufacturer.normalized_name):
        _add_warning(
            warnings=warnings,
            field_name="manufacturer.normalized_name",
            message=(
                "Manufacturer normalized_name is missing after "
                "normalization."
            ),
        )


# ============================================================
# INGREDIENT VALIDATION
# ============================================================


def _validate_ingredients(
    medicine: MedicineRecord,
    errors: list[ValidationIssue],
    warnings: list[ValidationIssue],
) -> None:
    """
    Validate medicine ingredients and detect duplicate ingredients.
    """

    seen_ingredients: set[str] = set()

    for index, record in enumerate(medicine.ingredients):

        prefix = f"ingredients[{index}]"

        # Ingredient object must contain a usable name.
        if _is_blank(record.ingredient.ingredient_name):
            _add_error(
                errors=errors,
                field_name=f"{prefix}.ingredient_name",
                message="Ingredient name is required.",
            )
            continue

        # normalized_name should have been created by normalizer.py.
        normalized_name = (
            record.ingredient.normalized_name
        )

        if _is_blank(normalized_name):
            _add_error(
                errors=errors,
                field_name=(
                    f"{prefix}.ingredient.normalized_name"
                ),
                message=(
                    "Ingredient normalized_name is required "
                    "after normalization."
                ),
            )
            continue

        # Detect duplicate ingredient references inside the same
        # medicine record.
        if normalized_name in seen_ingredients:
            _add_error(
                errors=errors,
                field_name=(
                    f"{prefix}.ingredient.normalized_name"
                ),
                message=(
                    "Duplicate ingredient detected within "
                    "the same medicine record."
                ),
                value=normalized_name,
            )
        else:
            seen_ingredients.add(normalized_name)

        # Validate ingredient strength.
        _validate_positive_decimal(
            value=record.ingredient_strength_value,
            field_name=(
                f"{prefix}.ingredient_strength_value"
            ),
            errors=errors,
        )

        # Strength value without unit.
        if (
            record.ingredient_strength_value is not None
            and _is_blank(
                record.ingredient_strength_unit
            )
        ):
            _add_warning(
                warnings=warnings,
                field_name=(
                    f"{prefix}.ingredient_strength_unit"
                ),
                message=(
                    "Ingredient strength value is present "
                    "but its unit is missing."
                ),
                value=(
                    record.ingredient_strength_value
                ),
            )

        # Unit without strength value.
        if (
            record.ingredient_strength_value is None
            and not _is_blank(
                record.ingredient_strength_unit
            )
        ):
            _add_warning(
                warnings=warnings,
                field_name=(
                    f"{prefix}.ingredient_strength_value"
                ),
                message=(
                    "Ingredient strength unit is present "
                    "but numeric strength is missing."
                ),
                value=(
                    record.ingredient_strength_unit
                ),
            )


# ============================================================
# ALIAS VALIDATION
# ============================================================


def _validate_aliases(
    medicine: MedicineRecord,
    errors: list[ValidationIssue],
    warnings: list[ValidationIssue],
) -> None:
    """
    Validate medicine aliases and detect duplicates.
    """

    seen_aliases: set[str] = set()

    for index, alias in enumerate(medicine.aliases):

        prefix = f"aliases[{index}]"

        if _is_blank(alias.alias_name):
            _add_error(
                errors=errors,
                field_name=f"{prefix}.alias_name",
                message="Alias name cannot be empty.",
            )
            continue

        if _is_blank(alias.normalized_alias):
            _add_error(
                errors=errors,
                field_name=(
                    f"{prefix}.normalized_alias"
                ),
                message=(
                    "Alias normalized_alias is required "
                    "after normalization."
                ),
            )
            continue

        normalized_alias = alias.normalized_alias

        if normalized_alias in seen_aliases:
            _add_warning(
                warnings=warnings,
                field_name=(
                    f"{prefix}.normalized_alias"
                ),
                message=(
                    "Duplicate alias detected within "
                    "the same medicine record."
                ),
                value=normalized_alias,
            )
        else:
            seen_aliases.add(normalized_alias)

        # Prevent an alias identical to the canonical normalized
        # medicine name.
        if (
            medicine.normalized_name
            and normalized_alias
            == medicine.normalized_name
        ):
            _add_warning(
                warnings=warnings,
                field_name=f"{prefix}.alias_name",
                message=(
                    "Alias is identical to the canonical "
                    "medicine name."
                ),
                value=alias.alias_name,
            )


# ============================================================
# SIDE EFFECT VALIDATION
# ============================================================


def _validate_side_effects(
    medicine: MedicineRecord,
    errors: list[ValidationIssue],
    warnings: list[ValidationIssue],
) -> None:
    """
    Validate side effect records and detect duplicates.
    """

    seen_side_effects: set[str] = set()

    for index, record in enumerate(medicine.side_effects):

        prefix = f"side_effects[{index}]"

        if _is_blank(record.side_effect):
            _add_error(
                errors=errors,
                field_name=f"{prefix}.side_effect",
                message="Side effect cannot be empty.",
            )
            continue

        key = record.side_effect.lower()

        if key in seen_side_effects:
            _add_warning(
                warnings=warnings,
                field_name=f"{prefix}.side_effect",
                message=(
                    "Duplicate side effect detected within "
                    "the same medicine record."
                ),
                value=record.side_effect,
            )
        else:
            seen_side_effects.add(key)


# ============================================================
# PRECAUTION VALIDATION
# ============================================================


def _validate_precautions(
    medicine: MedicineRecord,
    errors: list[ValidationIssue],
    warnings: list[ValidationIssue],
) -> None:
    """
    Validate precaution records and detect duplicates.
    """

    seen_precautions: set[str] = set()

    for index, record in enumerate(medicine.precautions):

        prefix = f"precautions[{index}]"

        if _is_blank(record.precaution):
            _add_error(
                errors=errors,
                field_name=f"{prefix}.precaution",
                message="Precaution cannot be empty.",
            )
            continue

        key = record.precaution.lower()

        if key in seen_precautions:
            _add_warning(
                warnings=warnings,
                field_name=f"{prefix}.precaution",
                message=(
                    "Duplicate precaution detected within "
                    "the same medicine record."
                ),
                value=record.precaution,
            )
        else:
            seen_precautions.add(key)


# ============================================================
# CONTRAINDICATION VALIDATION
# ============================================================


def _validate_contraindications(
    medicine: MedicineRecord,
    errors: list[ValidationIssue],
    warnings: list[ValidationIssue],
) -> None:
    """
    Validate contraindication records and detect duplicates.
    """

    seen_contraindications: set[str] = set()

    for index, record in enumerate(
        medicine.contraindications
    ):

        prefix = f"contraindications[{index}]"

        if _is_blank(record.contraindication):
            _add_error(
                errors=errors,
                field_name=(
                    f"{prefix}.contraindication"
                ),
                message=(
                    "Contraindication cannot be empty."
                ),
            )
            continue

        key = record.contraindication.lower()

        if key in seen_contraindications:
            _add_warning(
                warnings=warnings,
                field_name=(
                    f"{prefix}.contraindication"
                ),
                message=(
                    "Duplicate contraindication detected "
                    "within the same medicine record."
                ),
                value=record.contraindication,
            )
        else:
            seen_contraindications.add(key)


# ============================================================
# PRICE VALIDATION
# ============================================================


def _validate_prices(
    medicine: MedicineRecord,
    errors: list[ValidationIssue],
    warnings: list[ValidationIssue],
) -> None:
    """
    Validate medicine price records.
    """

    for index, price_record in enumerate(
        medicine.prices
    ):

        prefix = f"prices[{index}]"

        # Price is required when a PriceRecord exists.
        if price_record.price is None:
            _add_error(
                errors=errors,
                field_name=f"{prefix}.price",
                message=(
                    "Price value is required for a price record."
                ),
            )
        else:
            _validate_positive_decimal(
                value=price_record.price,
                field_name=f"{prefix}.price",
                errors=errors,
                allow_zero=False,
            )

        # Currency is required by the database contract.
        if _is_blank(price_record.currency):
            _add_error(
                errors=errors,
                field_name=f"{prefix}.currency",
                message=(
                    "Currency is required for a price record."
                ),
            )

        # Quantity is optional but must be positive when supplied.
        _validate_positive_decimal(
            value=price_record.quantity,
            field_name=f"{prefix}.quantity",
            errors=errors,
        )

        # Country and region are optional but a warning is useful
        # because prices are geographically dependent.
        if (
            _is_blank(price_record.country)
            and _is_blank(price_record.region)
        ):
            _add_warning(
                warnings=warnings,
                field_name=f"{prefix}.country/region",
                message=(
                    "Price has no country or region. "
                    "Geographic applicability is unknown."
                ),
            )


# ============================================================
# SOURCE VALIDATION
# ============================================================


def _validate_sources(
    medicine: MedicineRecord,
    errors: list[ValidationIssue],
    warnings: list[ValidationIssue],
) -> None:
    """
    Validate source provenance metadata.
    """

    if not medicine.sources:
        _add_warning(
            warnings=warnings,
            field_name="sources",
            message=(
                "No source metadata is attached to this "
                "medicine record."
            ),
        )
        return

    seen_source_keys: set[tuple[str, Optional[str]]] = set()

    for index, source in enumerate(medicine.sources):

        prefix = f"sources[{index}]"

        if _is_blank(source.source_dataset):
            _add_error(
                errors=errors,
                field_name=f"{prefix}.source_dataset",
                message="Source dataset name is required.",
            )
            continue

        key = (
            source.source_dataset.lower(),
            source.source_record_id,
        )

        if key in seen_source_keys:
            _add_warning(
                warnings=warnings,
                field_name=f"{prefix}",
                message=(
                    "Duplicate source metadata detected "
                    "within the same medicine record."
                ),
                value=key,
            )
        else:
            seen_source_keys.add(key)

        # source_record_id is optional because some CSV datasets
        # may not provide a stable external ID.
        if _is_blank(source.source_record_id):
            _add_warning(
                warnings=warnings,
                field_name=(
                    f"{prefix}.source_record_id"
                ),
                message=(
                    "Source record ID is missing. "
                    "Source hashing may be required for "
                    "deduplication."
                ),
            )


# ============================================================
# COMPLETE MEDICINE VALIDATION
# ============================================================


def validate_medicine_record(
    medicine: MedicineRecord,
) -> ValidationResult:
    """
    Validate one normalized MedicineRecord.

    Returns:
        ValidationResult

    Status rules:

        INVALID
            At least one validation error exists.

        WARNING
            No errors exist but one or more warnings exist.

        VALID
            No errors and no warnings exist.
    """

    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []

    _validate_core_fields(
        medicine=medicine,
        errors=errors,
        warnings=warnings,
    )

    _validate_pharmaceutical_fields(
        medicine=medicine,
        errors=errors,
        warnings=warnings,
    )

    _validate_manufacturer(
        medicine=medicine,
        errors=errors,
        warnings=warnings,
    )

    _validate_ingredients(
        medicine=medicine,
        errors=errors,
        warnings=warnings,
    )

    _validate_aliases(
        medicine=medicine,
        errors=errors,
        warnings=warnings,
    )

    _validate_side_effects(
        medicine=medicine,
        errors=errors,
        warnings=warnings,
    )

    _validate_precautions(
        medicine=medicine,
        errors=errors,
        warnings=warnings,
    )

    _validate_contraindications(
        medicine=medicine,
        errors=errors,
        warnings=warnings,
    )

    _validate_prices(
        medicine=medicine,
        errors=errors,
        warnings=warnings,
    )

    _validate_sources(
        medicine=medicine,
        errors=errors,
        warnings=warnings,
    )

    # --------------------------------------------------------
    # DETERMINE OVERALL STATUS
    # --------------------------------------------------------

    if errors:
        status = ValidationStatus.INVALID

    elif warnings:
        status = ValidationStatus.WARNING

    else:
        status = ValidationStatus.VALID

    return ValidationResult(
        status=status,
        errors=errors,
        warnings=warnings,
    )


# ============================================================
# INTERACTION VALIDATION
# ============================================================


def validate_interaction_record(
    interaction: MedicineInteractionRecord,
) -> ValidationResult:
    """
    Validate a normalized medicine interaction record.
    """

    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []

    if _is_blank(
        interaction.medicine_a_normalized_name
    ):
        _add_error(
            errors=errors,
            field_name="medicine_a_normalized_name",
            message=(
                "First medicine normalized name is required."
            ),
        )

    if _is_blank(
        interaction.medicine_b_normalized_name
    ):
        _add_error(
            errors=errors,
            field_name="medicine_b_normalized_name",
            message=(
                "Second medicine normalized name is required."
            ),
        )

    # A medicine cannot interact with itself.
    if (
        interaction.medicine_a_normalized_name
        and interaction.medicine_b_normalized_name
        and (
            interaction.medicine_a_normalized_name
            == interaction.medicine_b_normalized_name
        )
    ):
        _add_error(
            errors=errors,
            field_name="interaction",
            message=(
                "A medicine cannot have an interaction "
                "with itself."
            ),
        )

    if _is_blank(interaction.severity):
        _add_warning(
            warnings=warnings,
            field_name="severity",
            message=(
                "Interaction severity is not provided."
            ),
        )

    if _is_blank(interaction.source):
        _add_warning(
            warnings=warnings,
            field_name="source",
            message=(
                "Interaction source is not provided."
            ),
        )

    if errors:
        status = ValidationStatus.INVALID
    elif warnings:
        status = ValidationStatus.WARNING
    else:
        status = ValidationStatus.VALID

    return ValidationResult(
        status=status,
        errors=errors,
        warnings=warnings,
    )


# ============================================================
# SIMILARITY VALIDATION
# ============================================================


def validate_similarity_record(
    similarity: MedicineSimilarityRecord,
) -> ValidationResult:
    """
    Validate a normalized medicine similarity record.
    """

    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []

    if _is_blank(
        similarity.medicine_normalized_name
    ):
        _add_error(
            errors=errors,
            field_name="medicine_normalized_name",
            message=(
                "Primary medicine normalized name is required."
            ),
        )

    if _is_blank(
        similarity.similar_medicine_normalized_name
    ):
        _add_error(
            errors=errors,
            field_name=(
                "similar_medicine_normalized_name"
            ),
            message=(
                "Similar medicine normalized name is required."
            ),
        )

    # A medicine cannot be marked as similar to itself.
    if (
        similarity.medicine_normalized_name
        and similarity.similar_medicine_normalized_name
        and (
            similarity.medicine_normalized_name
            == similarity.similar_medicine_normalized_name
        )
    ):
        _add_error(
            errors=errors,
            field_name="similarity",
            message=(
                "A medicine cannot be marked as similar "
                "to itself."
            ),
        )

    # Similarity score should be between 0 and 1 when supplied.
    if similarity.similarity_score is not None:

        try:
            score = Decimal(
                str(similarity.similarity_score)
            )

            if score < Decimal("0") or score > Decimal("1"):
                _add_error(
                    errors=errors,
                    field_name="similarity_score",
                    message=(
                        "Similarity score must be between "
                        "0 and 1."
                    ),
                    value=similarity.similarity_score,
                )

        except Exception:
            _add_error(
                errors=errors,
                field_name="similarity_score",
                message=(
                    "Similarity score must be numeric."
                ),
                value=similarity.similarity_score,
            )

    else:
        _add_warning(
            warnings=warnings,
            field_name="similarity_score",
            message=(
                "Similarity score is not provided."
            ),
        )

    if errors:
        status = ValidationStatus.INVALID
    elif warnings:
        status = ValidationStatus.WARNING
    else:
        status = ValidationStatus.VALID

    return ValidationResult(
        status=status,
        errors=errors,
        warnings=warnings,
    )


# ============================================================
# CONVENIENCE HELPERS
# ============================================================


def should_continue_pipeline(
    validation_result: ValidationResult,
) -> bool:
    """
    Determine whether the record should continue to
    candidate matching.

    Current ingestion policy:

        VALID
            Continue.

        WARNING
            Continue.

        INVALID
            Stop processing this record.

    This keeps warnings non-blocking while preventing structurally
    invalid data from reaching candidate matching and database writing.
    """

    return validation_result.status in {
        ValidationStatus.VALID,
        ValidationStatus.WARNING,
    }

# ============================================================
# VALIDATOR SERVICE CLASS
# ============================================================


class MedicineValidator:
    """
    Public validation interface for the MedDecode ingestion pipeline.

    Validates one normalized MedicineRecord.
    """

    def validate(
        self,
        medicine: MedicineRecord,
    ) -> ValidationResult:
        """
        Validate one MedicineRecord.
        """

        return validate_medicine_record(
            medicine=medicine,
        )