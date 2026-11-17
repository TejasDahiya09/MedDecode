from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol

import fitz
import numpy as np
from PIL import Image, ImageOps

from app.integration.document_safety import (
    DocumentSafetyLimits,
    validate_staged_document,
)
from app.layer1_document_processing.document_loader import get_document_type
from app.layer1_document_processing.document_preprocessing import (
    DocumentQualityMetrics,
    PreprocessingResult,
    apply_safe_image_preprocessing,
)
from app.layer1_document_processing.image_processor import load_and_normalize_image
from app.layer1_document_processing.pdf_text_extractor import (
    extract_searchable_pdf_text,
)
from app.schemas.ocr import OCRBlock, OCRPageResult


class OCRPageProcessor(Protocol):
    def process_page(self, image: Image.Image) -> OCRPageResult: ...


@dataclass
class PreprocessedOCRPage:
    page_number: int
    result: OCRPageResult
    route: Literal["native_pdf_text", "raster_ocr", "blank"]
    quality: DocumentQualityMetrics | None = None
    native_text_evidence: dict[str, object] | None = None
    applied_steps: tuple[str, ...] = ()
    original_image_preserved: bool = True
    warnings: list[str] = field(default_factory=list)


@dataclass
class PreprocessedOCRDocument:
    source_type: Literal["image", "pdf"]
    pages: list[PreprocessedOCRPage]
    warnings: list[str] = field(default_factory=list)


def process_document_with_preprocessing(
    file_path: str | Path,
    ocr_engine: OCRPageProcessor | None = None,
    *,
    pdf_dpi: int = 120,
    safety_limits: DocumentSafetyLimits | None = None,
) -> PreprocessedOCRDocument:
    """Route each validated page through native PDF text or existing OCR.

    OCR-compatible ``OCRPageResult`` objects are returned for every page.
    Native text provenance and preprocessing details are additive metadata on
    ``PreprocessedOCRPage``; the established OCR schema is not changed.
    """

    path = Path(file_path)
    if pdf_dpi < 1:
        raise ValueError("pdf_dpi must be positive.")
    document_type = get_document_type(str(path))
    file_type = (
        "application/pdf"
        if document_type == "pdf"
        else "image/jpeg"
        if path.suffix.casefold() in {".jpg", ".jpeg"}
        else "image/png"
    )
    limits = safety_limits or DocumentSafetyLimits.from_environment()
    validate_staged_document(path, file_type, limits, render_dpi=pdf_dpi)

    engine = ocr_engine
    output: list[PreprocessedOCRPage] = []
    document_warnings: list[str] = []

    if document_type == "image":
        image = load_and_normalize_image(str(path))
        page = _process_raster_page(
            image,
            page_number=1,
            engine=engine,
            safety_limits=limits,
        )
        output.append(page)
        return PreprocessedOCRDocument("image", output, document_warnings)

    native_document = extract_searchable_pdf_text(
        path,
        max_pages=limits.max_pdf_pages,
    )
    with fitz.open(path) as pdf:
        for index in range(len(pdf)):
            page_number = index + 1
            native_page = native_document["pages"][index]
            if _native_text_is_usable(native_page):
                output.append(_native_pdf_page(native_page))
                continue

            page_image = _render_pdf_page(pdf[index], pdf_dpi)
            if _is_blank_page(page_image):
                warning = (
                    "PDF page has no usable native text and appears blank; "
                    "OCR was not run."
                )
                output.append(
                    PreprocessedOCRPage(
                        page_number=page_number,
                        result=OCRPageResult(
                            full_text="",
                            blocks=[],
                            processing_warnings=[warning],
                        ),
                        route="blank",
                        native_text_evidence=native_page,
                        warnings=[warning],
                    )
                )
                continue

            page = _process_raster_page(
                page_image,
                page_number=page_number,
                engine=engine,
                safety_limits=limits,
                native_text_evidence=native_page,
            )
            output.append(page)

    if any(page.route != "native_pdf_text" for page in output):
        document_warnings.append(
            "One or more PDF pages lacked a usable native text layer and used raster OCR or blank-page handling."
        )
    return PreprocessedOCRDocument("pdf", output, document_warnings)


def _native_text_is_usable(page: dict[str, object]) -> bool:
    if not page.get("searchable"):
        return False
    warnings = set(page.get("warnings", []))
    if warnings.intersection(
        {
            "suspiciously_short_text_layer",
            "possibly_incomplete_text_layer",
            "text_layer_truncated",
            "word_list_truncated",
            "suspicious_text_encoding",
        }
    ):
        return False
    text = str(page.get("text", "")).strip()
    words = page.get("words", [])
    return len(text) >= 20 and isinstance(words, list) and len(words) >= 3


