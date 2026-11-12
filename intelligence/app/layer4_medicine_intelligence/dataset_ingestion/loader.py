"""
CSV loader for the MedDecode medicine dataset ingestion pipeline.

Responsibilities:
- Accept CSV files only.
- Read CSV rows safely.
- Preserve raw source column names and values.
- Convert each CSV row into a RawRecord.
- Attach source metadata and CSV row numbers.

This module does NOT:
- map source columns to MedicineRecord fields
- normalize values
- validate medicine data
- transform medicine information
- write to the database

Those responsibilities belong to later pipeline stages.
"""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path
from typing import Any, Iterator, Optional

from .models import RawRecord, SourceMetadata


# ============================================================
# CONSTANTS
# ============================================================


CSV_SUFFIX = ".csv"


# ============================================================
# EXCEPTIONS
# ============================================================


class CSVLoaderError(Exception):
    """
    Raised when a CSV file cannot be loaded correctly.
    """


class InvalidCSVFileError(CSVLoaderError):
    """
    Raised when the provided file is not a CSV file.
    """


class EmptyCSVError(CSVLoaderError):
    """
    Raised when a CSV file contains no usable records.
    """


# ============================================================
# VALIDATION HELPERS
# ============================================================


def validate_csv_path(file_path: str | Path) -> Path:
    """
    Validate that the provided path exists, is a file,
    and has a .csv extension.

    Parameters
    ----------
    file_path:
        Path to the CSV dataset.

    Returns
    -------
    Path
        Validated Path object.

    Raises
    ------
    FileNotFoundError
        If the file does not exist.

    InvalidCSVFileError
        If the path is not a file or does not have a .csv extension.
    """

    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(
            f"CSV file does not exist: {path}"
        )

    if not path.is_file():
        raise InvalidCSVFileError(
            f"Expected a CSV file, but received a non-file path: {path}"
        )

    if path.suffix.lower() != CSV_SUFFIX:
        raise InvalidCSVFileError(
            f"Only CSV files are supported. Received: {path.name}"
        )

    return path


# ============================================================
# SOURCE RECORD HASHING
# ============================================================


def create_record_hash(
    row: dict[str, Any],
) -> str:
    """
    Create a deterministic SHA-256 hash for a raw CSV row.

    The hash is useful for:
    - source-level duplicate detection
    - medicine_sources.source_record_hash
    - idempotent ingestion
    - detecting repeated CSV records

    The row is converted into a stable string representation by
    sorting its keys before hashing.
    """

    normalized_parts: list[str] = []

    for key in sorted(row.keys()):
        value = row[key]

        if value is None:
            value_string = ""
        else:
            value_string = str(value).strip()

        normalized_parts.append(
            f"{key.strip()}={value_string}"
        )

    stable_record = "|".join(normalized_parts)

    return hashlib.sha256(
        stable_record.encode("utf-8")
    ).hexdigest()


# ============================================================
# ROW CLEANING
# ============================================================


def clean_raw_value(
    value: Optional[str],
) -> Optional[str]:
    """
    Perform minimal CSV-level cleaning.

    This function intentionally does NOT perform medicine
    normalization.

    It only:
    - converts None safely
    - removes surrounding whitespace
    - converts empty strings to None

    Examples
    --------
    "  Paracetamol  " -> "Paracetamol"
    ""                -> None
    "   "             -> None

    Name normalization, case normalization, and medical data
    normalization belong to normalizer.py.
    """

    if value is None:
        return None

    cleaned = value.strip()

    if cleaned == "":
        return None

    return cleaned


def clean_raw_row(
    row: dict[str, Optional[str]],
) -> dict[str, Any]:
    """
    Clean a raw CSV row while preserving its original column names.

    Empty values become None.

    Completely empty column names are ignored because they cannot
    be reliably mapped by mapper.py.
    """

    cleaned_row: dict[str, Any] = {}

    for key, value in row.items():
        if key is None:
            continue

        cleaned_key = key.strip()

        if cleaned_key == "":
            continue

        cleaned_row[cleaned_key] = clean_raw_value(value)

    return cleaned_row


# ============================================================
# CSV READING
# ============================================================


