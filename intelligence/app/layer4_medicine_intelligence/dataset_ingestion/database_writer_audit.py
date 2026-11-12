"""
Stage A integration audit for the MedDecode DatabaseWriter.

This audit uses an in-memory fake Supabase-style database.

It verifies that DatabaseWriter can:

    INSERT a medicine
    resolve/create a manufacturer
    resolve/create active ingredients
    write aliases
    write medicine ingredients
    write side effects
    write precautions
    write contraindications
    write prices
    write provenance sources

No real Supabase connection is used.
No production data is modified.
"""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from typing import Any

from .database_writer import DatabaseWriter
from .models import (
    ActiveIngredientRecord,
    ContraindicationRecord,
    ManufacturerRecord,
    MedicineAliasRecord,
    MedicineIngredientRecord,
    MedicineRecord,
    MergeAction,
    MergeDecision,
    PrecautionRecord,
    PriceRecord,
    SideEffectRecord,
    SourceMetadata,
)


# ============================================================
# AUDIT EXCEPTION
# ============================================================


class AuditFailure(Exception):
    """
    Raised when a DatabaseWriter audit check fails.
    """


# ============================================================
# FAKE RESPONSE
# ============================================================


class FakeResponse:
    """
    Minimal Supabase/PostgREST-style response.
    """

    def __init__(
        self,
        data: list[dict[str, Any]] | None = None,
    ) -> None:
        self.data = data or []


# ============================================================
# FAKE DATABASE
# ============================================================


class FakeDatabase:
    """
    In-memory fake database.

    Supports the subset of Supabase query operations used by
    DatabaseWriter:

        table()
        select()
        eq()
        insert()
        update()
        execute()
    """

    def __init__(self) -> None:

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

        self._id_counters: dict[
            str,
            int
        ] = {
            table_name: 0
            for table_name in self.tables
        }

    def table(
        self,
        table_name: str,
    ) -> "FakeQuery":

        if table_name not in self.tables:

            raise ValueError(
                f"Unknown table: {table_name}"
            )

        return FakeQuery(
            database=self,
            table_name=table_name,
        )

    def _generate_id(
        self,
        table_name: str,
    ) -> str:

        self._id_counters[
            table_name
        ] += 1

        return (
            f"{table_name}-"
            f"{self._id_counters[table_name]}"
        )


# ============================================================
# FAKE QUERY
# ============================================================


