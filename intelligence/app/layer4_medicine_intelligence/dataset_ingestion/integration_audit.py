"""
Integration audit for the MedDecode medicine dataset ingestion pipeline.

This audit verifies that the complete ingestion pipeline can process
a CSV record through all non-writing stages.

The audit intentionally does NOT connect to Supabase and does NOT
write any data to the production database.

Verified flow:

CSV
    ↓
CSVLoader
    ↓
MedicineMapper
    ↓
MedicineTransformer
    ↓
MedicineNormalizer
    ↓
MedicineValidator
    ↓
CandidateFinder
    ↓
MedicineMerger

Expected result:

NEW candidate
    ↓
INSERT merge decision
"""

from __future__ import annotations

import csv
import tempfile
from pathlib import Path
from typing import Any

from .candidate_finder import CandidateFinder
from .loader import CSVLoader
from .mapper import MedicineMapper
from .merger import MedicineMerger
from .models import (
    MatchStatus,
    MedicineRecord,
    MergeAction,
)
from .normalizer import MedicineNormalizer
from .transformer import MedicineTransformer
from .validator import MedicineValidator


# ============================================================
# AUDIT EXCEPTION
# ============================================================


class AuditFailure(Exception):
    """
    Raised when an integration audit check fails.
    """


# ============================================================
# FAKE DATABASE
# ============================================================


class FakeResponse:
    """
    Minimal response object compatible with the ingestion modules.
    """

    def __init__(
        self,
        data: list[dict[str, Any]] | None = None,
    ) -> None:
        self.data = data or []


