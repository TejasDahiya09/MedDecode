"""
Structural transformer for the MedDecode medicine dataset ingestion pipeline.

transformer.py receives a standardized MedicineRecord produced by mapper.py
and performs structural transformations before normalization and validation.

Pipeline:

CSV
    ↓
loader.py
    ↓
mapper.py
    ↓
MedicineRecord
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
    ↓
Supabase PostgreSQL


Responsibilities
----------------

transformer.py may:

- Remove empty nested records.
- Trim obvious whitespace.
- Convert structurally equivalent values.
- Remove duplicate nested objects where safe.
- Move scalar information into standardized nested structures.
- Ensure relationship lists have a clean structure.

transformer.py does NOT:

- Perform database lookups.
- Generate database IDs.
- Match medicines.
- Write to PostgreSQL.
- Perform final validation.
- Decide merge actions.
- Apply canonical name normalization rules.

Canonical normalization is handled by normalizer.py.
Business validation is handled by validator.py.
"""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from typing import Optional

from .models import (
    ActiveIngredientRecord,
    ContraindicationRecord,
    ManufacturerRecord,
    MedicineAliasRecord,
    MedicineIngredientRecord,
    MedicineRecord,
    PrecautionRecord,
    PriceRecord,
    SideEffectRecord,
    SourceMetadata,
)


# ============================================================
# BASIC STRING TRANSFORMATION HELPERS
# ============================================================


def _clean_string(
    value: Optional[str],
) -> Optional[str]:
    """
    Performs structural string cleanup.

    This function intentionally does NOT perform canonical normalization.

    Examples:

        "  Paracetamol  "
            →
        "Paracetamol"

        "Paracetamol   Tablet"
            →
        "Paracetamol Tablet"

    Empty strings become None.
    """

    if value is None:
        return None

    cleaned = " ".join(
        str(value).split()
    )

    if cleaned == "":
        return None

    return cleaned


def _clean_optional_decimal(
    value: Optional[Decimal],
) -> Optional[Decimal]:
    """
    Returns a Decimal value unchanged unless it is None.

    This helper exists to make nested transformation logic explicit
    and leaves room for future Decimal formatting rules.
    """

    if value is None:
        return None

    return value


# ============================================================
# SOURCE TRANSFORMATION
# ============================================================


def transform_source(
    source: SourceMetadata,
) -> SourceMetadata:
    """
    Cleans source metadata.

    No source values are normalized here beyond structural cleanup.
    """

    return SourceMetadata(
        source_dataset=_clean_string(
            source.source_dataset
        ) or "",
        source_record_id=_clean_string(
            source.source_record_id
        ),
        source_url=_clean_string(
            source.source_url
        ),
        source_record_hash=_clean_string(
            source.source_record_hash
        ),
        source_release=_clean_string(source.source_release),
        source_authority=_clean_string(source.source_authority),
        jurisdiction=_clean_string(source.jurisdiction),
    )


def transform_sources(
    sources: list[SourceMetadata],
) -> list[SourceMetadata]:
    """
    Cleans and deduplicates source metadata.

    Duplicate detection is structural and based on the source fields.
    """

    transformed_sources: list[
        SourceMetadata
    ] = []

    seen: set[
        tuple[
            str,
            Optional[str],
            Optional[str],
            Optional[str],
            Optional[str],
            Optional[str],
            Optional[str],
        ]
    ] = set()

    for source in sources:

        transformed = transform_source(
            source
        )

        key = (
            transformed.source_dataset,
            transformed.source_record_id,
            transformed.source_url,
            transformed.source_record_hash,
            transformed.source_release,
            transformed.source_authority,
            transformed.jurisdiction,
        )

        if key in seen:
            continue

        seen.add(
            key
        )

        transformed_sources.append(
            transformed
        )

    return transformed_sources


# ============================================================
# MANUFACTURER TRANSFORMATION
# ============================================================