class FakeQuery:
    """
    Chainable in-memory query implementation.
    """

    def __init__(
        self,
        database: FakeDatabase,
        table_name: str,
    ) -> None:

        self.database = database
        self.table_name = table_name

        self._filters: list[
            tuple[str, Any]
        ] = []

        self._operation: str = "select"

        self._insert_payload: (
            dict[str, Any] | None
        ) = None

        self._update_payload: (
            dict[str, Any] | None
        ) = None

    # --------------------------------------------------------
    # SELECT
    # --------------------------------------------------------

    def select(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> "FakeQuery":

        self._operation = "select"

        return self

    # --------------------------------------------------------
    # FILTER
    # --------------------------------------------------------

    def eq(
        self,
        column: str,
        value: Any,
    ) -> "FakeQuery":

        self._filters.append(
            (
                column,
                value,
            )
        )

        return self

    # --------------------------------------------------------
    # INSERT
    # --------------------------------------------------------

    def insert(
        self,
        payload: dict[str, Any],
    ) -> "FakeQuery":

        self._operation = "insert"

        self._insert_payload = (
            deepcopy(payload)
        )

        return self

    # --------------------------------------------------------
    # UPDATE
    # --------------------------------------------------------

    def update(
        self,
        payload: dict[str, Any],
    ) -> "FakeQuery":

        self._operation = "update"

        self._update_payload = (
            deepcopy(payload)
        )

        return self

    # --------------------------------------------------------
    # ROW FILTERING
    # --------------------------------------------------------

    def _matching_rows(
        self,
    ) -> list[dict[str, Any]]:

        rows = (
            self.database.tables[
                self.table_name
            ]
        )

        matching_rows: list[
            dict[str, Any]
        ] = []

        for row in rows:

            matches = True

            for column, value in (
                self._filters
            ):

                if (
                    row.get(column)
                    != value
                ):

                    matches = False

                    break

            if matches:

                matching_rows.append(
                    row
                )

        return matching_rows

    # --------------------------------------------------------
    # EXECUTE
    # --------------------------------------------------------

    def execute(
        self,
    ) -> FakeResponse:

        # ----------------------------------------------------
        # SELECT
        # ----------------------------------------------------

        if self._operation == "select":

            rows = [
                deepcopy(row)
                for row in self._matching_rows()
            ]

            return FakeResponse(
                data=rows
            )

        # ----------------------------------------------------
        # INSERT
        # ----------------------------------------------------

        if self._operation == "insert":

            if (
                self._insert_payload
                is None
            ):

                raise RuntimeError(
                    "Insert payload missing."
                )

            row = deepcopy(
                self._insert_payload
            )

            if "id" not in row:

                row["id"] = (
                    self.database
                    ._generate_id(
                        self.table_name
                    )
                )

            self.database.tables[
                self.table_name
            ].append(
                row
            )

            return FakeResponse(
                data=[
                    deepcopy(row)
                ]
            )

        # ----------------------------------------------------
        # UPDATE
        # ----------------------------------------------------

        if self._operation == "update":

            if (
                self._update_payload
                is None
            ):

                raise RuntimeError(
                    "Update payload missing."
                )

            updated_rows: list[
                dict[str, Any]
            ] = []

            for row in self._matching_rows():

                row.update(
                    deepcopy(
                        self._update_payload
                    )
                )

                updated_rows.append(
                    deepcopy(row)
                )

            return FakeResponse(
                data=updated_rows
            )

        raise RuntimeError(
            f"Unsupported operation: "
            f"{self._operation}"
        )


# ============================================================
# ASSERTION HELPERS
# ============================================================


def assert_true(
    condition: bool,
    message: str,
) -> None:

    if not condition:

        raise AuditFailure(
            message
        )


def assert_equal(
    actual: Any,
    expected: Any,
    message: str,
) -> None:

    if actual != expected:

        raise AuditFailure(
            f"{message}\n"
            f"Expected: {expected!r}\n"
            f"Actual:   {actual!r}"
        )


def print_pass(
    message: str,
) -> None:

    print(
        f"PASS: {message}"
    )


# ============================================================
# TEST MEDICINE
# ============================================================


def create_test_medicine(
) -> MedicineRecord:
    """
    Create a fully populated medicine record.

    This intentionally exercises all supported related-table writers.
    """

    return MedicineRecord(

        canonical_name=(
            "Database Writer Audit Medicine"
        ),

        normalized_name=(
            "database writer audit medicine"
        ),

        brand_name=(
            "DB AuditMed"
        ),

        generic_name=(
            "Audit Generic Medicine"
        ),

        medicine_type=(
            "tablet"
        ),

        category=(
            "integration_test"
        ),

        description=(
            "Controlled record used only for "
            "DatabaseWriter Stage A auditing."
        ),

        purpose=(
            "DatabaseWriter integration testing"
        ),

        dosage_form=(
            "tablet"
        ),

        strength_value=(
            Decimal("500")
        ),

        strength_unit=(
            "mg"
        ),

        prescription_required=False,

        usage_instructions=(
            "Use only for integration testing."
        ),

        storage_information=(
            "Store under controlled audit conditions."
        ),

        country=(
            "India"
        ),

        currency=(
            "INR"
        ),

        average_cost=(
            Decimal("25.50")
        ),

        image_url=(
            "https://example.invalid/"
            "audit-medicine.png"
        ),

        manufacturer=ManufacturerRecord(

            name=(
                "Database Audit Pharma"
            ),

            normalized_name=(
                "database audit pharma"
            ),

            country=(
                "India"
            ),
        ),

        ingredients=[

            MedicineIngredientRecord(

                ingredient=(
                    ActiveIngredientRecord(

                        ingredient_name=(
                            "Audit Ingredient"
                        ),

                        normalized_name=(
                            "audit ingredient"
                        ),

                        description=(
                            "Ingredient used for "
                            "integration auditing."
                        ),
                    )
                ),

                ingredient_strength_value=(
                    Decimal("500")
                ),

                ingredient_strength_unit=(
                    "mg"
                ),
            )
        ],

        aliases=[

            MedicineAliasRecord(

                alias_name=(
                    "DB Audit Alias"
                ),

                alias_type=(
                    "brand"
                ),

                normalized_alias=(
                    "db audit alias"
                ),
            )
        ],

        side_effects=[

            SideEffectRecord(

                side_effect=(
                    "Audit nausea"
                ),

                frequency=(
                    "rare"
                ),

                source=(
                    "integration_audit"
                ),
            )
        ],

        precautions=[

            PrecautionRecord(

                precaution=(
                    "Audit precaution"
                ),

                source=(
                    "integration_audit"
                ),
            )
        ],

        contraindications=[

            ContraindicationRecord(

                contraindication=(
                    "Audit contraindication"
                ),

                source=(
                    "integration_audit"
                ),
            )
        ],

        prices=[

            PriceRecord(

                price=(
                    Decimal("25.50")
                ),

                currency=(
                    "INR"
                ),

                country=(
                    "India"
                ),

                region=(
                    "Audit Region"
                ),

                package_description=(
                    "10 tablets"
                ),

                quantity=(
                    Decimal("10")
                ),

                source=(
                    "integration_audit"
                ),
            )
        ],

        sources=[

            SourceMetadata(

                source_dataset=(
                    "integration_audit"
                ),

                source_record_id=(
                    "audit-record-001"
                ),

                source_url=(
                    "https://example.invalid/"
                    "audit-source"
                ),

                source_record_hash=(
                    "audit-hash-001"
                ),
            )
        ],
    )


# ============================================================
# INSERT AUDIT
# ============================================================


def audit_insert_flow(
) -> None:

    database = FakeDatabase()

    writer = DatabaseWriter(
        database
    )

    medicine = (
        create_test_medicine()
    )

    decision = MergeDecision(

        action=MergeAction.INSERT,

        record=medicine,

        reason=(
            "Stage A integration audit."
        ),
    )

    # --------------------------------------------------------
    # EXECUTE WRITER
    # --------------------------------------------------------

    medicine_id = writer.write(
        decision
    )

    assert_true(
        medicine_id is not None,
        (
            "DatabaseWriter did not return "
            "a medicine ID."
        ),
    )

    print_pass(
        "DatabaseWriter returned medicine ID"
    )

    # --------------------------------------------------------
    # MANUFACTURER
    # --------------------------------------------------------

    assert_equal(
        len(
            database.tables[
                "manufacturers"
            ]
        ),
        1,
        "Expected one manufacturer.",
    )

    manufacturer = (
        database.tables[
            "manufacturers"
        ][0]
    )

    assert_equal(
        manufacturer["name"],
        "Database Audit Pharma",
        "Manufacturer name mismatch.",
    )

    print_pass(
        "Manufacturer created"
    )

    # --------------------------------------------------------
    # MEDICINE
    # --------------------------------------------------------

    assert_equal(
        len(
            database.tables[
                "medicines"
            ]
        ),
        1,
        "Expected one medicine.",
    )

    stored_medicine = (
        database.tables[
            "medicines"
        ][0]
    )

    assert_equal(
        stored_medicine["id"],
        medicine_id,
        "Returned medicine ID mismatch.",
    )

    assert_equal(
        stored_medicine[
            "normalized_name"
        ],
        "database writer audit medicine",
        "Normalized medicine name mismatch.",
    )

    assert_true(
        stored_medicine.get(
            "manufacturer_id"
        )
        == manufacturer["id"],
        (
            "Medicine manufacturer_id "
            "does not reference manufacturer."
        ),
    )

    print_pass(
        "Medicine created with manufacturer FK"
    )

    # --------------------------------------------------------
    # ACTIVE INGREDIENT
    # --------------------------------------------------------

    assert_equal(
        len(
            database.tables[
                "active_ingredients"
            ]
        ),
        1,
        "Expected one active ingredient.",
    )

    ingredient = (
        database.tables[
            "active_ingredients"
        ][0]
    )

    print_pass(
        "Active ingredient created"
    )

    # --------------------------------------------------------
    # MEDICINE INGREDIENT
    # --------------------------------------------------------

    assert_equal(
        len(
            database.tables[
                "medicine_ingredients"
            ]
        ),
        1,
        "Expected one medicine ingredient relation.",
    )

    medicine_ingredient = (
        database.tables[
            "medicine_ingredients"
        ][0]
    )

    assert_equal(
        medicine_ingredient[
            "medicine_id"
        ],
        medicine_id,
        "Medicine ingredient medicine_id mismatch.",
    )

    assert_equal(
        medicine_ingredient[
            "ingredient_id"
        ],
        ingredient["id"],
        "Medicine ingredient ingredient_id mismatch.",
    )

    print_pass(
        "Medicine ingredient relationship created"
    )

    # --------------------------------------------------------
    # ALIAS
    # --------------------------------------------------------

    assert_equal(
        len(
            database.tables[
                "medicine_aliases"
            ]
        ),
        1,
        "Expected one medicine alias.",
    )

    assert_equal(
        database.tables[
            "medicine_aliases"
        ][0]["medicine_id"],
        medicine_id,
        "Alias medicine_id mismatch.",
    )

    print_pass(
        "Medicine alias created"
    )

    # --------------------------------------------------------
    # SIDE EFFECT
    # --------------------------------------------------------

    assert_equal(
        len(
            database.tables[
                "medicine_side_effects"
            ]
        ),
        1,
        "Expected one side effect.",
    )

    assert_equal(
        database.tables[
            "medicine_side_effects"
        ][0]["medicine_id"],
        medicine_id,
        "Side effect medicine_id mismatch.",
    )

    print_pass(
        "Medicine side effect created"
    )

    # --------------------------------------------------------
    # PRECAUTION
    # --------------------------------------------------------

    assert_equal(
        len(
            database.tables[
                "medicine_precautions"
            ]
        ),
        1,
        "Expected one precaution.",
    )

    assert_equal(
        database.tables[
            "medicine_precautions"
        ][0]["medicine_id"],
        medicine_id,
        "Precaution medicine_id mismatch.",
    )

    print_pass(
        "Medicine precaution created"
    )

    # --------------------------------------------------------
    # CONTRAINDICATION
    # --------------------------------------------------------

    assert_equal(
        len(
            database.tables[
                "medicine_contraindications"
            ]
        ),
        1,
        "Expected one contraindication.",
    )

    assert_equal(
        database.tables[
            "medicine_contraindications"
        ][0]["medicine_id"],
        medicine_id,
        "Contraindication medicine_id mismatch.",
    )

    print_pass(
        "Medicine contraindication created"
    )

    # --------------------------------------------------------
    # PRICE
    # --------------------------------------------------------

    assert_equal(
        len(
            database.tables[
                "medicine_prices"
            ]
        ),
        1,
        "Expected one price record.",
    )

    assert_equal(
        database.tables[
            "medicine_prices"
        ][0]["medicine_id"],
        medicine_id,
        "Price medicine_id mismatch.",
    )

    print_pass(
        "Medicine price created"
    )

    # --------------------------------------------------------
    # SOURCE
    # --------------------------------------------------------

    assert_equal(
        len(
            database.tables[
                "medicine_sources"
            ]
        ),
        1,
        "Expected one source record.",
    )

    assert_equal(
        database.tables[
            "medicine_sources"
        ][0]["medicine_id"],
        medicine_id,
        "Source medicine_id mismatch.",
    )

    print_pass(
        "Medicine source provenance created"
    )


# ============================================================
# DUPLICATE RELATED DATA AUDIT
# ============================================================


def audit_duplicate_protection(
) -> None:

    database = FakeDatabase()

    writer = DatabaseWriter(
        database
    )

    medicine = (
        create_test_medicine()
    )

    # --------------------------------------------------------
    # FIRST INSERT
    # --------------------------------------------------------

    insert_decision = MergeDecision(

        action=MergeAction.INSERT,

        record=medicine,
    )

    medicine_id = writer.write(
        insert_decision
    )

    assert_true(
        medicine_id is not None,
        "Initial insert failed.",
    )

    # --------------------------------------------------------
    # UPDATE WITH SAME RELATED DATA
    # --------------------------------------------------------

    update_decision = MergeDecision(

        action=MergeAction.UPDATE,

        target_medicine_id=medicine_id,

        record=medicine,
    )

    updated_id = writer.write(
        update_decision
    )

    assert_equal(
        updated_id,
        medicine_id,
        "Update returned wrong medicine ID.",
    )

    # --------------------------------------------------------
    # VERIFY DEDUPLICATION
    # --------------------------------------------------------

    expected_single_row_tables = [

        "manufacturers",

        "active_ingredients",

        "medicines",

        "medicine_aliases",

        "medicine_ingredients",

        "medicine_side_effects",

        "medicine_precautions",

        "medicine_contraindications",

        "medicine_sources",
    ]

    for table_name in (
        expected_single_row_tables
    ):

        assert_equal(
            len(
                database.tables[
                    table_name
                ]
            ),
            1,
            (
                f"Expected one row in "
                f"{table_name} after "
                f"duplicate update."
            ),
        )

    print_pass(
        "Duplicate related data protection verified"
    )

    # Prices are intentionally source observations and the
    # current DatabaseWriter always inserts them.

    assert_equal(
        len(
            database.tables[
                "medicine_prices"
            ]
        ),
        2,
        (
            "Expected price observations "
            "to remain append-only."
        ),
    )

    print_pass(
        "Price observations remain append-only"
    )


# ============================================================
# MAIN AUDIT
# ============================================================


def run_database_writer_audit(
) -> None:

    print()

    print(
        "=" * 60
    )

    print(
        "MedDecode DatabaseWriter Stage A Audit"
    )

    print(
        "=" * 60
    )

    # --------------------------------------------------------
    # INSERT FLOW
    # --------------------------------------------------------

    print()

    print(
        "Testing INSERT flow..."
    )

    audit_insert_flow()

    # --------------------------------------------------------
    # DUPLICATE PROTECTION
    # --------------------------------------------------------

    print()

    print(
        "Testing duplicate protection..."
    )

    audit_duplicate_protection()

    # --------------------------------------------------------
    # SUCCESS
    # --------------------------------------------------------

    print()

    print(
        "=" * 60
    )

    print(
        "DATABASE WRITER STAGE A AUDIT PASSED"
    )

    print(
        "=" * 60
    )

    print(
        "Verified:"
    )

    print(
        "INSERT flow"
    )

    print(
        "Manufacturer resolution"
    )

    print(
        "Active ingredient resolution"
    )

    print(
        "Foreign-key relationships"
    )

    print(
        "Related intelligence writing"
    )

    print(
        "Duplicate related-data protection"
    )

    print(
        "Append-only price behavior"
    )

    print()

    print(
        "No real Supabase connection was used."
    )


# ============================================================
# ENTRY POINT
# ============================================================


if __name__ == "__main__":

    try:

        run_database_writer_audit()

    except AuditFailure as exc:

        print()

        print(
            "DATABASE WRITER AUDIT FAILED"
        )

        print(
            f"Reason: {exc}"
        )

        raise SystemExit(
            1
        )

    except Exception as exc:

        print()

        print(
            "DATABASE WRITER AUDIT ERROR"
        )

        print(
            f"{type(exc).__name__}: {exc}"
        )

        raise SystemExit(
            1
        )