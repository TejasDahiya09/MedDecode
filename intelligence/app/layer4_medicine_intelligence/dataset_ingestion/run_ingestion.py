
"""
Configurable MedDecode Supabase ingestion runner.

This script performs real database writes.
Review the CSV and confirm before execution.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from app.database.supabase_client import get_supabase_client

from .candidate_finder import CandidateFinder
from .database_writer import DatabaseWriter
from .loader import CSVLoader
from .mapper import MedicineMapper
from .merger import MedicineMerger
from .normalizer import MedicineNormalizer
from .pipeline import MedicineIngestionPipeline
from .transformer import MedicineTransformer
from .validator import MedicineValidator


def build_pipeline() -> MedicineIngestionPipeline:
    database = get_supabase_client()

    return MedicineIngestionPipeline(
        loader=CSVLoader(),
        mapper=MedicineMapper(),
        transformer=MedicineTransformer(),
        normalizer=MedicineNormalizer(),
        validator=MedicineValidator(),
        candidate_finder=CandidateFinder(database=database),
        merger=MedicineMerger(),
        database_writer=DatabaseWriter(database=database),
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingest medicine CSV into MedDecode Supabase"
    )
    parser.add_argument("--csv", required=True, help="Path to input CSV")
    parser.add_argument(
        "--source-dataset",
        required=True,
        help="Source dataset identifier",
    )
    parser.add_argument(
        "--confirm-write",
        action="store_true",
        help="Confirm that real Supabase writes are authorized",
    )

    args = parser.parse_args()
    csv_path = Path(args.csv)

    if not csv_path.is_file():
        parser.error(f"CSV file does not exist: {csv_path}")

    if not args.confirm_write:
        parser.error(
            "No database writes performed. "
            "Review the CSV and rerun with --confirm-write when ready."
        )

    print(f"CSV: {csv_path}")
    print(f"Source dataset: {args.source_dataset}")
    print("WARNING: This operation writes to Supabase.")

    confirmation = input(
        "Type INGEST to confirm real database writes: "
    )

    if confirmation != "INGEST":
        print("Cancelled. No ingestion started.")
        return

    pipeline = build_pipeline()

    summary = pipeline.ingest_csv(
        csv_path=csv_path,
        source_dataset=args.source_dataset,
    )

    print("\n========== INGESTION SUMMARY ==========")
    print(f"Total records:      {summary.total_records}")
    print(f"Successful records: {summary.successful_records}")
    print(f"Failed records:     {summary.failed_records}")
    print(f"Inserted records:   {summary.inserted_records}")
    print(f"Updated records:    {summary.updated_records}")
    print(f"Skipped records:    {summary.skipped_records}")
    print(f"Review records:     {summary.review_records}")
    print(f"Invalid records:    {summary.invalid_records}")
    print(f"Success rate:       {summary.success_rate:.2f}%")


if __name__ == "__main__":
    main()
