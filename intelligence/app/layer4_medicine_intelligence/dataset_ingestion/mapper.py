"""
CSV row mapper for the MedDecode medicine dataset ingestion pipeline.

mapper.py is responsible for converting dataset-specific CSV columns
into the standardized internal MedicineRecord contract.

Pipeline:

CSV file
    ↓
loader.py
    ↓
RawRecord
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

Important:

- This module does NOT read CSV files directly.
- This module does NOT normalize values.
- This module does NOT validate business rules.
- This module does NOT write to the database.

Its only responsibility is:

Raw CSV columns
        →
Standardized MedicineRecord
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from .models import (
    ActiveIngredientRecord,
    ContraindicationRecord,
    ManufacturerRecord,
    MedicineAliasRecord,
    MedicineIngredientRecord,
    MedicineRecord,
    PrecautionRecord,
    PriceRecord,
    RawRecord,
    SideEffectRecord,
    SourceMetadata,
)


# ============================================================
# COLUMN NAME GROUPS
# ============================================================

# These lists define common possible column names found across
# different medicine CSV datasets.
#
# mapper.py converts dataset-specific names into our internal model.
#
# Example:
#
# Dataset A:
#     medicine_name
#
# Dataset B:
#     drug_name
#
# Dataset C:
#     product_name
#
# All can become:
#
#     MedicineRecord.canonical_name


CANONICAL_NAME_COLUMNS = [
    "canonical_name",
    "medicine_name",
    "drug_name",
    "product_name",
    "name",
]

BRAND_NAME_COLUMNS = [
    "brand_name",
    "brand",
    "trade_name",
]

GENERIC_NAME_COLUMNS = [
    "generic_name",
    "generic",
    "generic_medicine_name",
    "salt_name",
]

MEDICINE_TYPE_COLUMNS = [
    "medicine_type",
    "drug_type",
    "type",
]

CATEGORY_COLUMNS = [
    "category",
    "drug_category",
    "therapeutic_category",
    "class",
]

DESCRIPTION_COLUMNS = [
    "description",
    "medicine_description",
    "drug_description",
]

PURPOSE_COLUMNS = [
    "purpose",
    "uses",
    "use",
    "indication",
    "indications",
]

DOSAGE_FORM_COLUMNS = [
    "dosage_form",
    "form",
    "medicine_form",
    "drug_form",
]

STRENGTH_VALUE_COLUMNS = [
    "strength_value",
    "strength",
    "dosage_strength",
]

STRENGTH_UNIT_COLUMNS = [
    "strength_unit",
    "unit",
    "dosage_unit",
]

PRESCRIPTION_REQUIRED_COLUMNS = [
    "prescription_required",
    "requires_prescription",
    "prescription",
    "rx_required",
]

USAGE_INSTRUCTIONS_COLUMNS = [
    "usage_instructions",
    "instructions",
    "dosage_instructions",
    "how_to_use",
]

STORAGE_INFORMATION_COLUMNS = [
    "storage_information",
    "storage",
    "storage_instructions",
]

COUNTRY_COLUMNS = [
    "country",
    "country_name",
]

CURRENCY_COLUMNS = [
    "currency",
    "currency_code",
]

AVERAGE_COST_COLUMNS = [
    "average_cost",
    "cost",
    "price",
    "average_price",
]

IMAGE_URL_COLUMNS = [
    "image_url",
    "image",
    "image_link",
]

MANUFACTURER_COLUMNS = [
    "manufacturer",
    "manufacturer_name",
    "company",
]

INGREDIENT_COLUMNS = [
    "ingredient",
    "ingredients",
    "active_ingredient",
    "active_ingredients",
    "generic_ingredient",
]

INGREDIENT_STRENGTH_VALUE_COLUMNS = [
    "ingredient_strength_value",
    "ingredient_strength",
]

INGREDIENT_STRENGTH_UNIT_COLUMNS = [
    "ingredient_strength_unit",
]

ALIAS_COLUMNS = [
    "alias",
    "aliases",
    "alternative_name",
    "alternative_names",
]

ALIAS_TYPE_COLUMNS = [
    "alias_type",
]

SIDE_EFFECT_COLUMNS = [
    "side_effect",
    "side_effects",
]

PRECAUTION_COLUMNS = [
    "precaution",
    "precautions",
    "warning",
    "warnings",
]

CONTRAINDICATION_COLUMNS = [
    "contraindication",
    "contraindications",
]

PRICE_COLUMNS = [
    "price",
    "medicine_price",
]

PRICE_CURRENCY_COLUMNS = [
    "price_currency",
    "currency",
    "currency_code",
]

PRICE_COUNTRY_COLUMNS = [
    "price_country",
    "country",
]

PRICE_REGION_COLUMNS = [
    "price_region",
    "region",
]

PACKAGE_DESCRIPTION_COLUMNS = [
    "package_description",
    "package",
    "packaging",
]

QUANTITY_COLUMNS = [
    "quantity",
    "package_quantity",
]


# ============================================================
# BASIC VALUE HELPERS
# ============================================================


def _get_value(
    data: dict[str, Any],
    possible_columns: list[str],
) -> Optional[Any]:
    """
    Returns the first non-empty value found from a list
    of possible CSV column names.

    Matching is case-insensitive.

    Example:

    data:
        {
            "Drug_Name": "Paracetamol"
        }

    possible_columns:
        [
            "medicine_name",
            "drug_name"
        ]

    Result:
        "Paracetamol"
    """

    normalized_lookup = {
        str(key).strip().lower(): value
        for key, value in data.items()
    }

    for column in possible_columns:
        key = column.strip().lower()

        if key not in normalized_lookup:
            continue

        value = normalized_lookup[key]

        if value is None:
            continue

        if isinstance(value, str):
            value = value.strip()

            if value == "":
                continue

        return value

    return None


def _to_string(value: Any) -> Optional[str]:
    """
    Converts a value to a cleaned string.

    Empty strings return None.
    """

    if value is None:
        return None

    value = str(value).strip()

    if value == "":
        return None

    return value


def _to_decimal(value: Any) -> Optional[Decimal]:
    """
    Safely converts a value into Decimal.

    Invalid values return None.

    Examples:

        "500"      -> Decimal("500")
        "500.25"   -> Decimal("500.25")
        ""         -> None
        None       -> None
        "unknown"  -> None
    """

    if value is None:
        return None

    if isinstance(value, str):
        value = value.strip()

        if value == "":
            return None

        # Remove common formatting characters.
        value = value.replace(",", "")

    try:
        return Decimal(str(value))

    except (InvalidOperation, ValueError, TypeError):
        return None


def _to_boolean(value: Any) -> Optional[bool]:
    """
    Converts common CSV boolean representations into bool.

    Examples:

        yes / true / 1  -> True
        no / false / 0  -> False

    Unknown values return None.
    """

    if value is None:
        return None

    if isinstance(value, bool):
        return value

    normalized = str(value).strip().lower()

    if normalized in {
        "true",
        "yes",
        "y",
        "1",
        "required",
    }:
        return True

    if normalized in {
        "false",
        "no",
        "n",
        "0",
        "not required",
    }:
        return False

    return None


def _split_multi_value(
    value: Any,
) -> list[str]:
    """
    Splits a CSV field containing multiple values.

    Supported separators:

        |
        ;
        ,

    Examples:

        "Headache;Nausea"
        ->
        ["Headache", "Nausea"]

        "Paracetamol|Caffeine"
        ->
        ["Paracetamol", "Caffeine"]

    Important:

    This is intentionally conservative. More advanced dataset-
    specific parsing can later be handled in transformer.py.
    """

    text = _to_string(value)

    if text is None:
        return []

    separators = ["|", ";"]

    for separator in separators:
        if separator in text:
            values = [
                item.strip()
                for item in text.split(separator)
                if item.strip()
            ]

            return values

    return [text]


# ============================================================
# ENTITY BUILDERS
# ============================================================


def _build_manufacturer(
    data: dict[str, Any],
) -> Optional[ManufacturerRecord]:
    """
    Builds ManufacturerRecord from CSV columns.
    """

    manufacturer_name = _to_string(
        _get_value(
            data,
            MANUFACTURER_COLUMNS,
        )
    )

    if manufacturer_name is None:
        return None

    return ManufacturerRecord(
        name=manufacturer_name,
    )


def _build_ingredients(
    data: dict[str, Any],
) -> list[MedicineIngredientRecord]:
    """
    Builds medicine ingredient relationships.

    A CSV field may contain multiple ingredients.

    Example:

        active_ingredients:
        "Paracetamol|Caffeine"

    Result:

        [
            MedicineIngredientRecord(...),
            MedicineIngredientRecord(...)
        ]
    """

    raw_ingredients = _get_value(
        data,
        INGREDIENT_COLUMNS,
    )

    ingredient_names = _split_multi_value(
        raw_ingredients,
    )

    raw_strength_values = _split_multi_value(_get_value(data, INGREDIENT_STRENGTH_VALUE_COLUMNS))
    raw_strength_units = _split_multi_value(_get_value(data, INGREDIENT_STRENGTH_UNIT_COLUMNS))

    # A single medicine-level strength must never be copied across multiple
    # active ingredients. Per-ingredient values are accepted only when their
    # cardinality exactly matches the ingredient list.
    if len(ingredient_names) == 1:
        strength_values = [_to_decimal(raw_strength_values[0])] if raw_strength_values else [None]
        strength_units = [_to_string(raw_strength_units[0])] if raw_strength_units else [None]
    elif len(raw_strength_values) == len(ingredient_names):
        strength_values = [_to_decimal(value) for value in raw_strength_values]
        if len(raw_strength_units) == len(ingredient_names):
            strength_units = [_to_string(value) for value in raw_strength_units]
        elif len(raw_strength_units) == 1:
            strength_units = [_to_string(raw_strength_units[0])] * len(ingredient_names)
        else:
            strength_units = [None] * len(ingredient_names)
    else:
        strength_values = [None] * len(ingredient_names)
        strength_units = [None] * len(ingredient_names)

    ingredients: list[
        MedicineIngredientRecord
    ] = []

    for index, ingredient_name in enumerate(ingredient_names):

        ingredient = ActiveIngredientRecord(
            ingredient_name=ingredient_name,
        )

        ingredients.append(
            MedicineIngredientRecord(
                ingredient=ingredient,
                ingredient_strength_value=strength_values[index],
                ingredient_strength_unit=strength_units[index],
            )
        )

    return ingredients


def _build_aliases(
    data: dict[str, Any],
) -> list[MedicineAliasRecord]:
    """
    Builds alternative medicine names.
    """

    raw_aliases = _get_value(
        data,
        ALIAS_COLUMNS,
    )

    alias_names = _split_multi_value(
        raw_aliases,
    )

    alias_type = _to_string(
        _get_value(
            data,
            ALIAS_TYPE_COLUMNS,
        )
    )

    aliases: list[MedicineAliasRecord] = []

    for alias_name in alias_names:

        aliases.append(
            MedicineAliasRecord(
                alias_name=alias_name,
                alias_type=alias_type,
            )
        )

    return aliases


def _build_side_effects(
    data: dict[str, Any],
) -> list[SideEffectRecord]:
    """
    Builds side effect records.
    """

    raw_side_effects = _get_value(
        data,
        SIDE_EFFECT_COLUMNS,
    )

    side_effect_values = _split_multi_value(
        raw_side_effects,
    )

    return [
        SideEffectRecord(
            side_effect=value,
        )
        for value in side_effect_values
    ]


def _build_precautions(
    data: dict[str, Any],
) -> list[PrecautionRecord]:
    """
    Builds precaution records.
    """

    raw_precautions = _get_value(
        data,
        PRECAUTION_COLUMNS,
    )

    precaution_values = _split_multi_value(
        raw_precautions,
    )

    return [
        PrecautionRecord(
            precaution=value,
        )
        for value in precaution_values
    ]


def _build_contraindications(
    data: dict[str, Any],
) -> list[ContraindicationRecord]:
    """
    Builds contraindication records.
    """

    raw_contraindications = _get_value(
        data,
        CONTRAINDICATION_COLUMNS,
    )

    contraindication_values = _split_multi_value(
        raw_contraindications,
    )

    return [
        ContraindicationRecord(
            contraindication=value,
        )
        for value in contraindication_values
    ]


def _build_prices(
    data: dict[str, Any],
) -> list[PriceRecord]:
    """
    Builds price records.

    Price is optional.

    If a CSV row does not contain a valid price,
    an empty list is returned.
    """

    price = _to_decimal(
        _get_value(
            data,
            PRICE_COLUMNS,
        )
    )

    if price is None:
        return []

    currency = _to_string(
        _get_value(
            data,
            PRICE_CURRENCY_COLUMNS,
        )
    )

    # PriceRecord requires currency.
    #
    # If the dataset has a price but no currency, we do not
    # create a PriceRecord here. validator.py can report missing
    # currency if the dataset contract requires it.

    if currency is None:
        return []

    country = _to_string(
        _get_value(
            data,
            PRICE_COUNTRY_COLUMNS,
        )
    )

    region = _to_string(
        _get_value(
            data,
            PRICE_REGION_COLUMNS,
        )
    )

    package_description = _to_string(
        _get_value(
            data,
            PACKAGE_DESCRIPTION_COLUMNS,
        )
    )

    quantity = _to_decimal(
        _get_value(
            data,
            QUANTITY_COLUMNS,
        )
    )

    return [
        PriceRecord(
            price=price,
            currency=currency,
            country=country,
            region=region,
            package_description=package_description,
            quantity=quantity,
        )
    ]


# ============================================================
# MAIN MAPPER
# ============================================================


def map_raw_record(
    raw_record: RawRecord,
) -> MedicineRecord:
    """
    Converts one RawRecord into one standardized MedicineRecord.

    This is the main public function used by the ingestion pipeline.

    Parameters
    ----------
    raw_record:
        A RawRecord produced by loader.py.

    Returns
    -------
    MedicineRecord

    Notes
    -----
    This function does not validate whether the record is complete.

    Example:

        RawRecord
            ↓
        map_raw_record()
            ↓
        MedicineRecord
    """

    data = raw_record.data

    # --------------------------------------------------------
    # CORE IDENTITY
    # --------------------------------------------------------

    canonical_name = _to_string(
        _get_value(
            data,
            CANONICAL_NAME_COLUMNS,
        )
    )

    # canonical_name is required by MedicineRecord.
    #
    # We intentionally use an empty string if the CSV does not
    # provide a recognizable medicine name.
    #
    # validator.py will later mark this record as invalid.

    if canonical_name is None:
        canonical_name = ""

    brand_name = _to_string(
        _get_value(
            data,
            BRAND_NAME_COLUMNS,
        )
    )

    generic_name = _to_string(
        _get_value(
            data,
            GENERIC_NAME_COLUMNS,
        )
    )

    medicine_type = _to_string(
        _get_value(
            data,
            MEDICINE_TYPE_COLUMNS,
        )
    )

    category = _to_string(
        _get_value(
            data,
            CATEGORY_COLUMNS,
        )
    )

    # --------------------------------------------------------
    # DESCRIPTION / PURPOSE
    # --------------------------------------------------------

    description = _to_string(
        _get_value(
            data,
            DESCRIPTION_COLUMNS,
        )
    )

    purpose = _to_string(
        _get_value(
            data,
            PURPOSE_COLUMNS,
        )
    )

    # --------------------------------------------------------
    # PHARMACEUTICAL INFORMATION
    # --------------------------------------------------------

    dosage_form = _to_string(
        _get_value(
            data,
            DOSAGE_FORM_COLUMNS,
        )
    )

    strength_value = _to_decimal(
        _get_value(
            data,
            STRENGTH_VALUE_COLUMNS,
        )
    )

    strength_unit = _to_string(
        _get_value(
            data,
            STRENGTH_UNIT_COLUMNS,
        )
    )

    prescription_required = _to_boolean(
        _get_value(
            data,
            PRESCRIPTION_REQUIRED_COLUMNS,
        )
    )

    usage_instructions = _to_string(
        _get_value(
            data,
            USAGE_INSTRUCTIONS_COLUMNS,
        )
    )

    storage_information = _to_string(
        _get_value(
            data,
            STORAGE_INFORMATION_COLUMNS,
        )
    )

    # --------------------------------------------------------
    # GEOGRAPHIC INFORMATION
    # --------------------------------------------------------

    country = _to_string(
        _get_value(
            data,
            COUNTRY_COLUMNS,
        )
    )

    currency = _to_string(
        _get_value(
            data,
            CURRENCY_COLUMNS,
        )
    )

    # --------------------------------------------------------
    # COST
    # --------------------------------------------------------

    average_cost = _to_decimal(
        _get_value(
            data,
            AVERAGE_COST_COLUMNS,
        )
    )

    # --------------------------------------------------------
    # IMAGE
    # --------------------------------------------------------

    image_url = _to_string(
        _get_value(
            data,
            IMAGE_URL_COLUMNS,
        )
    )

    # --------------------------------------------------------
    # RELATED ENTITIES
    # --------------------------------------------------------

    manufacturer = _build_manufacturer(
        data
    )

    ingredients = _build_ingredients(
        data
    )

    aliases = _build_aliases(
        data
    )

    side_effects = _build_side_effects(
        data
    )

    precautions = _build_precautions(
        data
    )

    contraindications = _build_contraindications(
        data
    )

    prices = _build_prices(
        data
    )

    # --------------------------------------------------------
    # PROVENANCE
    # --------------------------------------------------------

    source: SourceMetadata = raw_record.source

    # --------------------------------------------------------
    # BUILD CANONICAL RECORD
    # --------------------------------------------------------

    return MedicineRecord(

        # Core identity
        canonical_name=canonical_name,
        brand_name=brand_name,
        generic_name=generic_name,
        medicine_type=medicine_type,
        category=category,

        # Description
        description=description,
        purpose=purpose,

        # Pharmaceutical information
        dosage_form=dosage_form,
        strength_value=strength_value,
        strength_unit=strength_unit,
        prescription_required=prescription_required,
        usage_instructions=usage_instructions,
        storage_information=storage_information,

        # Geographic information
        country=country,
        currency=currency,

        # Cost
        average_cost=average_cost,

        # Image
        image_url=image_url,

        # Manufacturer
        manufacturer=manufacturer,

        # Relationships
        ingredients=ingredients,
        aliases=aliases,
        side_effects=side_effects,
        precautions=precautions,
        contraindications=contraindications,
        prices=prices,

        # Provenance
        sources=[
            source
        ],
    )


# ============================================================
# BATCH MAPPING
# ============================================================


def map_raw_records(
    raw_records: list[RawRecord],
) -> list[MedicineRecord]:
    """
    Converts multiple RawRecord objects into MedicineRecord objects.

    Useful for batch processing CSV files.

    Parameters
    ----------
    raw_records:
        Records returned by loader.py.

    Returns
    -------
    list[MedicineRecord]
    """

    return [
        map_raw_record(raw_record)
        for raw_record in raw_records
    ]

# ============================================================
# MAPPER SERVICE CLASS
# ============================================================


class MedicineMapper:
    """
    Public mapper interface for the MedDecode ingestion pipeline.

    Converts one RawRecord into the canonical MedicineRecord.
    """

    def map(
        self,
        raw_record: RawRecord,
    ) -> MedicineRecord:
        """
        Map one raw CSV record into a MedicineRecord.
        """

        return map_raw_record(
            raw_record=raw_record,
        )