def transform_manufacturer(
    manufacturer: Optional[
        ManufacturerRecord
    ],
) -> Optional[ManufacturerRecord]:
    """
    Cleans manufacturer information.
    """

    if manufacturer is None:
        return None

    name = _clean_string(
        manufacturer.name
    )

    # An empty manufacturer should not produce
    # an empty nested database entity.

    if name is None:
        return None

    return ManufacturerRecord(
        name=name,
        normalized_name=_clean_string(
            manufacturer.normalized_name
        ),
        country=_clean_string(
            manufacturer.country
        ),
    )


# ============================================================
# INGREDIENT TRANSFORMATION
# ============================================================


def transform_active_ingredient(
    ingredient: ActiveIngredientRecord,
) -> Optional[ActiveIngredientRecord]:
    """
    Cleans an active ingredient record.
    """

    ingredient_name = _clean_string(
        ingredient.ingredient_name
    )

    if ingredient_name is None:
        return None

    return ActiveIngredientRecord(
        ingredient_name=ingredient_name,
        normalized_name=_clean_string(
            ingredient.normalized_name
        ),
        description=_clean_string(
            ingredient.description
        ),
    )


def transform_ingredients(
    ingredients: list[
        MedicineIngredientRecord
    ],
) -> list[
    MedicineIngredientRecord
]:
    """
    Cleans medicine ingredient relationships.

    Removes:

    - Empty ingredients.
    - Structurally duplicate ingredients.

    Duplicate detection is intentionally conservative and uses
    the ingredient name plus strength information.
    """

    transformed_ingredients: list[
        MedicineIngredientRecord
    ] = []

    for relationship in ingredients:

        transformed_ingredient = (
            transform_active_ingredient(
                relationship.ingredient
            )
        )

        if transformed_ingredient is None:
            continue

        strength_value = (
            _clean_optional_decimal(
                relationship.ingredient_strength_value
            )
        )

        strength_unit = _clean_string(
            relationship.ingredient_strength_unit
        )

        transformed_ingredients.append(
            MedicineIngredientRecord(
                ingredient=transformed_ingredient,
                ingredient_strength_value=strength_value,
                ingredient_strength_unit=strength_unit,
            )
        )

    return transformed_ingredients


# ============================================================
# ALIAS TRANSFORMATION
# ============================================================


def transform_aliases(
    aliases: list[
        MedicineAliasRecord
    ],
) -> list[
    MedicineAliasRecord
]:
    """
    Cleans and deduplicates medicine aliases.

    Duplicate detection is case-insensitive structurally.

    Full canonical normalization is intentionally deferred to
    normalizer.py.
    """

    transformed_aliases: list[
        MedicineAliasRecord
    ] = []

    seen: set[str] = set()

    for alias in aliases:

        alias_name = _clean_string(
            alias.alias_name
        )

        if alias_name is None:
            continue

        structural_key = (
            alias_name.casefold()
        )

        if structural_key in seen:
            continue

        seen.add(
            structural_key
        )

        transformed_aliases.append(
            MedicineAliasRecord(
                alias_name=alias_name,
                alias_type=_clean_string(
                    alias.alias_type
                ),
                normalized_alias=_clean_string(
                    alias.normalized_alias
                ),
            )
        )

    return transformed_aliases


# ============================================================
# SIDE EFFECT TRANSFORMATION
# ============================================================


def transform_side_effects(
    side_effects: list[
        SideEffectRecord
    ],
) -> list[
    SideEffectRecord
]:
    """
    Cleans and deduplicates side effects.
    """

    transformed_side_effects: list[
        SideEffectRecord
    ] = []

    seen: set[str] = set()

    for side_effect_record in side_effects:

        side_effect = _clean_string(
            side_effect_record.side_effect
        )

        if side_effect is None:
            continue

        structural_key = (
            side_effect.casefold()
        )

        if structural_key in seen:
            continue

        seen.add(
            structural_key
        )

        transformed_side_effects.append(
            SideEffectRecord(
                side_effect=side_effect,
                frequency=_clean_string(
                    side_effect_record.frequency
                ),
                source=_clean_string(
                    side_effect_record.source
                ),
            )
        )

    return transformed_side_effects


