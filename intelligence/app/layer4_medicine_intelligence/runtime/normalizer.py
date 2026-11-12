
"""
Runtime medicine normalizer for MedDecode Layer 4.

Standardizes medicine identity fields received from Layer 3.

This module:
- Does not perform canonical medicine matching.
- Does not infer missing strength or dosage form.
- Does not convert brand names into generic names.
- Does not modify the original input object.
"""

from __future__ import annotations

import re
import unicodedata

from app.layer4_medicine_intelligence.runtime.schemas import (
    MedicineQuery,
)


DOSAGE_FORM_ALIASES = {
    "tab": "tablet",
    "tabs": "tablet",
    "tablet": "tablet",
    "tablets": "tablet",

    "cap": "capsule",
    "caps": "capsule",
    "capsule": "capsule",
    "capsules": "capsule",

    "syp": "syrup",
    "syrup": "syrup",

    "inj": "injection",
    "injection": "injection",

    "drop": "drops",
    "drops": "drops",

    "oint": "ointment",
    "ointment": "ointment",

    "susp": "suspension",
    "suspension": "suspension",

    "cream": "cream",
    "gel": "gel",
    "lotion": "lotion",

    "neb": "nebulizer",
    "nebuliser": "nebulizer",
    "nebulizer": "nebulizer",

    "powder": "powder",
    "solution": "solution",
    "spray": "spray",
    "patch": "patch",
}


STRENGTH_UNIT_ALIASES = {
    "mg": "mg",
    "milligram": "mg",
    "milligrams": "mg",

    "mcg": "mcg",
    "μg": "mcg",
    "µg": "mcg",
    "ug": "mcg",
    "microgram": "mcg",
    "micrograms": "mcg",

    "g": "g",
    "gram": "g",
    "grams": "g",

    "ml": "ml",
    "milliliter": "ml",
    "milliliters": "ml",
    "millilitre": "ml",
    "millilitres": "ml",

    "iu": "iu",
    "unit": "unit",
    "units": "unit",

    "%": "%",
}


def clean_text(value: str | None) -> str | None:
    """Normalize Unicode and whitespace without changing meaning."""

    if value is None:
        return None

    normalized = unicodedata.normalize("NFKC", value)
    normalized = " ".join(normalized.split())

    return normalized or None


def normalize_medicine_name(
    name: str | None,
) -> str | None:
    """
    Normalize medicine-name formatting.

    Punctuation is preserved because punctuation can distinguish
    legitimate medicine names and formulations.
    """

    normalized = clean_text(name)

    if normalized is None:
        return None

    return normalized.casefold()


def normalize_dosage_form(
    dosage_form: str | None,
) -> str | None:
    """Resolve recognized dosage-form spelling and abbreviation aliases."""

    normalized = clean_text(dosage_form)

    if normalized is None:
        return None

    key = normalized.casefold().rstrip(".")

    return DOSAGE_FORM_ALIASES.get(key, key)


def normalize_strength_unit(
    unit: str | None,
) -> str | None:
    """Standardize recognized strength-unit representations."""

    normalized = clean_text(unit)

    if normalized is None:
        return None

    key = normalized.casefold()

    return STRENGTH_UNIT_ALIASES.get(key, key)


def normalize_ingredient_name(
    ingredient_name: str | None,
) -> str | None:
    """
    Normalize ingredient-name formatting.

    Does not infer chemical equivalence or ingredient synonyms.
    """

    normalized = clean_text(ingredient_name)

    if normalized is None:
        return None

    return normalized.casefold()


def normalize_medicine_query(
    query: MedicineQuery,
) -> MedicineQuery:
    """
    Return a normalized copy of a Layer 4 medicine query.

    The input object remains unchanged.
    """

    raw_name = clean_text(query.medicine_name)

    normalized_name = normalize_medicine_name(
        query.normalized_medicine_name or raw_name
    )

    dosage_form = normalize_dosage_form(
        query.dosage_form
    )

    strength_unit = normalize_strength_unit(
        query.strength_unit
    )

    ingredients = list(
        dict.fromkeys(
            normalized
            for ingredient in query.active_ingredients
            if (
                normalized := normalize_ingredient_name(
                    ingredient
                )
            ) is not None
        )
    )

    return MedicineQuery(
        raw_medicine_text=(
            clean_text(query.raw_medicine_text) or ""
        ),
        medicine_name=raw_name,
        normalized_medicine_name=normalized_name,
        dosage_form=dosage_form,
        strength_value=query.strength_value,
        strength_unit=strength_unit,
        active_ingredients=ingredients,
    )
