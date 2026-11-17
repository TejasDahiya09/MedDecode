from __future__ import annotations

import warnings

import fitz
import pytest
from PIL import Image

from app.integration.document_safety import DocumentSafetyError, DocumentSafetyLimits, validate_staged_document


def limits(**changes):
    values = DocumentSafetyLimits().__dict__ | changes
    return DocumentSafetyLimits(**values)


def pdf(path, pages=1, width=612, height=792):
    document = fitz.open()
    for _ in range(pages):
        document.new_page(width=width, height=height)
    document.save(path)
    document.close()


def test_valid_pdf_and_exact_page_boundary(tmp_path):
    path = tmp_path / "valid.pdf"
    pdf(path, pages=2)
    result = validate_staged_document(path, "application/pdf", limits(max_pdf_pages=2))
    assert result["page_count"] == 2
    assert result["aggregate_rendered_pixels"] > 0


def test_pdf_page_and_rendered_pixel_limits(tmp_path):
    path = tmp_path / "pages.pdf"
    pdf(path, pages=2)
    with pytest.raises(DocumentSafetyError, match="too many pages") as raised:
        validate_staged_document(path, "application/pdf", limits(max_pdf_pages=1))
    assert raised.value.code == "PDF_PAGE_LIMIT"
    huge = tmp_path / "huge.pdf"
    pdf(huge, width=10_000, height=10_000)
    with pytest.raises(DocumentSafetyError) as raised:
        validate_staged_document(huge, "application/pdf", limits(max_rendered_pixels_per_page=1_000_000))
    assert raised.value.code == "RENDERED_PIXEL_LIMIT"


def test_pdf_aggregate_limit_and_corruption(tmp_path):
    path = tmp_path / "aggregate.pdf"
    pdf(path, pages=2)
    with pytest.raises(DocumentSafetyError) as raised:
        validate_staged_document(path, "application/pdf", limits(max_aggregate_rendered_pixels=1_000_000))
    assert raised.value.code == "AGGREGATE_PIXEL_LIMIT"
    broken = tmp_path / "broken.pdf"
    broken.write_bytes(b"%PDF-not-a-document")
    with pytest.raises(DocumentSafetyError) as raised:
        validate_staged_document(broken, "application/pdf", limits())
    assert raised.value.code == "MALFORMED_DOCUMENT"


@pytest.mark.parametrize("file_type,image_format,suffix", [("image/png", "PNG", ".png"), ("image/jpeg", "JPEG", ".jpg")])
def test_valid_images_and_dimension_limit(tmp_path, file_type, image_format, suffix):
    path = tmp_path / ("image" + suffix)
    Image.new("RGB", (64, 32), "white").save(path, image_format)
    assert validate_staged_document(path, file_type, limits())["page_count"] == 1
    with pytest.raises(DocumentSafetyError) as raised:
        validate_staged_document(path, file_type, limits(max_image_width=32))
    assert raised.value.code == "IMAGE_DIMENSION_LIMIT"


def test_image_decompression_bomb_is_rejected(tmp_path, monkeypatch):
    path = tmp_path / "bomb.png"
    Image.new("RGB", (128, 128), "white").save(path, "PNG")
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)
    with warnings.catch_warnings():
        warnings.simplefilter("always")
        with pytest.raises(DocumentSafetyError) as raised:
            validate_staged_document(path, "image/png", limits())
    assert raised.value.code == "DECOMPRESSION_BOMB"


def test_file_byte_boundary_and_signature_mismatch(tmp_path):
    path = tmp_path / "image.png"
    Image.new("RGB", (2, 2), "white").save(path, "PNG")
    exact = path.stat().st_size
    assert validate_staged_document(path, "image/png", limits(max_document_bytes=exact))
    with pytest.raises(DocumentSafetyError) as raised:
        validate_staged_document(path, "image/png", limits(max_document_bytes=exact - 1))
    assert raised.value.code == "DOCUMENT_SIZE_LIMIT"
    with pytest.raises(DocumentSafetyError) as raised:
        validate_staged_document(path, "image/jpeg", limits())
    assert raised.value.code == "TYPE_MISMATCH"
