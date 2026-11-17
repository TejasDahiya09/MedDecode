"""Cheap, deterministic document checks performed before OCR or rendering."""
from __future__ import annotations

import math
import os
import warnings
from dataclasses import dataclass
from pathlib import Path

import fitz
from PIL import Image


class DocumentSafetyError(ValueError):
    """A caller-safe rejection raised before expensive document processing."""

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.safe_message = message
        self.status_code = status_code


def _integer(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer") from error
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} is outside its permitted range")
    return value


def _seconds(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = os.environ.get(name, str(default)).strip()
    try:
        value = float(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} must be numeric") from error
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} is outside its permitted range")
    return value


@dataclass(frozen=True)
class DocumentSafetyLimits:
    max_document_bytes: int = 10 * 1024 * 1024
    max_pdf_pages: int = 10
    max_image_width: int = 10_000
    max_image_height: int = 10_000
    max_rendered_pixels_per_page: int = 25_000_000
    max_aggregate_rendered_pixels: int = 100_000_000
    transfer_timeout_seconds: float = 15.0
    processing_timeout_seconds: float = 120.0
    max_response_bytes: int = 1024 * 1024
    max_child_rss_bytes: int = 2 * 1024 * 1024 * 1024

    @classmethod
    def from_environment(cls) -> "DocumentSafetyLimits":
        return cls(
            max_document_bytes=_integer("MEDDECODE_INTELLIGENCE_MAX_DOCUMENT_BYTES", 10 * 1024 * 1024, 1024, 50 * 1024 * 1024),
            max_pdf_pages=_integer("MEDDECODE_INTELLIGENCE_MAX_PDF_PAGES", 10, 1, 100),
            max_image_width=_integer("MEDDECODE_INTELLIGENCE_MAX_IMAGE_WIDTH", 10_000, 256, 30_000),
            max_image_height=_integer("MEDDECODE_INTELLIGENCE_MAX_IMAGE_HEIGHT", 10_000, 256, 30_000),
            max_rendered_pixels_per_page=_integer("MEDDECODE_INTELLIGENCE_MAX_RENDERED_PIXELS_PER_PAGE", 25_000_000, 1_000_000, 250_000_000),
            max_aggregate_rendered_pixels=_integer("MEDDECODE_INTELLIGENCE_MAX_AGGREGATE_RENDERED_PIXELS", 100_000_000, 1_000_000, 1_000_000_000),
            transfer_timeout_seconds=_seconds("MEDDECODE_INTELLIGENCE_TRANSFER_TIMEOUT_SECONDS", 15.0, 1.0, 120.0),
            processing_timeout_seconds=_seconds("MEDDECODE_INTELLIGENCE_PROCESS_TIMEOUT_SECONDS", 120.0, 5.0, 900.0),
            max_response_bytes=_integer("MEDDECODE_INTELLIGENCE_MAX_RESPONSE_BYTES", 1024 * 1024, 4096, 10 * 1024 * 1024),
            max_child_rss_bytes=_integer("MEDDECODE_INTELLIGENCE_MAX_CHILD_RSS_BYTES", 2 * 1024 * 1024 * 1024, 256 * 1024 * 1024, 16 * 1024 * 1024 * 1024),
        )