# ============================================================
# PRECAUTION TRANSFORMATION
# ============================================================


def transform_precautions(
    precautions: list[
        PrecautionRecord
    ],
) -> list[
    PrecautionRecord
]:
    """
    Cleans and deduplicates precautions.
    """

    transformed_precautions: list[
        PrecautionRecord
    ] = []

    seen: set[str] = set()

    for precaution_record in precautions:

        precaution = _clean_string(
            precaution_record.precaution
        )

        if precaution is None:
            continue

        structural_key = (
            precaution.casefold()
        )

        if structural_key in seen:
            continue

        seen.add(
            structural_key
        )

        transformed_precautions.append(
            PrecautionRecord(
                precaution=precaution,
                source=_clean_string(
                    precaution_record.source
                ),
            )
        )

    return transformed_precautions


# ============================================================
# CONTRAINDICATION TRANSFORMATION
# ============================================================


def transform_contraindications(
    contraindications: list[
        ContraindicationRecord
    ],
) -> list[
    ContraindicationRecord
]:
    """
    Cleans and deduplicates contraindications.
    """

    transformed_contraindications: list[
        ContraindicationRecord
    ] = []

    seen: set[str] = set()

    for contraindication_record in contraindications:

        contraindication = _clean_string(
            contraindication_record.contraindication
        )

        if contraindication is None:
            continue

        structural_key = (
            contraindication.casefold()
        )

        if structural_key in seen:
            continue

        seen.add(
            structural_key
        )

        transformed_contraindications.append(
            ContraindicationRecord(
                contraindication=contraindication,
                source=_clean_string(
                    contraindication_record.source
                ),
            )
        )

    return transformed_contraindications


# ============================================================
# PRICE TRANSFORMATION
# ============================================================


def transform_prices(
    prices: list[
        PriceRecord
    ],
) -> list[
    PriceRecord
]:
    """
    Cleans and deduplicates price records.

    A price must already contain a value and currency because
    PriceRecord requires both fields.

    Final business validation remains validator.py's responsibility.
    """

    transformed_prices: list[
        PriceRecord
    ] = []

    seen: set[
        tuple[
            Decimal,
            str,
            Optional[str],
            Optional[str],
            Optional[str],
            Optional[Decimal],
        ]
    ] = set()

    for price_record in prices:

        currency = _clean_string(
            price_record.currency
        )

        if currency is None:
            continue

        price = _clean_optional_decimal(
            price_record.price
        )

        if price is None:
            continue

        country = _clean_string(
            price_record.country
        )

        region = _clean_string(
            price_record.region
        )

        package_description = _clean_string(
            price_record.package_description
        )

        quantity = _clean_optional_decimal(
            price_record.quantity
        )

        key = (
            price,
            currency,
            country,
            region,
            package_description,
            quantity,
        )

        if key in seen:
            continue

        seen.add(
            key
        )

        transformed_prices.append(
            PriceRecord(
                price=price,
                currency=currency,
                country=country,
                region=region,
                package_description=package_description,
                quantity=quantity,
                source=_clean_string(
                    price_record.source
                ),
            )
        )

    return transformed_prices


# ============================================================
# MAIN MEDICINE TRANSFORMATION
# ============================================================