class FakeQuery:
    """
    Minimal chainable query object.

    Supports the read operations required by CandidateFinder.
    """

    def __init__(
        self,
        rows: list[dict[str, Any]] | None = None,
    ) -> None:
        self._rows = rows or []

    def select(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> "FakeQuery":
        return self

    def eq(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> "FakeQuery":
        return self

    def execute(
        self,
    ) -> FakeResponse:
        return FakeResponse(
            data=list(self._rows)
        )


class FakeDatabase:
    """
    Empty in-memory database used for dry-run candidate testing.

    All table queries return no rows.

    Therefore:

        CandidateFinder
            → NEW

    No INSERT or UPDATE operations are supported because this audit
    intentionally does not test database writing.
    """

    def table(
        self,
        table_name: str,
    ) -> FakeQuery:
        return FakeQuery(
            rows=[]
        )


# ============================================================
# ASSERTION HELPERS
# ============================================================


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
    Print a successful audit checkpoint.
    """

    print(
        f"PASS: {message}"
    )


# ============================================================
# TEMPORARY CSV CREATION
# ============================================================


def create_test_csv(
    directory: Path,
) -> Path:
    """
    Create a minimal medicine CSV for pipeline testing.

    The column names are intentionally common medicine fields.
    """

    csv_path = (
        directory
        / "integration_test_medicines.csv"
    )

    fieldnames = [
        "canonical_name",
        "brand_name",
        "generic_name",
        "medicine_type",
        "category",
        "description",
        "purpose",
        "dosage_form",
        "strength_value",
        "strength_unit",
        "prescription_required",
        "manufacturer_name",
        "ingredients",
        "side_effects",
        "precautions",
        "contraindications",
        "country",
        "currency",
    ]

    row = {
        "canonical_name": "Audit Medicine",
        "brand_name": "AuditMed",
        "generic_name": "Audit Generic",
        "medicine_type": "tablet",
        "category": "test",
        "description": "Medicine used for ingestion integration testing.",
        "purpose": "Integration testing",
        "dosage_form": "tablet",
        "strength_value": "500",
        "strength_unit": "mg",
        "prescription_required": "false",
        "manufacturer_name": "Audit Pharma",
        "ingredients": "Audit Ingredient",
        "side_effects": "Nausea",
        "precautions": "Use as directed",
        "contraindications": "Known hypersensitivity",
        "country": "India",
        "currency": "INR",
    }

    with csv_path.open(
        "w",
        newline="",
        encoding="utf-8",
    ) as file:

        writer = csv.DictWriter(
            file,
            fieldnames=fieldnames,
        )

        writer.writeheader()

        writer.writerow(
            row
        )

    return csv_path


# ============================================================
# MAIN AUDIT
# ============================================================


def run_integration_audit() -> None:
    """
    Run the complete non-writing ingestion integration audit.
    """

    print()
    print(
        "=" * 60
    )

    print(
        "MedDecode Ingestion Integration Audit"
    )

    print(
        "=" * 60
    )

    # --------------------------------------------------------
    # INITIALIZE COMPONENTS
    # --------------------------------------------------------

    database = FakeDatabase()

    loader = CSVLoader()

    mapper = MedicineMapper()

    transformer = MedicineTransformer()

    normalizer = MedicineNormalizer()

    validator = MedicineValidator()

    candidate_finder = CandidateFinder(
        database
    )

    merger = MedicineMerger()

    print_pass(
        "All pipeline components initialized"
    )

    # --------------------------------------------------------
    # CREATE TEMPORARY CSV
    # --------------------------------------------------------

    with tempfile.TemporaryDirectory() as temp_dir:

        directory = Path(
            temp_dir
        )

        csv_path = create_test_csv(
            directory
        )

        print_pass(
            "Temporary CSV created"
        )

        # ----------------------------------------------------
        # LOAD
        # ----------------------------------------------------

        raw_records = list(
            loader.load(
                file_path=str(csv_path),
                source_dataset=(
                    "integration_audit"
                ),
            )
        )

        assert_true(
            len(raw_records) == 1,
            (
                "Loader did not return exactly "
                "one RawRecord."
            ),
        )

        raw_record = raw_records[0]

        print_pass(
            "CSVLoader loaded one record"
        )

        # ----------------------------------------------------
        # MAP
        # ----------------------------------------------------

        medicine = mapper.map(
            raw_record
        )

        assert_true(
            isinstance(
                medicine,
                MedicineRecord,
            ),
            (
                "MedicineMapper did not return "
                "MedicineRecord."
            ),
        )

        print_pass(
            "MedicineMapper returned MedicineRecord"
        )

        # ----------------------------------------------------
        # TRANSFORM
        # ----------------------------------------------------

        medicine = transformer.transform(
            medicine
        )

        assert_true(
            isinstance(
                medicine,
                MedicineRecord,
            ),
            (
                "MedicineTransformer did not return "
                "MedicineRecord."
            ),
        )

        print_pass(
            "MedicineTransformer completed"
        )

        # ----------------------------------------------------
        # NORMALIZE
        # ----------------------------------------------------

        medicine = normalizer.normalize(
            medicine
        )

        assert_true(
            isinstance(
                medicine,
                MedicineRecord,
            ),
            (
                "MedicineNormalizer did not return "
                "MedicineRecord."
            ),
        )

        assert_true(
            bool(
                medicine.normalized_name
            ),
            (
                "MedicineNormalizer did not produce "
                "normalized_name."
            ),
        )

        print_pass(
            "MedicineNormalizer completed"
        )

        # ----------------------------------------------------
        # VALIDATE
        # ----------------------------------------------------

        validation = validator.validate(
            medicine
        )

        assert_true(
            validation.is_valid,
            (
                "Test record failed validation: "
                f"{validation.errors}"
            ),
        )

        print_pass(
            "MedicineValidator accepted record"
        )

        # ----------------------------------------------------
        # FIND CANDIDATES
        # ----------------------------------------------------

        candidate_result = (
            candidate_finder.find_candidates(
                medicine
            )
        )

        assert_true(
            candidate_result.match_status
            == MatchStatus.NEW,
            (
                "Expected NEW candidate status "
                "from empty fake database."
            ),
        )

        print_pass(
            "CandidateFinder returned NEW"
        )

        # ----------------------------------------------------
        # MERGE DECISION
        # ----------------------------------------------------

        merge_decision = merger.decide(
            record=medicine,
            candidate_result=candidate_result,
        )

        assert_true(
            merge_decision.action
            == MergeAction.INSERT,
            (
                "Expected INSERT merge action "
                f"but received "
                f"{merge_decision.action}."
            ),
        )

        print_pass(
            "MedicineMerger returned INSERT"
        )

        # ----------------------------------------------------
        # FINAL SUCCESS
        # ----------------------------------------------------

        print()

        print(
            "=" * 60
        )

        print(
            "INTEGRATION AUDIT PASSED"
        )

        print(
            "=" * 60
        )

        print(
            "Verified flow:"
        )

        print(
            "CSV → Loader → Mapper → Transformer → "
            "Normalizer → Validator → "
            "CandidateFinder → Merger"
        )

        print(
            "No production database writes were performed."
        )


# ============================================================
# ENTRY POINT
# ============================================================


if __name__ == "__main__":

    try:

        run_integration_audit()

    except AuditFailure as exc:

        print()

        print(
            "INTEGRATION AUDIT FAILED"
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
            "INTEGRATION AUDIT ERROR"
        )

        print(
            f"{type(exc).__name__}: {exc}"
        )

        raise SystemExit(
            1
        )