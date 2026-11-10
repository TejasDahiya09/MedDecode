"""
MedDecode medicine dataset ingestion pipeline.

This module orchestrates the complete CSV ingestion flow.

Pipeline:

CSV File
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
    ↓
Supabase PostgreSQL

Important:
- Only CSV files are accepted by this pipeline.
- One failed record must not stop the complete ingestion job.
- Individual processing results are returned as PipelineResult objects.
- Invalid or ambiguous records are handled safely.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

from .candidate_finder import CandidateFinder
from .database_writer import DatabaseWriter
from .loader import CSVLoader
from .mapper import MedicineMapper
from .merger import MedicineMerger
from .models import (
    MatchStatus,
    MedicineRecord,
    MergeAction,
    PipelineResult,
    RawRecord,
)
from .normalizer import MedicineNormalizer
from .transformer import MedicineTransformer
from .validator import MedicineValidator


# ============================================================
# PIPELINE SUMMARY
# ============================================================


@dataclass
class IngestionSummary:
    """
    Summary of one complete CSV ingestion run.
    """

    source_file: str

    total_records: int = 0
    successful_records: int = 0
    failed_records: int = 0

    inserted_records: int = 0
    updated_records: int = 0
    skipped_records: int = 0
    review_records: int = 0
    invalid_records: int = 0

    results: list[PipelineResult] = field(
        default_factory=list
    )

    @property
    def success_rate(self) -> float:
        """
        Percentage of records successfully processed.
        """

        if self.total_records == 0:
            return 0.0

        return (
            self.successful_records
            / self.total_records
        ) * 100


# ============================================================
# INGESTION PIPELINE
# ============================================================


class MedicineIngestionPipeline:
    """
    Main orchestrator for the MedDecode medicine ingestion pipeline.

    This class coordinates all ingestion stages but does not contain
    business logic that belongs inside individual pipeline modules.
    """

    def __init__(
        self,
        loader: CSVLoader,
        mapper: MedicineMapper,
        transformer: MedicineTransformer,
        normalizer: MedicineNormalizer,
        validator: MedicineValidator,
        candidate_finder: CandidateFinder,
        merger: MedicineMerger,
        database_writer: DatabaseWriter,
    ) -> None:
        """
        Initialize the ingestion pipeline with all dependencies.

        Dependency injection is used so each module remains independently
        testable and replaceable.
        """

        self.loader = loader
        self.mapper = mapper
        self.transformer = transformer
        self.normalizer = normalizer
        self.validator = validator
        self.candidate_finder = candidate_finder
        self.merger = merger
        self.database_writer = database_writer

    # ========================================================
    # PUBLIC CSV INGESTION METHOD
    # ========================================================

    def ingest_csv(
        self,
        csv_path: str | Path,
        source_dataset: str,
    ) -> IngestionSummary:
        """
        Ingest a complete CSV dataset.

        Parameters
        ----------
        csv_path:
            Path to the CSV file.

        source_dataset:
            Identifier for the dataset source.

        Returns
        -------
        IngestionSummary
            Complete result summary for the ingestion run.
        """

        csv_path = Path(csv_path)

        self._validate_csv_path(csv_path)

        summary = IngestionSummary(
            source_file=str(csv_path)
        )

        raw_records = self.loader.load(
            file_path=str(csv_path),
            source_dataset=source_dataset,
        )

        for raw_record in raw_records:

            summary.total_records += 1

            result = self.process_record(
                raw_record=raw_record
            )

            summary.results.append(result)

            self._update_summary(
                summary=summary,
                result=result,
            )

        return summary

    # ========================================================
    # SINGLE RECORD PROCESSING
    # ========================================================

    def process_record(
        self,
        raw_record: RawRecord,
    ) -> PipelineResult:
        """
        Process one RawRecord through the complete ingestion pipeline.

        Errors are isolated to the individual record so that one
        malformed CSV row does not stop the full ingestion process.
        """

        result = PipelineResult(
            raw_record=raw_record
        )

        try:

            # ------------------------------------------------
            # STEP 1: MAP RAW CSV DATA
            # ------------------------------------------------

            medicine = self.mapper.map(
                raw_record
            )

            # ------------------------------------------------
            # STEP 2: TRANSFORM DATA
            # ------------------------------------------------

            medicine = self.transformer.transform(
                medicine
            )

            # ------------------------------------------------
            # STEP 3: NORMALIZE DATA
            # ------------------------------------------------

            medicine = self.normalizer.normalize(
                medicine
            )

            result.medicine = medicine

            # ------------------------------------------------
            # STEP 4: VALIDATE DATA
            # ------------------------------------------------

            validation = self.validator.validate(
                medicine
            )

            result.validation = validation

            # Invalid records must never reach the database.
            if not validation.is_valid:

                result.success = False

                result.error_message = (
                    "Record failed validation."
                )

                return result

            # ------------------------------------------------
            # STEP 5: FIND DATABASE CANDIDATES
            # ------------------------------------------------

            candidate_result = (
                self.candidate_finder.find_candidates(
                    medicine
                )
            )

            result.candidate_result = (
                candidate_result
            )

            # ------------------------------------------------
            # STEP 6: DETERMINE MERGE ACTION
            # ------------------------------------------------

            merge_decision = self.merger.decide(
                record=medicine,
                candidate_result=candidate_result,
            )

            result.merge_decision = (
                merge_decision
            )

            # ------------------------------------------------
            # STEP 7: HANDLE REVIEW RECORDS
            # ------------------------------------------------

            if (
                merge_decision.action
                == MergeAction.REVIEW
            ):

                result.success = False

                result.error_message = (
                    merge_decision.reason
                    or "Record requires manual review."
                )

                return result

            # ------------------------------------------------
            # STEP 8: HANDLE SKIPPED RECORDS
            # ------------------------------------------------

            if (
                merge_decision.action
                == MergeAction.SKIP
            ):

                result.success = True

                return result

            # ------------------------------------------------
            # STEP 9: WRITE TO DATABASE
            # ------------------------------------------------

            self.database_writer.write(
                merge_decision
            )

            result.success = True

            return result

        except Exception as exc:

            result.success = False

            result.error_message = str(exc)

            return result

    # ========================================================
    # CSV PATH VALIDATION
    # ========================================================

    @staticmethod
    def _validate_csv_path(
        csv_path: Path,
    ) -> None:
        """
        Validate that the supplied file exists and is a CSV file.
        """

        if not csv_path.exists():

            raise FileNotFoundError(
                f"CSV file not found: {csv_path}"
            )

        if not csv_path.is_file():

            raise ValueError(
                f"Path is not a file: {csv_path}"
            )

        if csv_path.suffix.lower() != ".csv":

            raise ValueError(
                "Only CSV files are supported "
                "by the ingestion pipeline."
            )

    # ========================================================
    # SUMMARY UPDATES
    # ========================================================

    @staticmethod
    def _update_summary(
        summary: IngestionSummary,
        result: PipelineResult,
    ) -> None:
        """
        Update ingestion statistics using the result of one record.
        """

        # ----------------------------------------------------
        # VALIDATION FAILURE
        # ----------------------------------------------------

        if (
            result.validation is not None
            and not result.validation.is_valid
        ):

            summary.invalid_records += 1
            summary.failed_records += 1

            return

        # ----------------------------------------------------
        # PROCESSING FAILURE
        # ----------------------------------------------------

        if not result.success:

            summary.failed_records += 1

        else:

            summary.successful_records += 1

        # ----------------------------------------------------
        # MERGE ACTION STATISTICS
        # ----------------------------------------------------

        if result.merge_decision is None:

            return

        action = result.merge_decision.action

        if action == MergeAction.INSERT:

            summary.inserted_records += 1

        elif action == MergeAction.UPDATE:

            summary.updated_records += 1

        elif action == MergeAction.SKIP:

            summary.skipped_records += 1

        elif action == MergeAction.REVIEW:

            summary.review_records += 1


# ============================================================
# CONVENIENCE FUNCTION
# ============================================================


def ingest_medicine_csv(
    csv_path: str | Path,
    source_dataset: str,
    pipeline: MedicineIngestionPipeline,
) -> IngestionSummary:
    """
    Convenience function for ingesting a CSV file.

    Example:

        summary = ingest_medicine_csv(
            csv_path="data/medicines.csv",
            source_dataset="dataset_name",
            pipeline=pipeline,
        )
    """

    return pipeline.ingest_csv(
        csv_path=csv_path,
        source_dataset=source_dataset,
    )