"""
Database writer for the MedDecode medicine dataset ingestion pipeline.

Responsibility:

    MergeDecision
        ↓
    INSERT / UPDATE / SKIP / REVIEW
        ↓
    Supabase PostgreSQL

This module is responsible for writing canonical medicine data and
related medicine intelligence into the database.

Supported tables:

    manufacturers
    active_ingredients
    medicines

    medicine_aliases
    medicine_ingredients
    medicine_side_effects
    medicine_precautions
    medicine_contraindications
    medicine_prices
    medicine_sources

This module does NOT:

- search for medicine candidates
- decide whether two medicines are the same
- determine merge policy

Those responsibilities belong to:

candidate_finder.py
    → candidate discovery

merger.py
    → INSERT / UPDATE / SKIP / REVIEW decision

Pipeline position:

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
from typing import Any, Optional

from .models import (
    ActiveIngredientRecord,
    MedicineRecord,
    MergeAction,
    MergeDecision,
)


# ============================================================
# GENERIC HELPERS
# ============================================================

def _decimal_to_database_value(
    value: Optional[Decimal],
) -> Optional[str]:
    """
    Converts Decimal values into database-safe values.

    Decimal is converted to string to avoid floating-point precision
    problems during database serialization.
    """

    if value is None:
        return None

    return str(value)


def _remove_none_values(
    data: dict[str, Any],
) -> dict[str, Any]:
    """
    Removes None values from an update payload.

    This is important for UPDATE operations because an incoming dataset
    should not overwrite existing database information with NULL merely
    because that dataset does not provide a field.
    """

    return {
        key: value
        for key, value in data.items()
        if value is not None
    }


def _response_data(
    response: Any,
) -> list[dict[str, Any]]:
    """
    Extracts row data from a Supabase/PostgREST response.
    """

    data = getattr(response, "data", None)

    if not isinstance(data, list):
        return []

    return data


def _get_single_response_row(
    response: Any,
) -> Optional[dict[str, Any]]:
    """
    Returns the first row from a database response.
    """

    rows = _response_data(response)

    if not rows:
        return None

    return rows[0]


# ============================================================
# MANUFACTURER OPERATIONS
# ============================================================

def _get_or_create_manufacturer(
    database: Any,
    medicine: MedicineRecord,
) -> Optional[str]:
    """
    Resolves the manufacturer ID for a MedicineRecord.

    Search strategy:

        normalized_name
            ↓
        existing manufacturer
            ↓
        otherwise INSERT manufacturer

    Returns:

        manufacturer UUID/string ID
        or None when the medicine has no manufacturer.
    """

    manufacturer = medicine.manufacturer

    if manufacturer is None:
        return None

    if not manufacturer.name:
        return None

    normalized_name = (
        manufacturer.normalized_name
        or manufacturer.name
    )

    # --------------------------------------------------------
    # Search existing manufacturer
    # --------------------------------------------------------

    response = (
        database
        .table("manufacturers")
        .select("id")
        .eq(
            "normalized_name",
            normalized_name,
        )
        .execute()
    )

    existing = _get_single_response_row(
        response
    )

    if existing is not None:
        return str(existing["id"])

    # --------------------------------------------------------
    # Insert new manufacturer
    # --------------------------------------------------------

    insert_payload = {
        "name": manufacturer.name,
        "normalized_name": normalized_name,
    }

    # country is only included if your manufacturers table
    # actually contains this column.
    #
    # If country is not present in your schema, do not add it.
    if manufacturer.country is not None:
        insert_payload["country"] = (
            manufacturer.country
        )

    response = (
        database
        .table("manufacturers")
        .insert(insert_payload)
        .execute()
    )

    inserted = _get_single_response_row(
        response
    )

    if inserted is None:
        raise RuntimeError(
            "Failed to create manufacturer."
        )

    return str(inserted["id"])


# ============================================================
# ACTIVE INGREDIENT OPERATIONS
# ============================================================

def _get_or_create_active_ingredient(
    database: Any,
    ingredient: ActiveIngredientRecord,
) -> str:
    """
    Resolves an active ingredient ID.

    Uses normalized_name as the canonical identity.

    Returns the existing or newly created ingredient ID.
    """

    normalized_name = (
        ingredient.normalized_name
        or ingredient.ingredient_name
    )

    # --------------------------------------------------------
    # Search existing ingredient
    # --------------------------------------------------------

    response = (
        database
        .table("active_ingredients")
        .select("id")
        .eq(
            "normalized_name",
            normalized_name,
        )
        .execute()
    )

    existing = _get_single_response_row(
        response
    )

    if existing is not None:
        return str(existing["id"])

    # --------------------------------------------------------
    # Insert ingredient
    # --------------------------------------------------------

    payload = {
        "ingredient_name": (
            ingredient.ingredient_name
        ),
        "normalized_name": normalized_name,
    }

    # Only include description if the database schema supports it.
    if ingredient.description is not None:
        payload["description"] = (
            ingredient.description
        )

    response = (
        database
        .table("active_ingredients")
        .insert(payload)
        .execute()
    )

    inserted = _get_single_response_row(
        response
    )

    if inserted is None:
        raise RuntimeError(
            "Failed to create active ingredient."
        )

    return str(inserted["id"])


# ============================================================
# MEDICINE CORE PAYLOAD
# ============================================================

def _build_medicine_payload(
    medicine: MedicineRecord,
    manufacturer_id: Optional[str],
) -> dict[str, Any]:
    """
    Converts MedicineRecord into a medicines table payload.
    """

    return {
        "canonical_name": (
            medicine.canonical_name
        ),
        "normalized_name": (
            medicine.normalized_name
        ),
        "brand_name": medicine.brand_name,
        "generic_name": medicine.generic_name,
        "medicine_type": (
            medicine.medicine_type
        ),
        "category": medicine.category,
        "description": medicine.description,
        "purpose": medicine.purpose,
        "dosage_form": medicine.dosage_form,
        "strength_value": (
            _decimal_to_database_value(
                medicine.strength_value
            )
        ),
        "strength_unit": (
            medicine.strength_unit
        ),
        "prescription_required": (
            medicine.prescription_required
        ),
        "usage_instructions": (
            medicine.usage_instructions
        ),
        "storage_information": (
            medicine.storage_information
        ),
        "country": medicine.country,
        "currency": medicine.currency,
        "average_cost": (
            _decimal_to_database_value(
                medicine.average_cost
            )
        ),
        "image_url": medicine.image_url,
        "manufacturer_id": manufacturer_id,
    }


# ============================================================
# MEDICINE INSERT / UPDATE
# ============================================================

def _insert_medicine(
    database: Any,
    medicine: MedicineRecord,
) -> str:
    """
    Inserts a new canonical medicine.

    Returns the new medicine ID.
    """

    manufacturer_id = (
        _get_or_create_manufacturer(
            database,
            medicine,
        )
    )

    payload = _build_medicine_payload(
        medicine=medicine,
        manufacturer_id=manufacturer_id,
    )

    response = (
        database
        .table("medicines")
        .insert(payload)
        .execute()
    )

    inserted = _get_single_response_row(
        response
    )

    if inserted is None:
        raise RuntimeError(
            "Failed to insert medicine."
        )

    return str(inserted["id"])


def _update_medicine(
    database: Any,
    medicine_id: str,
    medicine: MedicineRecord,
) -> str:
    """
    Updates an existing medicine.

    Important rule:

        Incoming NULL values never overwrite existing database values.

    Only fields with actual values are sent in the update payload.
    """

    manufacturer_id = (
        _get_or_create_manufacturer(
            database,
            medicine,
        )
    )

    payload = _build_medicine_payload(
        medicine=medicine,
        manufacturer_id=manufacturer_id,
    )

    # Never update normalized identity automatically.
    #
    # The existing medicine was selected using this identity and changing
    # it during enrichment could create an inconsistent merge.
    payload.pop(
        "normalized_name",
        None,
    )

    # Canonical name should not be overwritten during enrichment unless
    # explicit future merge policy permits it.
    payload.pop(
        "canonical_name",
        None,
    )

    payload = _remove_none_values(
        payload
    )

    if not payload:
        return medicine_id

    (
        database
        .table("medicines")
        .update(payload)
        .eq("id", medicine_id)
        .execute()
    )

    return medicine_id


# ============================================================
# ALIAS WRITING
# ============================================================

def _write_aliases(
    database: Any,
    medicine_id: str,
    medicine: MedicineRecord,
) -> None:
    """
    Inserts medicine aliases.

    Existing aliases are not duplicated.

    Conflict handling is delegated to the database's UNIQUE constraints.
    """

    for alias in medicine.aliases:

        if not alias.alias_name:
            continue

        normalized_alias = (
            alias.normalized_alias
            or alias.alias_name
        )

        payload = {
            "medicine_id": medicine_id,
            "alias_name": alias.alias_name,
            "alias_type": alias.alias_type,
            "normalized_alias": normalized_alias,
        }

        payload = _remove_none_values(
            payload
        )

        # Check first because alias uniqueness is scoped to medicine.
        existing = (
            database
            .table("medicine_aliases")
            .select("id")
            .eq("medicine_id", medicine_id)
            .eq(
                "normalized_alias",
                normalized_alias,
            )
            .execute()
        )

        if _get_single_response_row(
            existing
        ) is not None:
            continue

        (
            database
            .table("medicine_aliases")
            .insert(payload)
            .execute()
        )


# ============================================================
# INGREDIENT WRITING
# ============================================================

def _write_ingredients(
    database: Any,
    medicine_id: str,
    medicine: MedicineRecord,
) -> None:
    """
    Writes medicine-to-active-ingredient relationships.
    """

    for relation in medicine.ingredients:

        ingredient_id = (
            _get_or_create_active_ingredient(
                database=database,
                ingredient=relation.ingredient,
            )
        )

        existing = (
            database
            .table("medicine_ingredients")
            .select("id")
            .eq("medicine_id", medicine_id)
            .eq(
                "ingredient_id",
                ingredient_id,
            )
            .execute()
        )

        if _get_single_response_row(
            existing
        ) is not None:
            continue

        payload = {
            "medicine_id": medicine_id,
            "ingredient_id": ingredient_id,
            "ingredient_strength_value": (
                _decimal_to_database_value(
                    relation.ingredient_strength_value
                )
            ),
            "ingredient_strength_unit": (
                relation.ingredient_strength_unit
            ),
        }

        payload = _remove_none_values(
            payload
        )

        (
            database
            .table("medicine_ingredients")
            .insert(payload)
            .execute()
        )


# ============================================================
# SIDE EFFECT WRITING
# ============================================================

def _write_side_effects(
    database: Any,
    medicine_id: str,
    medicine: MedicineRecord,
) -> None:
    """
    Inserts medicine side effects.
    """

    for item in medicine.side_effects:

        if not item.side_effect:
            continue

        existing = (
            database
            .table("medicine_side_effects")
            .select("id")
            .eq(
                "medicine_id",
                medicine_id,
            )
            .eq(
                "side_effect",
                item.side_effect,
            )
            .execute()
        )

        if _get_single_response_row(
            existing
        ) is not None:
            continue

        payload = {
            "medicine_id": medicine_id,
            "side_effect": item.side_effect,
            "frequency": item.frequency,
            "source": item.source,
        }

        payload = _remove_none_values(
            payload
        )

        (
            database
            .table("medicine_side_effects")
            .insert(payload)
            .execute()
        )


# ============================================================
# PRECAUTION WRITING
# ============================================================

def _write_precautions(
    database: Any,
    medicine_id: str,
    medicine: MedicineRecord,
) -> None:
    """
    Inserts medicine precautions.
    """

    for item in medicine.precautions:

        if not item.precaution:
            continue

        existing = (
            database
            .table("medicine_precautions")
            .select("id")
            .eq(
                "medicine_id",
                medicine_id,
            )
            .eq(
                "precaution",
                item.precaution,
            )
            .execute()
        )

        if _get_single_response_row(
            existing
        ) is not None:
            continue

        payload = {
            "medicine_id": medicine_id,
            "precaution": item.precaution,
            "source": item.source,
        }

        payload = _remove_none_values(
            payload
        )

        (
            database
            .table("medicine_precautions")
            .insert(payload)
            .execute()
        )


# ============================================================
# CONTRAINDICATION WRITING
# ============================================================

def _write_contraindications(
    database: Any,
    medicine_id: str,
    medicine: MedicineRecord,
) -> None:
    """
    Inserts medicine contraindications.
    """

    for item in medicine.contraindications:

        if not item.contraindication:
            continue

        existing = (
            database
            .table("medicine_contraindications")
            .select("id")
            .eq(
                "medicine_id",
                medicine_id,
            )
            .eq(
                "contraindication",
                item.contraindication,
            )
            .execute()
        )

        if _get_single_response_row(
            existing
        ) is not None:
            continue

        payload = {
            "medicine_id": medicine_id,
            "contraindication": (
                item.contraindication
            ),
            "source": item.source,
        }

        payload = _remove_none_values(
            payload
        )

        (
            database
            .table(
                "medicine_contraindications"
            )
            .insert(payload)
            .execute()
        )


# ============================================================
# PRICE WRITING
# ============================================================

def _write_prices(
    database: Any,
    medicine_id: str,
    medicine: MedicineRecord,
) -> None:
    """
    Inserts medicine price records.

    Prices are intentionally treated as source-specific observations.

    Therefore, this function does not attempt to overwrite historical
    or regional price information.
    """

    for item in medicine.prices:

        payload = {
            "medicine_id": medicine_id,
            "price": (
                _decimal_to_database_value(
                    item.price
                )
            ),
            "currency": item.currency,
            "country": item.country,
            "region": item.region,
            "package_description": (
                item.package_description
            ),
            "quantity": (
                _decimal_to_database_value(
                    item.quantity
                )
            ),
            "source": item.source,
        }

        payload = _remove_none_values(
            payload
        )

        (
            database
            .table("medicine_prices")
            .insert(payload)
            .execute()
        )


# ============================================================
# SOURCE / PROVENANCE WRITING
# ============================================================

def _write_sources(
    database: Any,
    medicine_id: str,
    medicine: MedicineRecord,
) -> None:
    """
    Writes source provenance into medicine_sources.

    Duplicate source records are prevented using the database's
    source_dataset/source_record_id uniqueness rules.
    """

    for source in medicine.sources:

        payload = {
            "medicine_id": medicine_id,
            "source_dataset": (
                source.source_dataset
            ),
            "source_record_id": (
                source.source_record_id
            ),
            "source_url": source.source_url,
            "source_record_hash": (
                source.source_record_hash
            ),
        }

        payload = _remove_none_values(
            payload
        )

        # ----------------------------------------------------
        # Duplicate detection by source record ID
        # ----------------------------------------------------

        if source.source_record_id is not None:

            existing = (
                database
                .table("medicine_sources")
                .select("id")
                .eq(
                    "source_dataset",
                    source.source_dataset,
                )
                .eq(
                    "source_record_id",
                    source.source_record_id,
                )
                .execute()
            )

            if _get_single_response_row(
                existing
            ) is not None:
                continue

        # ----------------------------------------------------
        # Duplicate detection by source hash
        # ----------------------------------------------------

        elif source.source_record_hash is not None:

            existing = (
                database
                .table("medicine_sources")
                .select("id")
                .eq(
                    "source_dataset",
                    source.source_dataset,
                )
                .eq(
                    "source_record_hash",
                    source.source_record_hash,
                )
                .execute()
            )

            if _get_single_response_row(
                existing
            ) is not None:
                continue

        (
            database
            .table("medicine_sources")
            .insert(payload)
            .execute()
        )


# ============================================================
# RELATED DATA WRITING
# ============================================================

def _write_related_data(
    database: Any,
    medicine_id: str,
    medicine: MedicineRecord,
) -> None:
    """
    Writes all related medicine information.
    """

    _write_aliases(
        database,
        medicine_id,
        medicine,
    )

    _write_ingredients(
        database,
        medicine_id,
        medicine,
    )

    _write_side_effects(
        database,
        medicine_id,
        medicine,
    )

    _write_precautions(
        database,
        medicine_id,
        medicine,
    )

    _write_contraindications(
        database,
        medicine_id,
        medicine,
    )

    _write_prices(
        database,
        medicine_id,
        medicine,
    )

    _write_sources(
        database,
        medicine_id,
        medicine,
    )


# ============================================================
# PUBLIC DATABASE WRITER
# ============================================================

def write_merge_decision(
    database: Any,
    decision: MergeDecision,
) -> Optional[str]:
    """
    Executes a MergeDecision.

    Decision behavior:

    INSERT
        → Insert new medicine
        → Write all related information

    UPDATE
        → Update existing medicine
        → Write additional related information

    SKIP
        → Do nothing

    REVIEW
        → Do nothing

    Parameters
    ----------
    database:
        Configured Supabase/PostgreSQL client.

    decision:
        MergeDecision returned by merger.py.

    Returns
    -------
    Optional[str]

        Medicine ID when INSERT or UPDATE succeeds.

        None when SKIP or REVIEW requires no database modification.
    """

    # ========================================================
    # SKIP
    # ========================================================

    if decision.action == MergeAction.SKIP:
        return None

    # ========================================================
    # REVIEW
    # ========================================================

    if decision.action == MergeAction.REVIEW:
        return None

    # Defensive validation.

    if decision.record is None:
        raise ValueError(
            "MergeDecision record is required "
            "for INSERT or UPDATE."
        )

    medicine = decision.record

    # ========================================================
    # INSERT
    # ========================================================

    if decision.action == MergeAction.INSERT:

        medicine_id = _insert_medicine(
            database=database,
            medicine=medicine,
        )

        _write_related_data(
            database=database,
            medicine_id=medicine_id,
            medicine=medicine,
        )

        return medicine_id

    # ========================================================
    # UPDATE
    # ========================================================

    if decision.action == MergeAction.UPDATE:

        if decision.target_medicine_id is None:
            raise ValueError(
                "target_medicine_id is required "
                "for UPDATE."
            )

        medicine_id = _update_medicine(
            database=database,
            medicine_id=decision.target_medicine_id,
            medicine=medicine,
        )

        _write_related_data(
            database=database,
            medicine_id=medicine_id,
            medicine=medicine,
        )

        return medicine_id

    # ========================================================
    # UNKNOWN ACTION
    # ========================================================

    raise ValueError(
        f"Unsupported merge action: "
        f"{decision.action}"
    )

# ============================================================
# DATABASE WRITER CLASS
# ============================================================


class DatabaseWriter:
    """
    Database writer service for the MedDecode ingestion pipeline.

    This class wraps the functional database-writing implementation
    so the ingestion pipeline can use a consistent object-oriented
    interface.

    Usage:

        writer = DatabaseWriter(database)
        medicine_id = writer.write(decision)
    """

    def __init__(
        self,
        database: Any,
    ) -> None:
        """
        Initialize the database writer.

        Parameters
        ----------
        database:
            Configured Supabase/PostgreSQL client.
        """

        self.database = database

    def write(
        self,
        decision: MergeDecision,
    ) -> Optional[str]:
        """
        Execute a MergeDecision against the database.

        Parameters
        ----------
        decision:
            MergeDecision produced by merger.py.

        Returns
        -------
        Optional[str]

            Medicine ID when INSERT or UPDATE succeeds.

            None when the decision is SKIP or REVIEW.
        """

        return write_merge_decision(
            database=self.database,
            decision=decision,
        )