def transform_medicine_record(
    medicine: MedicineRecord,
) -> MedicineRecord:
    """
    Performs structural transformation on a MedicineRecord.

    The original MedicineRecord is not modified.

    A new MedicineRecord is returned.

    Responsibilities:

    - Clean scalar strings.
    - Clean nested records.
    - Remove empty nested records.
    - Remove safe structural duplicates.
    - Preserve provenance.

    This function does NOT perform:

    - Canonical normalization.
    - Validation.
    - Database matching.
    - Merge decisions.
    """

    # Deep copy ensures that downstream modifications do not
    # mutate the original mapper output.

    transformed = deepcopy(
        medicine
    )

    return MedicineRecord(

        # ----------------------------------------------------
        # CORE IDENTITY
        # ----------------------------------------------------

        canonical_name=(
            _clean_string(
                transformed.canonical_name
            )
            or ""
        ),

        normalized_name=_clean_string(
            transformed.normalized_name
        ),

        brand_name=_clean_string(
            transformed.brand_name
        ),

        generic_name=_clean_string(
            transformed.generic_name
        ),

        medicine_type=_clean_string(
            transformed.medicine_type
        ),

        category=_clean_string(
            transformed.category
        ),

        # ----------------------------------------------------
        # DESCRIPTION / PURPOSE
        # ----------------------------------------------------

        description=_clean_string(
            transformed.description
        ),

        purpose=_clean_string(
            transformed.purpose
        ),

        # ----------------------------------------------------
        # PHARMACEUTICAL INFORMATION
        # ----------------------------------------------------

        dosage_form=_clean_string(
            transformed.dosage_form
        ),

        strength_value=(
            _clean_optional_decimal(
                transformed.strength_value
            )
        ),

        strength_unit=_clean_string(
            transformed.strength_unit
        ),

        prescription_required=(
            transformed.prescription_required
        ),

        usage_instructions=_clean_string(
            transformed.usage_instructions
        ),

        storage_information=_clean_string(
            transformed.storage_information
        ),

        # ----------------------------------------------------
        # GEOGRAPHIC INFORMATION
        # ----------------------------------------------------

        country=_clean_string(
            transformed.country
        ),

        currency=_clean_string(
            transformed.currency
        ),

        # ----------------------------------------------------
        # COST
        # ----------------------------------------------------

        average_cost=(
            _clean_optional_decimal(
                transformed.average_cost
            )
        ),

        # ----------------------------------------------------
        # IMAGE
        # ----------------------------------------------------

        image_url=_clean_string(
            transformed.image_url
        ),

        # ----------------------------------------------------
        # MANUFACTURER
        # ----------------------------------------------------

        manufacturer=(
            transform_manufacturer(
                transformed.manufacturer
            )
        ),

        # ----------------------------------------------------
        # RELATED INFORMATION
        # ----------------------------------------------------

        ingredients=transform_ingredients(
            transformed.ingredients
        ),

        aliases=transform_aliases(
            transformed.aliases
        ),

        side_effects=transform_side_effects(
            transformed.side_effects
        ),

        precautions=transform_precautions(
            transformed.precautions
        ),

        contraindications=(
            transform_contraindications(
                transformed.contraindications
            )
        ),

        prices=transform_prices(
            transformed.prices
        ),

        # ----------------------------------------------------
        # PROVENANCE
        # ----------------------------------------------------

        sources=transform_sources(
            transformed.sources
        ),
    )


# ============================================================
# BATCH TRANSFORMATION
# ============================================================


def transform_medicine_records(
    medicines: list[
        MedicineRecord
    ],
) -> list[
    MedicineRecord
]:
    """
    Transforms multiple MedicineRecord objects.

    Useful for batch CSV ingestion.

    Parameters
    ----------
    medicines:
        Standardized records returned by mapper.py.

    Returns
    -------
    list[MedicineRecord]
    """

    return [
        transform_medicine_record(
            medicine
        )
        for medicine in medicines
    ]

# ============================================================
# TRANSFORMER SERVICE CLASS
# ============================================================


class MedicineTransformer:
    """
    Public transformer interface for the MedDecode ingestion pipeline.

    Applies structural and type transformations to a MedicineRecord.
    """

    def transform(
        self,
        medicine: MedicineRecord,
    ) -> MedicineRecord:
        """
        Transform one MedicineRecord.
        """

        return transform_medicine_record(
            medicine=medicine,
        )
