"""Explicit local-only PDF-to-Contract-v1 integration path.

This module is intentionally separate from ``offline_pipeline_worker``.  The
existing worker continues to use deterministic synthetic OCR pages; this path
requires an explicitly supplied local PDF and, by default, invokes the real
Layer 1 PyMuPDF/PaddleOCR implementation.  It never downloads a document,
connects to a database, or falls back to synthetic OCR after a failure.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal, Protocol
from uuid import UUID

from app.integration.contract_v1_mapper import map_contract_v1
from app.integration.offline_pipeline import InMemoryMedicineRepository, run_offline_pipeline
from app.layer1_document_processing.hybrid_ocr import HybridOCREngine, HybridOCRPageResult
from app.layer1_document_processing.pipeline import process_document
from app.layer1_document_processing.pipeline import process_document_with_ocr
from app.layer4_medicine_intelligence.runtime.schemas import CandidateIngredient, MedicineCandidate
from app.schemas.ocr import OCRPageResult


class LocalPdfProcessingError(ValueError):
    """A safe local-development error that intentionally omits document data."""


class LocalOcrEngine(Protocol):
    """The injectable subset of the existing Layer 1 OCR engine."""

    def process_page(self, image: object) -> OCRPageResult: ...


class FictionalMedicineRepository(InMemoryMedicineRepository):
    """A tiny injected catalogue used only by the local PDF demonstration.

    It deliberately contains fictional names and identifiers.  It has no
    database client, network behavior, clinical assertions, or real medicine
    reference data.
    """

    def __init__(self) -> None:
        ingredient = CandidateIngredient(
            ingredient_id=UUID("30000000-0000-4000-8000-000000000001"),
            ingredient_name="Examplemed ingredient",
            normalized_name="examplemed ingredient",
            strength_value=10,
            strength_unit="mg",
        )
        self.primary = MedicineCandidate(
            medicine_id=UUID("30000000-0000-4000-8000-000000000002"),
            canonical_name="Examplemed 10 mg",
            normalized_name="examplemed",
            brand_name="Examplemed",
            generic_name="Examplemed",
            dosage_form="tablet",
            strength_value=10,
            strength_unit="mg",
            medicine_type="fictional_test_only",
            prescription_required=None,
            ingredients=[ingredient],
        )
        self.alternative = MedicineCandidate(
            medicine_id=UUID("30000000-0000-4000-8000-000000000003"),
            canonical_name="Examplemed Alternative 10 mg",
            normalized_name="examplemed alternative",
            brand_name="Examplemed Alternative",
            generic_name="Examplemed Alternative",
            dosage_form="tablet",
            strength_value=10,
            strength_unit="mg",
            medicine_type="fictional_test_only",
            prescription_required=None,
            ingredients=[ingredient],
        )

    def _exact(self, value: str) -> list[MedicineCandidate]:
        return [self.primary] if value.strip().casefold() == "examplemed" else []


def _validate_local_pdf_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    if path.suffix.casefold() != ".pdf" or not path.is_file():
        raise LocalPdfProcessingError("A readable local PDF file is required.")

    try:
        with path.open("rb") as source:
            if source.read(5) != b"%PDF-":
                raise LocalPdfProcessingError("The supplied file is not a valid PDF.")
    except OSError as error:
        raise LocalPdfProcessingError("A readable local PDF file is required.") from error

    return path.resolve()


def process_local_pdf_to_contract_v1(
    *,
    pdf_path: str | Path,
    job_id: str,
    prescription_id: str,
    repository: InMemoryMedicineRepository | None = None,
    ocr_engine: LocalOcrEngine | None = None,
    source_mode: Literal["local_pdf", "local_pdf_injected_fixture"] = "local_pdf",
) -> dict[str, object]:
    """Run a supplied local PDF through Layers 1-5 and emit Contract v1 JSON.

    The default engine is the existing PyMuPDF/PaddleOCR adapter. Tests may
    inject a deterministic engine while retaining real PDF rendering, but no error path invokes
    ``synthetic_ocr_pages``. The PDF path is never placed in the result.
    """
    path = _validate_local_pdf_path(pdf_path)
    try:
        UUID(job_id)
        UUID(prescription_id)
    except (TypeError, ValueError) as error:
        raise LocalPdfProcessingError("job_id and prescription_id must be UUIDs.") from error

    try:
        pages = process_document_with_ocr(str(path), ocr_engine=ocr_engine)  # type: ignore[arg-type]
    except Exception as error:
        raise LocalPdfProcessingError("Local PDF OCR processing failed.") from error

    if not isinstance(pages, list) or not pages or not all(isinstance(page, OCRPageResult) for page in pages):
        raise LocalPdfProcessingError("Local PDF OCR returned no valid page results.")

    result = run_offline_pipeline(pages, repository or FictionalMedicineRepository())
    # The mapper needs only correlation identifiers. A local file path is never
    # represented as a Contract v1 document URL or included in output JSON.
    return map_contract_v1(
        {"job_id": job_id, "prescription_id": prescription_id},
        result,
        source_mode=source_mode,
    )


def process_local_pdf_with_hybrid_ocr_to_contract_v1(
    *,
    pdf_path: str | Path,
    job_id: str,
    prescription_id: str,
    hybrid_ocr: HybridOCREngine,
    render_dpi: int = 300,
    repository: InMemoryMedicineRepository | None = None,
) -> tuple[dict[str, object], tuple[HybridOCRPageResult, ...]]:
    """Render once, run hybrid OCR, and return Contract JSON plus raw evidence."""
    path = _validate_local_pdf_path(pdf_path)
    try:
        UUID(job_id)
        UUID(prescription_id)
    except (TypeError, ValueError) as error:
        raise LocalPdfProcessingError("job_id and prescription_id must be UUIDs.") from error
    try:
        images = process_document(str(path), pdf_dpi=render_dpi)
        hybrid_pages = tuple(hybrid_ocr.recognize_page(image, index + 1) for index, image in enumerate(images))
    except Exception as error:
        raise LocalPdfProcessingError("Local PDF hybrid OCR processing failed.") from error
    pages = [page.to_ocr_page_result() for page in hybrid_pages]
    result = run_offline_pipeline(pages, repository or FictionalMedicineRepository())
    return (
        map_contract_v1(
            {"job_id": job_id, "prescription_id": prescription_id},
            result,
            source_mode="local_pdf",
        ),
        hybrid_pages,
    )
