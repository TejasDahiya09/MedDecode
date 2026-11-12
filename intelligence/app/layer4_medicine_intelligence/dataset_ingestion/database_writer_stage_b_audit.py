"""
MedDecode DatabaseWriter Stage B Audit.

This audit verifies the UPDATE, SKIP, and REVIEW behavior of
database_writer.py without using a real Supabase connection.

Stage B verifies:

1. Existing medicine UPDATE flow
2. canonical_name is not overwritten
3. normalized_name is not overwritten
4. Non-None enrichment fields are updated
5. None values do not erase existing database data
6. Existing manufacturer handling
7. New manufacturer assignment
8. New aliases are added
9. Duplicate aliases are prevented
10. New ingredients are added
11. Duplicate ingredient relationships are prevented
12. Related intelligence is enriched safely
13. SKIP performs no database write
14. REVIEW performs no database write
15. UPDATE without target_medicine_id raises ValueError
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from decimal import Decimal
from typing import Any, Optional

from .database_writer import DatabaseWriter
from .models import (
    ActiveIngredientRecord,
    CandidateSearchResult,
    ManufacturerRecord,
    MatchStatus,
    MedicineAliasRecord,
    MedicineCandidate,
    MedicineIngredientRecord,
    MedicineRecord,
    MergeAction,
    MergeDecision,
    PriceRecord,
    PrecautionRecord,
    SideEffectRecord,
    SourceMetadata,
)


# ============================================================
# AUDIT HELPERS
# ============================================================


class AuditFailure(Exception):
    """Raised when an audit assertion fails."""


def assert_true(
    condition: bool,
    message: str,
) -> None:
    """
    Raise AuditFailure when a condition is false.
    """

    if not condition:
        raise AuditFailure(message)


def print_pass(
    message: str,
) -> None:
    """
    Print a successful audit check.
    """

    print(f"PASS: {message}")


# ============================================================
# FAKE SUPABASE DATABASE
# ============================================================


class FakeResponse:
    """
    Minimal Supabase/PostgREST-style response.
    """

    def __init__(
        self,
        data: list[dict[str, Any]],
    ) -> None:
        self.data = data


class FakeTable:
    """
    Minimal in-memory implementation of a Supabase table API.

    Supports the operations used by DatabaseWriter:

        select()
        insert()
        update()
        eq()
        execute()
    """

    def __init__(
        self,
        database: "FakeDatabase",
        table_name: str,
    ) -> None:

        self.database = database
        self.table_name = table_name

        self._operation: Optional[str] = None
        self._select_columns: Optional[str] = None
        self._insert_payload: Optional[
            dict[str, Any]
        ] = None
        self._update_payload: Optional[
            dict[str, Any]
        ] = None
        self._filters: list[
            tuple[str, Any]
        ] = []

    def select(
        self,
        columns: str = "*",
    ) -> "FakeTable":

        self._operation = "select"
        self._select_columns = columns

        return self

    def insert(
        self,
        payload: dict[str, Any],
    ) -> "FakeTable":

        self._operation = "insert"
        self._insert_payload = deepcopy(
            payload
        )

        return self

    def update(
        self,
        payload: dict[str, Any],
    ) -> "FakeTable":

        self._operation = "update"
        self._update_payload = deepcopy(
            payload
        )

        return self

    def eq(
        self,
        field_name: str,
        value: Any,
    ) -> "FakeTable":

        self._filters.append(
            (
                field_name,
                value,
            )
        )

        return self

    def _matching_rows(
        self,
    ) -> list[dict[str, Any]]:

        rows = self.database.tables[
            self.table_name
        ]

        results: list[dict[str, Any]] = []

        for row in rows:

            matches = True

            for field_name, value in self._filters:

                if row.get(field_name) != value:

                    matches = False
                    break

            if matches:

                results.append(row)

        return results

    def _project_row(
        self,
        row: dict[str, Any],
    ) -> dict[str, Any]:

        if (
            self._select_columns is None
            or self._select_columns.strip() == "*"
        ):

            return deepcopy(row)

        columns = [
            column.strip()
            for column in (
                self._select_columns
                .replace("\n", " ")
                .split(",")
            )
        ]

        projected: dict[str, Any] = {}

        for column in columns:

            if not column:
                continue

            if column in row:

                projected[column] = row[
                    column
                ]

        return projected

    def execute(
        self,
    ) -> FakeResponse:

        self.database.execute_count += 1

        # ----------------------------------------------------
        # SELECT
        # ----------------------------------------------------

        if self._operation == "select":

            rows = self._matching_rows()

            return FakeResponse(
                [
                    self._project_row(row)
                    for row in rows
                ]
            )

        # ----------------------------------------------------
        # INSERT
        # ----------------------------------------------------

        if self._operation == "insert":

            if self._insert_payload is None:

                raise RuntimeError(
                    "Insert payload missing."
                )

            self.database.insert_count += 1

            row = deepcopy(
                self._insert_payload
            )

            if "id" not in row:

                row["id"] = (
                    self.database.next_id(
                        self.table_name
                    )
                )

            self.database.tables[
                self.table_name
            ].append(row)

            return FakeResponse(
                [
                    deepcopy(row)
                ]
            )

        # ----------------------------------------------------
        # UPDATE
        # ----------------------------------------------------

        if self._operation == "update":

            if self._update_payload is None:

                raise RuntimeError(
                    "Update payload missing."
                )

            self.database.update_count += 1

            rows = self._matching_rows()

            updated_rows: list[
                dict[str, Any]
            ] = []

            for row in rows:

                row.update(
                    deepcopy(
                        self._update_payload
                    )
                )

                updated_rows.append(
                    deepcopy(row)
                )

            return FakeResponse(
                updated_rows
            )

        raise RuntimeError(
            f"Unsupported operation: "
            f"{self._operation}"
        )


class FakeDatabase:
    """
    In-memory fake Supabase database.
    """

    def __init__(
        self,
    ) -> None:

        self.tables: dict[
            str,
            list[dict[str, Any]]
        ] = {
            "manufacturers": [],
            "active_ingredients": [],
            "medicines": [],
            "medicine_aliases": [],
            "medicine_ingredients": [],
            "medicine_side_effects": [],
            "medicine_precautions": [],
            "medicine_contraindications": [],
            "medicine_prices": [],
            "medicine_sources": [],
        }

        self.execute_count = 0
        self.insert_count = 0
        self.update_count = 0

        self._id_counters: dict[
            str,
            int
        ] = {}

    def table(
        self,
        table_name: str,
    ) -> FakeTable:

        if table_name not in self.tables:

            raise ValueError(
                f"Unknown table: {table_name}"
            )

        return FakeTable(
            database=self,
            table_name=table_name,
        )

    def next_id(
        self,
        table_name: str,
    ) -> str:

        current = (
            self._id_counters.get(
                table_name,
                0,
            )
            + 1
        )

        self._id_counters[
            table_name
        ] = current

        return (
            f"{table_name}-{current}"
        )


# ============================================================
# AUDIT DATA BUILDERS
# ============================================================


def build_existing_database(
    database: FakeDatabase,
) -> str:
    """
    Seed an existing medicine and related records.

    Returns the medicine ID.
    """

    database.tables[
        "manufacturers"
    ].append(
        {
            "id": "manufacturer-existing",
            "name": "Existing Pharma",
            "normalized_name": (
                "existing pharma"
            ),
        }
    )

    database.tables[
        "active_ingredients"
    ].append(
        {
            "id": "ingredient-existing",
            "ingredient_name": (
                "Paracetamol"
            ),
            "normalized_name": (
                "paracetamol"
            ),
        }
    )

    medicine_id = (
        "medicine-existing"
    )

    database.tables[
        "medicines"
    ].append(
        {
            "id": medicine_id,

            # Protected identity fields.
            "canonical_name": (
                "Original Paracetamol"
            ),
            "normalized_name": (
                "original paracetamol"
            ),

            # Existing enrichment data.
            "brand_name": (
                "Original Brand"
            ),
            "generic_name": (
                "Paracetamol"
            ),
            "description": (
                "Existing description"
            ),
            "purpose": (
                "Existing purpose"
            ),
            "medicine_type": (
                "tablet"
            ),
            "dosage_form": (
                "tablet"
            ),
            "strength_value": "500",
            "strength_unit": "mg",
            "prescription_required": False,
            "country": "India",
            "currency": "INR",
            "average_cost": "10",
            "manufacturer_id": (
                "manufacturer-existing"
            ),
        }
    )

    database.tables[
        "medicine_aliases"
    ].append(
        {
            "id": "alias-existing",
            "medicine_id": medicine_id,
            "alias_name": (
                "Original Alias"
            ),
            "normalized_alias": (
                "original alias"
            ),
            "alias_type": "BRAND",
        }
    )

    database.tables[
        "medicine_ingredients"
    ].append(
        {
            "id": (
                "medicine-ingredient-existing"
            ),
            "medicine_id": medicine_id,
            "ingredient_id": (
                "ingredient-existing"
            ),
            "ingredient_strength_value": (
                "500"
            ),
            "ingredient_strength_unit": (
                "mg"
            ),
        }
    )

    database.tables[
        "medicine_side_effects"
    ].append(
        {
            "id": (
                "side-effect-existing"
            ),
            "medicine_id": medicine_id,
            "side_effect": "Nausea",
        }
    )

    database.tables[
        "medicine_precautions"
    ].append(
        {
            "id": (
                "precaution-existing"
            ),
            "medicine_id": medicine_id,
            "precaution": (
                "Existing precaution"
            ),
        }
    )

    database.tables[
        "medicine_sources"
    ].append(
        {
            "id": "source-existing",
            "medicine_id": medicine_id,
            "source_dataset": (
                "existing_dataset"
            ),
            "source_record_id": (
                "existing-record"
            ),
        }
    )

    return medicine_id


def build_update_record(
) -> MedicineRecord:
    """
    Create an incoming record containing a mixture of:

    - fields that should update
    - None values that must not erase data
    - protected identity values
    - new related intelligence
    - duplicate related intelligence
    """

    return MedicineRecord(
        canonical_name=(
            "Incoming Different Name"
        ),
        normalized_name=(
            "incoming different name"
        ),

        # Should update.
        brand_name="Updated Brand",
        generic_name=None,
        description=(
            "Updated description"
        ),
        purpose=None,

        medicine_type="tablet",
        dosage_form="tablet",

        strength_value=Decimal("650"),
        strength_unit="mg",

        prescription_required=None,

        country=None,
        currency="INR",
        average_cost=None,

        manufacturer=ManufacturerRecord(
            name="New Pharma",
            normalized_name="new pharma",
        ),

        aliases=[
            # Existing duplicate.
            MedicineAliasRecord(
                alias_name="Original Alias",
                normalized_alias=(
                    "original alias"
                ),
                alias_type="BRAND",
            ),

            # New alias.
            MedicineAliasRecord(
                alias_name="Updated Alias",
                normalized_alias=(
                    "updated alias"
                ),
                alias_type="BRAND",
            ),
        ],

        ingredients=[
            # Existing relationship.
            MedicineIngredientRecord(
                ingredient=(
                    ActiveIngredientRecord(
                        ingredient_name=(
                            "Paracetamol"
                        ),
                        normalized_name=(
                            "paracetamol"
                        ),
                    )
                ),
                ingredient_strength_value=(
                    Decimal("500")
                ),
                ingredient_strength_unit="mg",
            ),

            # New ingredient.
            MedicineIngredientRecord(
                ingredient=(
                    ActiveIngredientRecord(
                        ingredient_name=(
                            "Caffeine"
                        ),
                        normalized_name=(
                            "caffeine"
                        ),
                    )
                ),
                ingredient_strength_value=(
                    Decimal("65")
                ),
                ingredient_strength_unit="mg",
            ),
        ],

        side_effects=[
            # Existing duplicate.
            SideEffectRecord(
                side_effect="Nausea"
            ),

            # New related intelligence.
            SideEffectRecord(
                side_effect="Headache"
            ),
        ],

        precautions=[
            # Existing duplicate.
            PrecautionRecord(
                precaution=(
                    "Existing precaution"
                )
            ),

            # New precaution.
            PrecautionRecord(
                precaution=(
                    "Use with caution"
                )
            ),
        ],

        prices=[
            PriceRecord(
                price=Decimal("15"),
                currency="INR",
                country="India",
                package_description=(
                    "10 tablets"
                ),
                source="new_dataset",
            )
        ],

        sources=[
            SourceMetadata(
                source_dataset="new_dataset",
                source_record_id=(
                    "new-record"
                ),
            ),

            # Existing duplicate.
            SourceMetadata(
                source_dataset=(
                    "existing_dataset"
                ),
                source_record_id=(
                    "existing-record"
                ),
            ),
        ],
    )


# ============================================================
# TABLE HELPERS
# ============================================================


def get_medicine(
    database: FakeDatabase,
    medicine_id: str,
) -> dict[str, Any]:

    for medicine in database.tables[
        "medicines"
    ]:

        if medicine["id"] == medicine_id:

            return medicine

    raise AuditFailure(
        "Medicine not found."
    )


def count_rows(
    database: FakeDatabase,
    table_name: str,
) -> int:

    return len(
        database.tables[
            table_name
        ]
    )


# ============================================================
# UPDATE FLOW AUDIT
# ============================================================


def audit_update_flow(
) -> None:

    print(
        "\nTesting UPDATE flow..."
    )

    database = FakeDatabase()

    medicine_id = (
        build_existing_database(
            database
        )
    )

    writer = DatabaseWriter(
        database=database
    )

    record = build_update_record()

    decision = MergeDecision(
        action=MergeAction.UPDATE,
        record=record,
        target_medicine_id=medicine_id,
        reason=(
            "Audit UPDATE decision."
        ),
    )

    returned_id = writer.write(
        decision
    )

    assert_true(
        returned_id == medicine_id,
        (
            "DatabaseWriter did not return "
            "the existing medicine ID."
        ),
    )

    print_pass(
        "DatabaseWriter returned existing medicine ID"
    )

    # --------------------------------------------------------
    # MEDICINE CORE UPDATE
    # --------------------------------------------------------

    medicine = get_medicine(
        database,
        medicine_id,
    )

    # Protected fields.
    assert_true(
        medicine["canonical_name"]
        == "Original Paracetamol",
        (
            "canonical_name was overwritten "
            "during UPDATE."
        ),
    )

    print_pass(
        "canonical_name remained protected"
    )

    assert_true(
        medicine["normalized_name"]
        == "original paracetamol",
        (
            "normalized_name was overwritten "
            "during UPDATE."
        ),
    )

    print_pass(
        "normalized_name remained protected"
    )

    # Non-None values update.
    assert_true(
        medicine["brand_name"]
        == "Updated Brand",
        (
            "brand_name was not updated."
        ),
    )

    assert_true(
        medicine["description"]
        == "Updated description",
        (
            "description was not updated."
        ),
    )

    assert_true(
        medicine["strength_value"]
        == "650",
        (
            "strength_value was not updated."
        ),
    )

    print_pass(
        "Non-None enrichment fields updated"
    )

    # None values must not erase existing data.
    assert_true(
        medicine["generic_name"]
        == "Paracetamol",
        (
            "None generic_name erased "
            "existing database data."
        ),
    )

    assert_true(
        medicine["purpose"]
        == "Existing purpose",
        (
            "None purpose erased "
            "existing database data."
        ),
    )

    assert_true(
        medicine["prescription_required"]
        is False,
        (
            "None prescription_required "
            "erased existing data."
        ),
    )

    assert_true(
        medicine["country"]
        == "India",
        (
            "None country erased "
            "existing data."
        ),
    )

    print_pass(
        "None values did not erase existing data"
    )

    # --------------------------------------------------------
    # MANUFACTURER UPDATE
    # --------------------------------------------------------

    assert_true(
        count_rows(
            database,
            "manufacturers",
        )
        == 2,
        (
            "New manufacturer was not "
            "created."
        ),
    )

    assert_true(
        medicine["manufacturer_id"]
        != "manufacturer-existing",
        (
            "Medicine manufacturer FK "
            "was not updated."
        ),
    )

    print_pass(
        "New manufacturer resolved and assigned"
    )

    # --------------------------------------------------------
    # ALIAS TESTS
    # --------------------------------------------------------

    assert_true(
        count_rows(
            database,
            "medicine_aliases",
        )
        == 2,
        (
            "Alias duplicate protection "
            "or new alias insertion failed."
        ),
    )

    print_pass(
        "New alias added and duplicate prevented"
    )

    # --------------------------------------------------------
    # INGREDIENT TESTS
    # --------------------------------------------------------

    assert_true(
        count_rows(
            database,
            "active_ingredients",
        )
        == 2,
        (
            "New active ingredient was "
            "not created."
        ),
    )

    assert_true(
        count_rows(
            database,
            "medicine_ingredients",
        )
        == 2,
        (
            "Ingredient relationship "
            "duplicate protection failed."
        ),
    )

    print_pass(
        "New ingredient added and duplicate "
        "relationship prevented"
    )

    # --------------------------------------------------------
    # SIDE EFFECT TESTS
    # --------------------------------------------------------

    assert_true(
        count_rows(
            database,
            "medicine_side_effects",
        )
        == 2,
        (
            "Side effect enrichment "
            "or duplicate protection failed."
        ),
    )

    print_pass(
        "Related side effects enriched safely"
    )

    # --------------------------------------------------------
    # PRECAUTION TESTS
    # --------------------------------------------------------

    assert_true(
        count_rows(
            database,
            "medicine_precautions",
        )
        == 2,
        (
            "Precaution enrichment "
            "or duplicate protection failed."
        ),
    )

    print_pass(
        "Related precautions enriched safely"
    )

    # --------------------------------------------------------
    # PRICE TESTS
    # --------------------------------------------------------

    assert_true(
        count_rows(
            database,
            "medicine_prices",
        )
        == 1,
        (
            "New price observation "
            "was not inserted."
        ),
    )

    print_pass(
        "New price observation appended"
    )

    # --------------------------------------------------------
    # SOURCE TESTS
    # --------------------------------------------------------

    assert_true(
        count_rows(
            database,
            "medicine_sources",
        )
        == 2,
        (
            "Source duplicate protection "
            "or new source insertion failed."
        ),
    )

    print_pass(
        "New source added and duplicate prevented"
    )


# ============================================================
# SKIP AUDIT
# ============================================================


def audit_skip_flow(
) -> None:

    print(
        "\nTesting SKIP flow..."
    )

    database = FakeDatabase()

    medicine_id = (
        build_existing_database(
            database
        )
    )

    writer = DatabaseWriter(
        database=database
    )

    before_tables = deepcopy(
        database.tables
    )

    before_execute_count = (
        database.execute_count
    )

    decision = MergeDecision(
        action=MergeAction.SKIP,
        record=None,
        target_medicine_id=medicine_id,
        reason="Audit SKIP decision.",
    )

    returned_id = writer.write(
        decision
    )

    assert_true(
        returned_id is None,
        (
            "SKIP should return None."
        ),
    )

    assert_true(
        database.tables
        == before_tables,
        (
            "SKIP modified database data."
        ),
    )

    assert_true(
        database.execute_count
        == before_execute_count,
        (
            "SKIP executed database queries."
        ),
    )

    print_pass(
        "SKIP performed no database write"
    )


# ============================================================
# REVIEW AUDIT
# ============================================================


def audit_review_flow(
) -> None:

    print(
        "\nTesting REVIEW flow..."
    )

    database = FakeDatabase()

    medicine_id = (
        build_existing_database(
            database
        )
    )

    writer = DatabaseWriter(
        database=database
    )

    before_tables = deepcopy(
        database.tables
    )

    before_execute_count = (
        database.execute_count
    )

    decision = MergeDecision(
        action=MergeAction.REVIEW,
        record=None,
        target_medicine_id=medicine_id,
        reason=(
            "Audit REVIEW decision."
        ),
    )

    returned_id = writer.write(
        decision
    )

    assert_true(
        returned_id is None,
        (
            "REVIEW should return None."
        ),
    )

    assert_true(
        database.tables
        == before_tables,
        (
            "REVIEW modified database data."
        ),
    )

    assert_true(
        database.execute_count
        == before_execute_count,
        (
            "REVIEW executed database queries."
        ),
    )

    print_pass(
        "REVIEW performed no database write"
    )


# ============================================================
# INVALID UPDATE AUDIT
# ============================================================


def audit_missing_target_id(
) -> None:

    print(
        "\nTesting invalid UPDATE flow..."
    )

    database = FakeDatabase()

    writer = DatabaseWriter(
        database=database
    )

    record = build_update_record()

    decision = MergeDecision(
        action=MergeAction.UPDATE,
        record=record,
        target_medicine_id=None,
        reason=(
            "Missing target medicine ID."
        ),
    )

    raised = False

    try:

        writer.write(
            decision
        )

    except ValueError:

        raised = True

    assert_true(
        raised,
        (
            "UPDATE without target_medicine_id "
            "did not raise ValueError."
        ),
    )

    print_pass(
        "UPDATE without target_medicine_id "
        "raises ValueError"
    )


# ============================================================
# MAIN
# ============================================================


def main(
) -> None:

    print(
        "\n"
        + "=" * 60
    )

    print(
        "MedDecode DatabaseWriter Stage B Audit"
    )

    print(
        "=" * 60
    )

    try:

        audit_update_flow()

        audit_skip_flow()

        audit_review_flow()

        audit_missing_target_id()

    except AuditFailure as exc:

        print(
            "\n"
            + "=" * 60
        )

        print(
            "DATABASE WRITER STAGE B AUDIT FAILED"
        )

        print(
            "=" * 60
        )

        print(
            f"\nFAIL: {exc}"
        )

        raise

    print(
        "\n"
        + "=" * 60
    )

    print(
        "DATABASE WRITER STAGE B AUDIT PASSED"
    )

    print(
        "=" * 60
    )

    print(
        "Verified:"
    )

    print(
        "UPDATE flow"
    )

    print(
        "Protected medicine identity"
    )

    print(
        "Non-None enrichment updates"
    )

    print(
        "None-value overwrite protection"
    )

    print(
        "Manufacturer reassignment"
    )

    print(
        "Related-data enrichment"
    )

    print(
        "Duplicate protection"
    )

    print(
        "Append-only price behavior"
    )

    print(
        "SKIP no-write behavior"
    )

    print(
        "REVIEW no-write behavior"
    )

    print(
        "UPDATE target ID validation"
    )

    print(
        "\nNo real Supabase connection was used."
    )


if __name__ == "__main__":

    main()