def _pdf_geometry(path: Path, limits: DocumentSafetyLimits, render_dpi: int) -> dict[str, int]:
    try:
        document = fitz.open(path)
    except Exception as error:
        raise DocumentSafetyError("MALFORMED_DOCUMENT", "PDF document is malformed.") from error
    try:
        if document.needs_pass:
            raise DocumentSafetyError("ENCRYPTED_DOCUMENT", "Encrypted PDF documents are not supported.")
        page_count = document.page_count
        if page_count < 1:
            raise DocumentSafetyError("MALFORMED_DOCUMENT", "PDF document has no pages.")
        if page_count > limits.max_pdf_pages:
            raise DocumentSafetyError("PDF_PAGE_LIMIT", "PDF document has too many pages.", 413)
        aggregate = 0
        for index in range(page_count):
            try:
                rectangle = document.load_page(index).rect
            except Exception as error:
                raise DocumentSafetyError("MALFORMED_DOCUMENT", "PDF page geometry is invalid.") from error
            width = math.ceil(float(rectangle.width) * render_dpi / 72.0)
            height = math.ceil(float(rectangle.height) * render_dpi / 72.0)
            if width < 1 or height < 1:
                raise DocumentSafetyError("MALFORMED_DOCUMENT", "PDF page geometry is invalid.")
            pixels = width * height
            if pixels > limits.max_rendered_pixels_per_page:
                raise DocumentSafetyError("RENDERED_PIXEL_LIMIT", "PDF page would exceed the rendered-pixel limit.", 413)
            aggregate += pixels
            if aggregate > limits.max_aggregate_rendered_pixels:
                raise DocumentSafetyError("AGGREGATE_PIXEL_LIMIT", "PDF document would exceed the aggregate rendered-pixel limit.", 413)
        return {"page_count": page_count, "aggregate_rendered_pixels": aggregate}
    finally:
        document.close()


def _image_geometry(path: Path, expected_format: str, limits: DocumentSafetyLimits) -> dict[str, int]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                if image.format != expected_format:
                    raise DocumentSafetyError("TYPE_MISMATCH", "Document signature does not match its type.")
                width, height = image.size
                if width < 1 or height < 1:
                    raise DocumentSafetyError("MALFORMED_DOCUMENT", "Image dimensions are invalid.")
                if width > limits.max_image_width or height > limits.max_image_height:
                    raise DocumentSafetyError("IMAGE_DIMENSION_LIMIT", "Image dimensions exceed the configured limit.", 413)
                pixels = width * height
                if pixels > limits.max_rendered_pixels_per_page or pixels > limits.max_aggregate_rendered_pixels:
                    raise DocumentSafetyError("RENDERED_PIXEL_LIMIT", "Image exceeds the decoded-pixel limit.", 413)
                if getattr(image, "n_frames", 1) != 1:
                    raise DocumentSafetyError("MULTIFRAME_IMAGE", "Multi-frame images are not supported.")
                image.verify()
                return {"page_count": 1, "aggregate_rendered_pixels": pixels}
    except DocumentSafetyError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise DocumentSafetyError("DECOMPRESSION_BOMB", "Image exceeds the safe decoded-pixel limit.", 413) from error
    except Exception as error:
        raise DocumentSafetyError("MALFORMED_DOCUMENT", "Image document is malformed.") from error


def validate_staged_document(path: Path, file_type: str, limits: DocumentSafetyLimits, *, render_dpi: int = 120) -> dict[str, int]:
    """Validate bytes and decoded geometry without rendering document pages."""
    try:
        size = path.stat().st_size
    except OSError as error:
        raise DocumentSafetyError("DOCUMENT_UNAVAILABLE", "Document is unavailable.") from error
    if size < 1:
        raise DocumentSafetyError("EMPTY_DOCUMENT", "Document is empty.")
    if size > limits.max_document_bytes:
        raise DocumentSafetyError("DOCUMENT_SIZE_LIMIT", "Document is too large.", 413)
    signatures = {
        "application/pdf": b"%PDF-",
        "image/jpeg": b"\xff\xd8\xff",
        "image/png": b"\x89PNG\r\n\x1a\n",
    }
    signature = signatures.get(file_type)
    if signature is None:
        raise DocumentSafetyError("UNSUPPORTED_TYPE", "Document type is unsupported.", 415)
    try:
        with path.open("rb") as handle:
            prefix = handle.read(len(signature))
    except OSError as error:
        raise DocumentSafetyError("DOCUMENT_UNAVAILABLE", "Document is unavailable.") from error
    if prefix != signature:
        raise DocumentSafetyError("TYPE_MISMATCH", "Document signature does not match its type.")
    if file_type == "application/pdf":
        return _pdf_geometry(path, limits, render_dpi)
    return _image_geometry(path, "JPEG" if file_type == "image/jpeg" else "PNG", limits)