def load_csv_records(
    file_path: str | Path,
    *,
    source_dataset: Optional[str] = None,
    source_url: Optional[str] = None,
    encoding: str = "utf-8-sig",
) -> Iterator[RawRecord]:
    """
    Load a CSV file and yield one RawRecord for each CSV row.

    Parameters
    ----------
    file_path:
        Path to the CSV file.

    source_dataset:
        Logical name of the source dataset.

        If omitted, the CSV filename without extension is used.

    source_url:
        Optional URL describing the source dataset.

    encoding:
        CSV file encoding.

        Defaults to utf-8-sig so CSV files containing a UTF-8 BOM
        are handled correctly.

    Yields
    ------
    RawRecord
        One internal raw ingestion record per CSV row.

    Raises
    ------
    FileNotFoundError
        If the CSV file does not exist.

    InvalidCSVFileError
        If the input is not a CSV file.

    EmptyCSVError
        If the CSV contains no data rows.

    CSVLoaderError
        If the CSV cannot be parsed correctly.
    """

    path = validate_csv_path(file_path)

    resolved_source_dataset = (
        source_dataset
        if source_dataset is not None
        else path.stem
    )

    record_count = 0

    try:
        with path.open(
            mode="r",
            encoding=encoding,
            newline="",
        ) as csv_file:

            reader = csv.DictReader(csv_file)

            if reader.fieldnames is None:
                raise CSVLoaderError(
                    f"CSV file has no header row: {path.name}"
                )

            for row_number, row in enumerate(
                reader,
                start=2,
            ):
                cleaned_row = clean_raw_row(row)

                # Ignore completely empty rows.
                if not any(
                    value is not None
                    for value in cleaned_row.values()
                ):
                    continue

                source_record_hash = create_record_hash(
                    cleaned_row
                )

                source_record_id = (
                    str(row_number - 1)
                )

                source = SourceMetadata(
                    source_dataset=resolved_source_dataset,
                    source_record_id=source_record_id,
                    source_url=source_url,
                    source_record_hash=source_record_hash,
                )

                yield RawRecord(
                    data=cleaned_row,
                    source=source,
                    row_number=row_number,
                )

                record_count += 1

    except UnicodeDecodeError as exc:
        raise CSVLoaderError(
            f"Unable to decode CSV file '{path.name}' "
            f"using encoding '{encoding}'."
        ) from exc

    except csv.Error as exc:
        raise CSVLoaderError(
            f"Invalid CSV format in file '{path.name}'."
        ) from exc

    if record_count == 0:
        raise EmptyCSVError(
            f"CSV file contains no usable data rows: {path.name}"
        )


# ============================================================
# CONVENIENCE LOADER
# ============================================================


def load_csv(
    file_path: str | Path,
    *,
    source_dataset: Optional[str] = None,
    source_url: Optional[str] = None,
    encoding: str = "utf-8-sig",
) -> list[RawRecord]:
    """
    Load an entire CSV file into memory.

    This is a convenience wrapper around load_csv_records().

    For very large CSV datasets, pipeline.py should prefer
    load_csv_records() so records can be processed incrementally
    instead of loading the entire dataset into memory.
    """

    return list(
        load_csv_records(
            file_path=file_path,
            source_dataset=source_dataset,
            source_url=source_url,
            encoding=encoding,
        )
    )

# ============================================================
# CSV LOADER CLASS
# ============================================================


class CSVLoader:
    """
    CSV loader for the MedDecode medicine dataset ingestion pipeline.

    This pipeline accepts CSV files only.

    Responsibilities:
    - Open CSV files
    - Read rows safely
    - Preserve original column names
    - Convert each row into a RawRecord
    - Attach source metadata
    """

    def load(
        self,
        file_path: str,
        source_dataset: str,
    ) -> list[RawRecord]:
        """
        Load a CSV file and convert its rows into RawRecord objects.

        Parameters
        ----------
        file_path:
            Path to the CSV file.

        source_dataset:
            Logical name of the dataset being ingested.

        Returns
        -------
        list[RawRecord]
            Loaded raw records.
        """

        return load_csv(
            file_path=file_path,
            source_dataset=source_dataset,
        )