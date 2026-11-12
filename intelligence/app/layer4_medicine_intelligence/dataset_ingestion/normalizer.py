"""
Normalization layer for the MedDecode medicine dataset ingestion pipeline.

Responsibilities:
- Normalize medicine names
- Normalize manufacturer names
- Normalize ingredient names
- Normalize aliases
- Normalize interaction and similarity medicine names
- Normalize selected textual values
- Preserve the canonical meaning of source data

This module does NOT:
- validate whether data is medically correct
- query the database
- find duplicate medicines
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

import re
import unicodedata
from copy import deepcopy
from decimal import Decimal
from typing import Optional

from .models import (
    ActiveIngredientRecord,
    ManufacturerRecord,
    MedicineAliasRecord,
    MedicineIngredientRecord,
    MedicineInteractionRecord,
    MedicineRecord,
    MedicineSimilarityRecord,
)


# ============================================================
# BASIC TEXT NORMALIZATION
# ============================================================


def normalize_unicode(value: str) -> str:
    """
    Normalize Unicode characters.

    Converts visually equivalent Unicode representations into
    a consistent representation.
    """

    return unicodedata.normalize("NFKC", value)


def collapse_whitespace(value: str) -> str:
    """
    Replace multiple whitespace characters with a single space.
    """

    return re.sub(r"\s+", " ", value).strip()


def clean_text(value: Optional[str]) -> Optional[str]:
    """
    Perform safe general text cleanup.

    Returns None when the input is None or empty after cleanup.

    This function does not lowercase text because many fields,
    such as descriptions and display names, should preserve
    their original capitalization.
    """

    if value is None:
        return None

    value = str(value)

    value = normalize_unicode(value)
    value = collapse_whitespace(value)

    if not value:
        return None

    return value


# ============================================================
# NAME NORMALIZATION
# ============================================================


def normalize_name(value: Optional[str]) -> Optional[str]:
    """
    Create a stable normalized representation for matching.

    Example:

        "Paracetamol 500 MG"
            ->
        "paracetamol 500 mg"

    This normalized value is intended for:
    - duplicate detection
    - candidate matching
    - database uniqueness
    - cross-dataset comparison

    Display names should remain stored separately.
    """

    value = clean_text(value)

    if value is None:
        return None

    value = value.lower()

    # Normalize common separators.
    value = value.replace("_", " ")
    value = value.replace("-", " ")

    # Remove punctuation that generally does not change identity.
    value = re.sub(r"[^\w\s]", " ", value)

    # Collapse whitespace again after punctuation replacement.
    value = collapse_whitespace(value)

    return value


def normalize_alias(value: Optional[str]) -> Optional[str]:
    """
    Normalize an alias for matching.

    Uses the same normalization strategy as medicine names.
    """

    return normalize_name(value)


def normalize_ingredient_name(
    value: Optional[str],
) -> Optional[str]:
    """
    Normalize an active ingredient name.

    Currently uses the same identity normalization strategy
    as medicine names.

    A future ingredient synonym dictionary can be added here
    without changing the rest of the ingestion pipeline.
    """

    return normalize_name(value)


def normalize_manufacturer_name(
    value: Optional[str],
) -> Optional[str]:
    """
    Normalize manufacturer name for matching.

    This intentionally does not attempt to infer that two
    different legal company names are the same organization.
    """

    return normalize_name(value)


# ============================================================
# UNIT NORMALIZATION
# ============================================================


_UNIT_ALIASES = {
    "mg": "mg",
    "milligram": "mg",
    "milligrams": "mg",

    "g": "g",
    "gram": "g",
    "grams": "g",

    "mcg": "mcg",
    "µg": "mcg",
    "ug": "mcg",
    "microgram": "mcg",
    "micrograms": "mcg",

    "ml": "ml",
    "milliliter": "ml",
    "milliliters": "ml",
    "millilitre": "ml",
    "millilitres": "ml",

    "l": "l",
    "liter": "l",
    "liters": "l",
    "litre": "l",
    "litres": "l",

    "iu": "iu",
    "international unit": "iu",
    "international units": "iu",

    "%": "%",
}


def normalize_unit(
    value: Optional[str],
) -> Optional[str]:
    """
    Normalize pharmaceutical measurement units.

    Unknown units are cleaned but preserved rather than discarded.
    """

    value = clean_text(value)

    if value is None:
        return None

    normalized = value.lower()

    return _UNIT_ALIASES.get(
        normalized,
        normalized,
    )


# ============================================================
# BOOLEAN NORMALIZATION
# ============================================================


_TRUE_VALUES = {
    "true",
    "yes",
    "y",
    "1",
    "required",
}

_FALSE_VALUES = {
    "false",
    "no",
    "n",
    "0",
    "not required",
}


def normalize_boolean(
    value: Optional[object],
) -> Optional[bool]:
    """
    Normalize common CSV boolean representations.

    Returns:
        True
        False
        None when the value cannot be confidently interpreted
    """

    if value is None:
        return None

    if isinstance(value, bool):
        return value

    normalized = clean_text(str(value))

    if normalized is None:
        return None

    normalized = normalized.lower()

    if normalized in _TRUE_VALUES:
        return True

    if normalized in _FALSE_VALUES:
        return False

    return None


# ============================================================
# CURRENCY NORMALIZATION
# ============================================================


def normalize_currency(
    value: Optional[str],
) -> Optional[str]:
    """
    Normalize currency codes.

    Examples:
        "inr" -> "INR"
        "usd" -> "USD"

    Currency symbols are intentionally not automatically converted
    because symbols such as "$" can represent multiple currencies.
    """

    value = clean_text(value)

    if value is None:
        return None

    return value.upper()


# ============================================================
# COUNTRY NORMALIZATION
# ============================================================


def normalize_country(
    value: Optional[str],
) -> Optional[str]:
    """
    Clean country information.

    Full country-name standardization is intentionally not performed
    here because source datasets may use country names, codes, or
    regional identifiers.

    This function preserves meaning while ensuring consistency.
    """

    return clean_text(value)


# ============================================================
# DECIMAL NORMALIZATION
# ============================================================


def normalize_decimal(
    value: Optional[Decimal],
) -> Optional[Decimal]:
    """
    Normalize Decimal values.

    Removes unnecessary trailing zeros while preserving the Decimal type.
    """

    if value is None:
        return None

    if not isinstance(value, Decimal):
        value = Decimal(str(value))

    normalized = value.normalize()

    # Decimal.normalize() can produce scientific notation.
    # Convert integral values back to a regular decimal representation.
    if normalized == normalized.to_integral():
        return normalized.quantize(Decimal("1"))

    return normalized


# ============================================================
# MANUFACTURER NORMALIZATION
# ============================================================


def normalize_manufacturer(
    manufacturer: Optional[ManufacturerRecord],
) -> Optional[ManufacturerRecord]:
    """
    Normalize manufacturer fields.
    """

    if manufacturer is None:
        return None

    manufacturer.name = clean_text(
        manufacturer.name
    ) or ""

    manufacturer.normalized_name = (
        normalize_manufacturer_name(
            manufacturer.name
        )
    )

    manufacturer.country = normalize_country(
        manufacturer.country
    )

    return manufacturer


# ============================================================
# ACTIVE INGREDIENT NORMALIZATION
# ============================================================


def normalize_active_ingredient(
    ingredient: ActiveIngredientRecord,
) -> ActiveIngredientRecord:
    """
    Normalize active ingredient fields.
    """

    ingredient.ingredient_name = clean_text(
        ingredient.ingredient_name
    ) or ""

    ingredient.normalized_name = (
        normalize_ingredient_name(
            ingredient.ingredient_name
        )
    )

    ingredient.description = clean_text(
        ingredient.description
    )

    return ingredient


# ============================================================
# MEDICINE INGREDIENT NORMALIZATION
# ============================================================


def normalize_medicine_ingredient(
    record: MedicineIngredientRecord,
) -> MedicineIngredientRecord:
    """
    Normalize one medicine-to-ingredient relationship.
    """

    record.ingredient = normalize_active_ingredient(
        record.ingredient
    )

    record.ingredient_strength_value = (
        normalize_decimal(
            record.ingredient_strength_value
        )
    )

    record.ingredient_strength_unit = (
        normalize_unit(
            record.ingredient_strength_unit
        )
    )

    return record


# ============================================================
# ALIAS NORMALIZATION
# ============================================================


def normalize_medicine_alias(
    alias: MedicineAliasRecord,
) -> MedicineAliasRecord:
    """
    Normalize medicine alias fields.
    """

    alias.alias_name = clean_text(
        alias.alias_name
    ) or ""

    alias.normalized_alias = normalize_alias(
        alias.alias_name
    )

    alias.alias_type = clean_text(
        alias.alias_type
    )

    if alias.alias_type is not None:
        alias.alias_type = alias.alias_type.lower()

    return alias


# ============================================================
# TEXTUAL MEDICINE INTELLIGENCE NORMALIZATION
# ============================================================


def normalize_simple_text_list(
    records: list,
    attribute_name: str,
) -> list:
    """
    Normalize text attributes in related record collections.

    Example:
        side_effect -> cleaned side effect
        precaution -> cleaned precaution
        contraindication -> cleaned contraindication
    """

    normalized_records = []

    for record in records:

        value = getattr(
            record,
            attribute_name,
            None,
        )

        cleaned_value = clean_text(value)

        if cleaned_value is None:
            continue

        setattr(
            record,
            attribute_name,
            cleaned_value,
        )

        if hasattr(record, "source"):
            record.source = clean_text(
                record.source
            )

        if hasattr(record, "frequency"):
            record.frequency = clean_text(
                record.frequency
            )

        normalized_records.append(record)

    return normalized_records


# ============================================================
# MAIN MEDICINE RECORD NORMALIZATION
# ============================================================


def normalize_medicine_record(
    medicine: MedicineRecord,
) -> MedicineRecord:
    """
    Normalize a complete MedicineRecord.

    This is the main public function used by the ingestion pipeline.

    The original object is copied before normalization so upstream
    pipeline stages are not unexpectedly modified.
    """

    medicine = deepcopy(medicine)

    # --------------------------------------------------------
    # CORE IDENTITY
    # --------------------------------------------------------

    medicine.canonical_name = clean_text(
        medicine.canonical_name
    ) or ""

    medicine.normalized_name = normalize_name(
        medicine.canonical_name
    )

    medicine.brand_name = clean_text(
        medicine.brand_name
    )

    medicine.generic_name = clean_text(
        medicine.generic_name
    )

    medicine.medicine_type = clean_text(
        medicine.medicine_type
    )

    medicine.category = clean_text(
        medicine.category
    )

    # --------------------------------------------------------
    # DESCRIPTION / PURPOSE
    # --------------------------------------------------------

    medicine.description = clean_text(
        medicine.description
    )

    medicine.purpose = clean_text(
        medicine.purpose
    )

    # --------------------------------------------------------
    # PHARMACEUTICAL INFORMATION
    # --------------------------------------------------------

    medicine.dosage_form = clean_text(
        medicine.dosage_form
    )

    medicine.strength_value = normalize_decimal(
        medicine.strength_value
    )

    medicine.strength_unit = normalize_unit(
        medicine.strength_unit
    )

    medicine.prescription_required = (
        normalize_boolean(
            medicine.prescription_required
        )
    )

    medicine.usage_instructions = clean_text(
        medicine.usage_instructions
    )

    medicine.storage_information = clean_text(
        medicine.storage_information
    )

    # --------------------------------------------------------
    # GEOGRAPHIC INFORMATION
    # --------------------------------------------------------

    medicine.country = normalize_country(
        medicine.country
    )

    medicine.currency = normalize_currency(
        medicine.currency
    )

    # --------------------------------------------------------
    # COST
    # --------------------------------------------------------

    medicine.average_cost = normalize_decimal(
        medicine.average_cost
    )

    # --------------------------------------------------------
    # IMAGE
    # --------------------------------------------------------

    medicine.image_url = clean_text(
        medicine.image_url
    )

    # --------------------------------------------------------
    # MANUFACTURER
    # --------------------------------------------------------

    medicine.manufacturer = (
        normalize_manufacturer(
            medicine.manufacturer
        )
    )

    # --------------------------------------------------------
    # INGREDIENTS
    # --------------------------------------------------------

    medicine.ingredients = [
        normalize_medicine_ingredient(
            ingredient
        )
        for ingredient in medicine.ingredients
    ]

    # --------------------------------------------------------
    # ALIASES
    # --------------------------------------------------------

    medicine.aliases = [
        normalize_medicine_alias(
            alias
        )
        for alias in medicine.aliases
    ]

    # --------------------------------------------------------
    # SIDE EFFECTS
    # --------------------------------------------------------

    medicine.side_effects = (
        normalize_simple_text_list(
            medicine.side_effects,
            "side_effect",
        )
    )

    # --------------------------------------------------------
    # PRECAUTIONS
    # --------------------------------------------------------

    medicine.precautions = (
        normalize_simple_text_list(
            medicine.precautions,
            "precaution",
        )
    )

    # --------------------------------------------------------
    # CONTRAINDICATIONS
    # --------------------------------------------------------

    medicine.contraindications = (
        normalize_simple_text_list(
            medicine.contraindications,
            "contraindication",
        )
    )

    # --------------------------------------------------------
    # PRICES
    # --------------------------------------------------------

    for price in medicine.prices:

        price.price = normalize_decimal(
            price.price
        ) or Decimal("0")

        price.currency = (
            normalize_currency(
                price.currency
            )
            or ""
        )

        price.country = normalize_country(
            price.country
        )

        price.region = clean_text(
            price.region
        )

        price.package_description = clean_text(
            price.package_description
        )

        price.quantity = normalize_decimal(
            price.quantity
        )

        price.source = clean_text(
            price.source
        )

    # --------------------------------------------------------
    # SOURCES
    # --------------------------------------------------------

    for source in medicine.sources:

        source.source_dataset = (
            clean_text(
                source.source_dataset
            )
            or ""
        )

        source.source_record_id = clean_text(
            source.source_record_id
        )

        source.source_url = clean_text(
            source.source_url
        )

        source.source_record_hash = clean_text(
            source.source_record_hash
        )

    return medicine


# ============================================================
# INTERACTION NORMALIZATION
# ============================================================


def normalize_interaction_record(
    interaction: MedicineInteractionRecord,
) -> MedicineInteractionRecord:
    """
    Normalize a medicine interaction record.
    """

    interaction = deepcopy(interaction)

    interaction.medicine_a_normalized_name = (
        normalize_name(
            interaction.medicine_a_normalized_name
        )
        or ""
    )

    interaction.medicine_b_normalized_name = (
        normalize_name(
            interaction.medicine_b_normalized_name
        )
        or ""
    )

    interaction.severity = clean_text(
        interaction.severity
    )

    if interaction.severity is not None:
        interaction.severity = (
            interaction.severity.lower()
        )

    interaction.description = clean_text(
        interaction.description
    )

    interaction.source = clean_text(
        interaction.source
    )

    return interaction


# ============================================================
# SIMILARITY NORMALIZATION
# ============================================================


def normalize_similarity_record(
    similarity: MedicineSimilarityRecord,
) -> MedicineSimilarityRecord:
    """
    Normalize a medicine similarity relationship.
    """

    similarity = deepcopy(similarity)

    similarity.medicine_normalized_name = (
        normalize_name(
            similarity.medicine_normalized_name
        )
        or ""
    )

    similarity.similar_medicine_normalized_name = (
        normalize_name(
            similarity.similar_medicine_normalized_name
        )
        or ""
    )

    similarity.similarity_type = clean_text(
        similarity.similarity_type
    )

    if similarity.similarity_type is not None:
        similarity.similarity_type = (
            similarity.similarity_type.lower()
        )

    similarity.similarity_score = (
        normalize_decimal(
            similarity.similarity_score
        )
    )

    similarity.reason = clean_text(
        similarity.reason
    )

    return similarity

# ============================================================
# NORMALIZER SERVICE CLASS
# ============================================================


class MedicineNormalizer:
    """
    Public normalization interface for the MedDecode ingestion pipeline.

    Normalizes names, aliases, manufacturers, ingredients, units,
    currencies, countries and other standardized fields.
    """

    def normalize(
        self,
        medicine: MedicineRecord,
    ) -> MedicineRecord:
        """
        Normalize one MedicineRecord.
        """

        return normalize_medicine_record(
            medicine=medicine,
        )