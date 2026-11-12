
"""
Read-only Supabase repository for MedDecode Layer 4 runtime.

Responsibilities:
- Retrieve medicines by normalized name.
- Retrieve exact medicine aliases.
- Search brand and generic names.
- Perform bounded partial-name searches.
- Retrieve active ingredients for candidate medicines.

This module NEVER inserts, updates or deletes database records.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any
from uuid import UUID

from app.database.supabase_client import get_supabase_client

from app.layer4_medicine_intelligence.runtime.schemas import (
    CandidateIngredient,
    MedicineCandidate,
)


MEDICINE_COLUMNS = (
    "id, canonical_name, normalized_name, "
    "brand_name, generic_name, dosage_form, "
    "strength_value, strength_unit, medicine_type, "
    "prescription_required"
)

MAX_SEARCH_RESULTS = 25


class MedicineRepository:
    """
    Read-only repository for the Supabase medicine catalogue.

    A database client can be injected for testing. If none is supplied,
    the existing shared Supabase client is used.
    """

    def __init__(
        self,
        database: Any | None = None,
        max_search_results: int = MAX_SEARCH_RESULTS,
    ) -> None:

        if max_search_results < 1:
            raise ValueError(
                "max_search_results must be at least 1."
            )

        self.database = (
            database
            if database is not None
            else get_supabase_client()
        )

        self.max_search_results = max_search_results

    # --------------------------------------------------------
    # INTERNAL HELPERS
    # --------------------------------------------------------

    def _execute(self, query: Any) -> list[dict[str, Any]]:
        """Execute a Supabase query and validate its response."""

        response = query.execute()
        data = getattr(response, "data", None)

        if data is None:
            return []

        if not isinstance(data, list):
            raise TypeError(
                "Unexpected Supabase response: expected a list."
            )

        return data

    @staticmethod
    def _to_candidate(
        row: dict[str, Any],
    ) -> MedicineCandidate:
        """Convert a medicine database row into a runtime candidate."""

        try:
            medicine_id = UUID(str(row["id"]))
        except (KeyError, ValueError, TypeError) as exc:
            raise ValueError(
                "Medicine row contains an invalid or missing UUID."
            ) from exc

        canonical_name = row.get("canonical_name")
        normalized_name = row.get("normalized_name")

        if not canonical_name or not normalized_name:
            raise ValueError(
                f"Medicine {medicine_id} has missing identity fields."
            )

        return MedicineCandidate(
            medicine_id=medicine_id,
            canonical_name=str(canonical_name),
            normalized_name=str(normalized_name),
            brand_name=row.get("brand_name"),
            generic_name=row.get("generic_name"),
            dosage_form=row.get("dosage_form"),
            strength_value=(
                float(row["strength_value"])
                if row.get("strength_value") is not None
                else None
            ),
            strength_unit=row.get("strength_unit"),
            medicine_type=row.get("medicine_type"),
            prescription_required=row.get(
                "prescription_required"
            ),
        )

    def _fetch_medicines(
        self,
        column: str,
        value: str,
        exact: bool = True,
    ) -> list[MedicineCandidate]:
        """
        Search one approved medicine identity column.

        Only fixed, internally specified column names are accepted.
        """

        allowed_columns = {
            "normalized_name",
            "brand_name",
            "generic_name",
        }

        if column not in allowed_columns:
            raise ValueError(
                f"Unsupported medicine search column: {column}"
            )

        if not value or not value.strip():
            return []

        query = (
            self.database
            .table("medicines")
            .select(MEDICINE_COLUMNS)
        )

        if exact:
            query = query.eq(column, value)
        else:
            # Prefix search avoids an unbounded full-table scan.
            query = query.ilike(
                column,
                f"{value.strip()}%"
            )

        query = query.limit(self.max_search_results)

        rows = self._execute(query)

        return [
            self._to_candidate(row)
            for row in rows
        ]

    # --------------------------------------------------------
    # EXACT CANONICAL NAME SEARCH
    # --------------------------------------------------------

    def find_by_normalized_name(
        self,
        normalized_name: str,
    ) -> list[MedicineCandidate]:
        """Find exact normalized canonical medicine names."""

        return self._fetch_medicines(
            column="normalized_name",
            value=normalized_name,
        )

    # --------------------------------------------------------
    # EXACT ALIAS SEARCH
    # --------------------------------------------------------

    def find_by_alias(
        self,
        normalized_alias: str,
    ) -> list[MedicineCandidate]:
        """
        Find medicines using exact normalized aliases.

        Alias relationships are resolved using the existing
        medicine_aliases.medicine_id foreign key.
        """

        if not normalized_alias or not normalized_alias.strip():
            return []

        query = (
            self.database
            .table("medicine_aliases")
            .select("medicine_id, alias_name, normalized_alias")
            .eq("normalized_alias", normalized_alias)
            .limit(self.max_search_results)
        )

        rows = self._execute(query)

        medicine_ids = list(
            dict.fromkeys(
                row["medicine_id"]
                for row in rows
                if row.get("medicine_id")
            )
        )

        if not medicine_ids:
            return []

        return self._fetch_by_ids(medicine_ids)

    # --------------------------------------------------------
    # SEARCH BY BRAND NAME
    # --------------------------------------------------------

    def find_by_brand_name(
        self,
        brand_name: str,
    ) -> list[MedicineCandidate]:
        """Find exact brand-name matches."""

        return self._fetch_medicines(
            column="brand_name",
            value=brand_name,
        )

    # --------------------------------------------------------
    # SEARCH BY GENERIC NAME
    # --------------------------------------------------------

    def find_by_generic_name(
        self,
        generic_name: str,
    ) -> list[MedicineCandidate]:
        """Find exact generic-name matches."""

        return self._fetch_medicines(
            column="generic_name",
            value=generic_name,
        )

    # --------------------------------------------------------
    # BOUNDED PARTIAL NAME SEARCH
    # --------------------------------------------------------

    def search_name_prefix(
        self,
        normalized_name: str,
    ) -> list[MedicineCandidate]:
        """
        Find medicine names beginning with the supplied text.

        This is a bounded retrieval operation, not final matching.
        """

        return self._fetch_medicines(
            column="normalized_name",
            value=normalized_name,
            exact=False,
        )

    # --------------------------------------------------------
    # FETCH MEDICINES BY UUID
    # --------------------------------------------------------

    def _fetch_by_ids(
        self,
        medicine_ids: list[str],
    ) -> list[MedicineCandidate]:
        """Retrieve medicines by their database UUIDs."""

        if not medicine_ids:
            return []

        query = (
            self.database
            .table("medicines")
            .select(MEDICINE_COLUMNS)
            .in_("id", medicine_ids)
            .limit(self.max_search_results)
        )

        rows = self._execute(query)

        return [
            self._to_candidate(row)
            for row in rows
        ]

    # --------------------------------------------------------
    # ACTIVE INGREDIENT RETRIEVAL
    # --------------------------------------------------------

    def load_ingredients(
        self,
        candidates: list[MedicineCandidate],
    ) -> dict[UUID, list[CandidateIngredient]]:
        """
        Load active ingredients for a batch of medicine candidates.

        Uses one relationship query instead of one query per medicine.

        Returns:
            Dictionary mapping medicine UUID to its ingredients.
        """

        medicine_ids = list(
            dict.fromkeys(
                candidate.medicine_id
                for candidate in candidates
            )
        )

        if not medicine_ids:
            return {}

        query = (
            self.database
            .table("medicine_ingredients")
            .select(
                "medicine_id, ingredient_id, "
                "ingredient_strength_value, "
                "ingredient_strength_unit, "
                "active_ingredients("
                "id, ingredient_name, normalized_name"
                ")"
            )
            .in_(
                "medicine_id",
                [str(medicine_id) for medicine_id in medicine_ids],
            )
        )

        rows = self._execute(query)

        result: dict[
            UUID,
            list[CandidateIngredient]
        ] = defaultdict(list)

        for row in rows:

            ingredient_data = row.get(
                "active_ingredients"
            )

            if not isinstance(ingredient_data, dict):
                continue

            try:
                medicine_id = UUID(
                    str(row["medicine_id"])
                )

                ingredient_id = UUID(
                    str(ingredient_data["id"])
                )

            except (KeyError, ValueError, TypeError):
                continue

            ingredient_name = ingredient_data.get(
                "ingredient_name"
            )

            if not ingredient_name:
                continue

            ingredient = CandidateIngredient(
                ingredient_id=ingredient_id,
                ingredient_name=str(ingredient_name),
                normalized_name=ingredient_data.get(
                    "normalized_name"
                ),
                strength_value=(
                    float(row["ingredient_strength_value"])
                    if row.get("ingredient_strength_value") is not None
                    else None
                ),
                strength_unit=row.get(
                    "ingredient_strength_unit"
                ),
            )

            result[medicine_id].append(ingredient)

        return dict(result)

    # --------------------------------------------------------
    # ENRICH CANDIDATES WITH INGREDIENTS
    # --------------------------------------------------------

    def enrich_with_ingredients(
        self,
        candidates: list[MedicineCandidate],
    ) -> list[MedicineCandidate]:
        """
        Attach active ingredient information to retrieved candidates.
        """

        ingredients_by_medicine = self.load_ingredients(
            candidates
        )

        for candidate in candidates:
            candidate.ingredients = (
                ingredients_by_medicine.get(
                    candidate.medicine_id,
                    [],
                )
            )

        return candidates
