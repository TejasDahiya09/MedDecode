from dataclasses import dataclass, field
from typing import List


@dataclass
class OCRBlock:
    """
    A single text region detected on a document page.
    """

    text: str
    confidence: float
    bounding_box: list[list[float]]


@dataclass(frozen=True)
class UnverifiedNumberedRow:
    """A numbered visual row retained for review, not a confirmed medicine."""

    candidate_sequence_number: int
    observed_number: int | None
    raw_text: str
    page_number: int
    confidence: float
    bounding_box: list[list[float]]
    evidence: tuple[OCRBlock, ...]
    medicine_name_verified: bool = False
    strength_verified: bool = False
    frequency_verified: bool = False
    duration_verified: bool = False
    official_catalogue_match_status: str = "not_attempted"


@dataclass
class OCRPageResult:
    """
    OCR result for one document page.
    """

    full_text: str
    blocks: list[OCRBlock]
    unverified_numbered_rows: list[UnverifiedNumberedRow] = field(default_factory=list)
    processing_warnings: list[str] = field(default_factory=list)