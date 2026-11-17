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
import warnings
from PIL import Image, ImageOps

from app.integration.contract_v1_mapper import map_contract_v1
from app.integration.offline_pipeline import InMemoryMedicineRepository, run_offline_pipeline
from app.layer1_document_processing.hybrid_ocr import HybridOCREngine, HybridOCRPageResult
from app.layer1_document_processing.pipeline import process_document
from app.layer1_document_processing.pipeline import process_document_with_ocr
from app.layer1_document_processing.pipeline import process_document_with_preprocessing
from app.layer4_medicine_intelligence.runtime.schemas import CandidateIngredient, MedicineCandidate
from app.schemas.ocr import OCRPageResult

MAX_OCR_INPUT_PIXELS = 1_000_000


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


def _bound_ocr_image(image: Image.Image, max_pixels: int = MAX_OCR_INPUT_PIXELS) -> Image.Image:
    """Bound native OCR memory without changing the staged source document."""
    if max_pixels < 1:
        raise ValueError("OCR pixel limit must be positive.")
    pixels = image.width * image.height
    if pixels <= max_pixels:
        return image.convert("RGB")
    scale = (max_pixels / pixels) ** 0.5
    width = max(1, int(image.width * scale))
    height = max(1, int(image.height * scale))
    return image.convert("RGB").resize((width, height), Image.Resampling.LANCZOS)


def _load_validated_document(value: str | Path, file_type: str, render_dpi: int) -> list[Image.Image]:
    """Decode bounded, signature-checked document bytes without a fallback."""
    path = Path(value).expanduser()
    try:
        if not path.is_file() or path.stat().st_size <= 0 or path.stat().st_size > 10 * 1024 * 1024:
            raise LocalPdfProcessingError("Document size is invalid.")
        if file_type == "application/pdf":
            return [
                _bound_ocr_image(image)
                for image in process_document(str(_validate_local_pdf_path(path)), pdf_dpi=render_dpi)
            ]
        expected = {"image/jpeg": ("JPEG", {".jpg", ".jpeg"}), "image/png": ("PNG", {".png"})}.get(file_type)
        if expected is None or path.suffix.casefold() not in expected[1]:
            raise LocalPdfProcessingError("Document type is invalid.")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                if image.format != expected[0] or getattr(image, "n_frames", 1) != 1:
                    raise LocalPdfProcessingError("Image format is invalid.")
                width, height = image.size
                if width < 1 or height < 1 or width > 10000 or height > 10000 or width * height > 25_000_000:
                    raise LocalPdfProcessingError("Image dimensions are invalid.")
                image.verify()
            with Image.open(path) as image:
                image.load()
                oriented = ImageOps.exif_transpose(image)
                if oriented.mode in ("RGBA", "LA") or "transparency" in oriented.info:
                    rgba = oriented.convert("RGBA")
                    background = Image.new("RGBA", rgba.size, "white")
                    background.alpha_composite(rgba)
                    return [_bound_ocr_image(background.convert("RGB"))]
                return [_bound_ocr_image(oriented.convert("RGB"))]
    except LocalPdfProcessingError:
        raise
    except Exception as error:
        raise LocalPdfProcessingError("Document could not be decoded safely.") from error


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
    if not any(block.text.strip() for page in pages for block in page.blocks):
        raise LocalPdfProcessingError("Local PDF OCR returned no usable OCR text.")

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
    source_mode: Literal["local_pdf", "local_pdf_official_catalogue"] = "local_pdf",
    file_type: str = "application/pdf",
    use_preprocessing: bool = False,
) -> tuple[dict[str, object], tuple[HybridOCRPageResult, ...]]:
    """Render once, run hybrid OCR, and return Contract JSON plus raw evidence."""
    try:
        UUID(job_id)
        UUID(prescription_id)
    except (TypeError, ValueError) as error:
        raise LocalPdfProcessingError("job_id and prescription_id must be UUIDs.") from error
    try:
        if use_preprocessing:
            class _HybridPageAdapter:
                def __init__(self) -> None:
                    self.pages: list[HybridOCRPageResult] = []

                def process_page(self, image: Image.Image) -> OCRPageResult:
                    page = hybrid_ocr.recognize_page(image, len(self.pages) + 1)
                    self.pages.append(page)
                    return page.to_ocr_page_result()

            adapter = _HybridPageAdapter()
            prepared = process_document_with_preprocessing(
                str(pdf_path), ocr_engine=adapter, pdf_dpi=render_dpi
            )
            pages = [page.result for page in prepared.pages]
            hybrid_pages = tuple(adapter.pages)
        else:
            images = _load_validated_document(pdf_path, file_type, render_dpi)
            hybrid_pages = tuple(hybrid_ocr.recognize_page(image, index + 1) for index, image in enumerate(images))
            pages = [page.to_ocr_page_result() for page in hybrid_pages]
    except Exception as error:
        raise LocalPdfProcessingError("Local PDF hybrid OCR processing failed.") from error
    if not any(block.text.strip() for page in pages for block in page.blocks):
        raise LocalPdfProcessingError("Local PDF hybrid OCR returned no usable OCR text.")
    result = run_offline_pipeline(pages, repository or FictionalMedicineRepository())
    return (
        map_contract_v1(
            {"job_id": job_id, "prescription_id": prescription_id},
            result,
            source_mode=source_mode,
        ),
        hybrid_pages,
    )
