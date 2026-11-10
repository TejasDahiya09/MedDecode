"""
Real Supabase ingestion test for MedDecode.

WARNING:

This script performs actual database writes.

Use only with a small controlled CSV dataset.

Pipeline:

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
    ↓
DatabaseWriter
    ↓
Real Supabase PostgreSQL
"""

from __future__ import annotations

import argparse
from pathlib import Path

from app.database.supabase_client import (
    get_supabase_client,
)

from app.layer4_medicine_intelligence.dataset_ingestion.candidate_finder import (
    CandidateFinder,
)

from app.layer4_medicine_intelligence.dataset_ingestion.database_writer import (
    DatabaseWriter,
)

from app.layer4_medicine_intelligence.dataset_ingestion.loader import (
    CSVLoader,
)

from app.layer4_medicine_intelligence.dataset_ingestion.mapper import (
    MedicineMapper,
)

from app.layer4_medicine_intelligence.dataset_ingestion.merger import (
    MedicineMerger,
)

from app.layer4_medicine_intelligence.dataset_ingestion.normalizer import (
    MedicineNormalizer,
)

from app.layer4_medicine_intelligence.dataset_ingestion.pipeline import (
    MedicineIngestionPipeline,
)

from app.layer4_medicine_intelligence.dataset_ingestion.transformer import (
    MedicineTransformer,
)

from app.layer4_medicine_intelligence.dataset_ingestion.validator import (
    MedicineValidator,
)


def build_pipeline() -> MedicineIngestionPipeline:
    """
    Build the complete ingestion pipeline using
    the real Supabase database client.
    """

    database = get_supabase_client()

    loader = CSVLoader()

    mapper = MedicineMapper()

    transformer = MedicineTransformer()

    normalizer = MedicineNormalizer()

    validator = MedicineValidator()

    candidate_finder = CandidateFinder(
        database=database
    )

    merger = MedicineMerger()

    database_writer = DatabaseWriter(
        database=database
    )

    return MedicineIngestionPipeline(
        loader=loader,
        mapper=mapper,
        transformer=transformer,
        normalizer=normalizer,
        validator=validator,
        candidate_finder=candidate_finder,
        merger=merger,
        database_writer=database_writer,
    )


def print_summary(
    summary,
) -> None:
    """
    Print ingestion results.
    """

    print()
    print("=" * 60)
    print("MedDecode Real Supabase Ingestion Summary")
    print("=" * 60)
    print()

    print(
        f"Source file: {summary.source_file}"
    )

    print(
        f"Total records: {summary.total_records}"
    )

    print(
        f"Successful records: "
        f"{summary.successful_records}"
    )

    print(
        f"Failed records: "
        f"{summary.failed_records}"
    )

    print()

    print(
        f"Inserted: {summary.inserted_records}"
    )

    print(
        f"Updated: {summary.updated_records}"
    )

    print(
        f"Skipped: {summary.skipped_records}"
    )

    print(
        f"Review required: "
        f"{summary.review_records}"
    )

    print(
        f"Invalid: {summary.invalid_records}"
    )

    print()

    print(
        f"Success rate: "
        f"{summary.success_rate:.2f}%"
    )

    print()
    print("=" * 60)

    if summary.failed_records > 0:

        print()
        print("FAILED RECORD DETAILS")
        print()

        for index, result in enumerate(
            summary.results,
            start=1,
        ):

            if result.success:
                continue

            print(
                f"Record {index}: "
                f"{result.error_message}"
            )


def main() -> None:
    """
    Run a real ingestion job.
    """

    parser = argparse.ArgumentParser(
        description=(
            "Ingest a medicine CSV into "
            "MedDecode Supabase."
        )
    )

    parser.add_argument(
        "csv_path",
        type=str,
        help="Path to the CSV file.",
    )

    parser.add_argument(
        "--source-dataset",
        required=True,
        type=str,
        help=(
            "Dataset identifier used for "
            "source provenance."
        ),
    )

    args = parser.parse_args()

    csv_path = Path(
        args.csv_path
    )

    print()
    print("=" * 60)
    print("MedDecode REAL Supabase Ingestion")
    print("=" * 60)
    print()

    print(
        f"CSV: {csv_path}"
    )

    print(
        f"Source dataset: "
        f"{args.source_dataset}"
    )

    print()
    print(
        "WARNING: This run performs actual "
        "Supabase database writes."
    )

    print()

    pipeline = build_pipeline()

    summary = pipeline.ingest_csv(
        csv_path=csv_path,
        source_dataset=args.source_dataset,
    )

    print_summary(
        summary
    )


if __name__ == "__main__":
    main()