def _native_pdf_page(page: dict[str, object]) -> PreprocessedOCRPage:
    blocks: list[OCRBlock] = []
    for word in page.get("words", []):
        if not isinstance(word, dict):
            continue
        text = str(word.get("text", "")).strip()
        box = word.get("bounding_box", [])
        if not text or not isinstance(box, list) or len(box) != 4:
            continue
        x0, y0, x1, y1 = (float(value) for value in box)
        blocks.append(
            OCRBlock(
                text=text,
                confidence=0.0,
                bounding_box=[[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
            )
        )
    text = str(page.get("text", ""))
    warning = (
        "Native PDF text was used; OCR confidence is unavailable and represented "
        "as 0.0 in the compatibility schema."
    )
    return PreprocessedOCRPage(
        page_number=int(page["page_number"]),
        result=OCRPageResult(
            full_text=text,
            blocks=blocks,
            processing_warnings=[warning],
        ),
        route="native_pdf_text",
        native_text_evidence=page,
        warnings=[warning],
    )


def _process_raster_page(
    original: Image.Image,
    *,
    page_number: int,
    engine: OCRPageProcessor | None,
    safety_limits: DocumentSafetyLimits,
    native_text_evidence: dict[str, object] | None = None,
) -> PreprocessedOCRPage:
    prepared = apply_safe_image_preprocessing(
        original,
        max_dimension=max(original.size),
    )
    selected_image, selected_steps, safety_warnings = _select_safe_candidate(
        original,
        prepared,
        safety_limits=safety_limits,
    )
    warnings = [*prepared.warnings, *safety_warnings]
    if native_text_evidence is not None:
        warnings.extend(native_text_evidence.get("warnings", []))

    if engine is None:
        from app.layer1_document_processing.ocr_engine import OCREngine

        engine = OCREngine()
    result = engine.process_page(selected_image)
    result.processing_warnings.extend(warnings)
    return PreprocessedOCRPage(
        page_number=page_number,
        result=result,
        route="raster_ocr",
        quality=prepared.quality,
        native_text_evidence=native_text_evidence,
        applied_steps=selected_steps,
        warnings=warnings,
    )


def _select_safe_candidate(
    original: Image.Image,
    prepared: PreprocessingResult,
    *,
    safety_limits: DocumentSafetyLimits,
) -> tuple[Image.Image, tuple[str, ...], list[str]]:
    candidate = prepared.image
    if candidate.size[0] > safety_limits.max_image_width or candidate.size[1] > safety_limits.max_image_height:
        return original, (), ["transformed_image_exceeded_dimension_limit"]
    pixels = candidate.width * candidate.height
    if pixels > safety_limits.max_rendered_pixels_per_page:
        return original, (), ["transformed_image_exceeded_pixel_limit"]
    if candidate.width * candidate.height > safety_limits.max_aggregate_rendered_pixels:
        return original, (), ["transformed_image_exceeded_aggregate_pixel_limit"]
    if "noise_reduction" in prepared.applied_steps:
        return original, (), ["noise_reduction_candidate_rejected_for_character_preservation"]

    source_gray = np.asarray(ImageOps.grayscale(original), dtype=np.uint8)
    candidate_gray = np.asarray(ImageOps.grayscale(candidate), dtype=np.uint8)
    if candidate_gray.shape != source_gray.shape:
        return original, (), ["geometry_changing_transform_rejected_for_ocr"]
    source_ink = source_gray < 245
    if np.any(source_ink & (candidate_gray >= 245)):
        return original, (), ["candidate_may_have_removed_strokes"]
    if np.any((source_gray <= 100) & (candidate_gray > 100)):
        return original, (), ["candidate_may_have_weakened_dark_strokes"]

    return candidate, tuple(prepared.applied_steps), []


def _render_pdf_page(page: fitz.Page, dpi: int) -> Image.Image:
    pixmap = page.get_pixmap(matrix=fitz.Matrix(dpi / 72.0, dpi / 72.0), alpha=False)
    if pixmap.width * pixmap.height > 100_000_000:
        raise ValueError("Rendered PDF page exceeds the configured pixel ceiling.")
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def _is_blank_page(image: Image.Image) -> bool:
    gray = np.asarray(ImageOps.grayscale(image), dtype=np.uint8)
    return float(gray.std()) < 1.5 and float(np.mean(gray < 245)) < 0.001
