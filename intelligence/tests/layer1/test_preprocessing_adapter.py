from __future__ import annotations

from io import BytesIO
from unittest.mock import Mock

import fitz
import pytest
from PIL import Image, ImageDraw

from app.integration.document_safety import (
    DocumentSafetyError,
    DocumentSafetyLimits,
)
from app.layer1_document_processing.pipeline import (
    process_document_with_preprocessing,
)
from app.schemas.ocr import OCRPageResult


def _mock_engine():
    engine = Mock()
    engine.process_page.return_value = OCRPageResult(
        full_text="Fictional OCR fallback",
        blocks=[],
    )
    return engine


def _scanned_page_image() -> bytes:
    image = Image.new("RGB", (600, 800), "white")
    draw = ImageDraw.Draw(image)
    draw.text((50, 80), "Tab FictionalMed 0.5 mg", fill=(0, 0, 0))
    draw.text((50, 120), "1-0-1 after food x 5 days", fill=(0, 0, 0))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _make_mixed_pdf(path):
    document = fitz.open()
    native_page = document.new_page()
    native_page.insert_text((60, 70), "Tab FictionalMed 0.5 mg")
    native_page.insert_text((60, 95), "1-0-1 after food for 5 days")

    scanned_page = document.new_page()
    scanned_page.insert_image(scanned_page.rect, stream=_scanned_page_image())
    document.new_page()

    document.save(path)
    document.close()


def test_mixed_multipage_pdf_routes_by_page_and_preserves_page_boundaries(tmp_path):
    path = tmp_path / "mixed.pdf"
    _make_mixed_pdf(path)
    engine = _mock_engine()

    result = process_document_with_preprocessing(
        path,
        ocr_engine=engine,
        pdf_dpi=72,
    )

    assert [page.page_number for page in result.pages] == [1, 2, 3]
    assert [page.route for page in result.pages] == [
        "native_pdf_text",
        "raster_ocr",
        "blank",
    ]
    assert "0.5 mg" in result.pages[0].result.full_text
    assert "1-0-1" in result.pages[0].result.full_text
    assert result.pages[0].result.blocks[0].bounding_box
    assert result.pages[0].result.blocks[0].confidence == 0.0
    assert result.pages[1].result.full_text == "Fictional OCR fallback"
    assert result.pages[1].original_image_preserved is True
    assert "no_native_text_layer_detected" in result.pages[1].native_text_evidence["warnings"]
    assert result.pages[2].result.full_text == ""
    assert "blank" in result.pages[2].route
    assert engine.process_page.call_count == 1


@pytest.mark.parametrize("extension, image_format", [(".png", "PNG"), (".jpg", "JPEG")])
def test_raster_photo_formats_use_preprocessing_and_existing_ocr(
    tmp_path,
    extension,
    image_format,
):
    path = tmp_path / f"photo{extension}"
    image = Image.new("RGB", (700, 500), (248, 248, 248))
    ImageDraw.Draw(image).text((40, 60), "Tab FictionalMed 500 mcg", fill=(35, 35, 35))
    image.save(path, format=image_format)
    engine = _mock_engine()

    result = process_document_with_preprocessing(path, ocr_engine=engine)

    assert result.source_type == "image"
    assert result.pages[0].route == "raster_ocr"
    assert result.pages[0].quality is not None
    assert result.pages[0].original_image_preserved is True
    engine.process_page.assert_called_once()


def test_jpeg_exif_rotation_is_normalized_before_existing_ocr(tmp_path):
    path = tmp_path / "rotated.jpg"
    image = Image.new("RGB", (700, 500), "white")
    exif = Image.Exif()
    exif[274] = 6
    image.save(path, format="JPEG", exif=exif)
    engine = _mock_engine()

    process_document_with_preprocessing(path, ocr_engine=engine)

    assert engine.process_page.call_args.args[0].size == (500, 700)


def test_invalid_and_oversized_images_are_rejected_before_ocr(tmp_path):
    invalid = tmp_path / "invalid.png"
    invalid.write_bytes(b"not an image")
    with pytest.raises(DocumentSafetyError, match="signature"):
        process_document_with_preprocessing(invalid, ocr_engine=_mock_engine())

    oversized = tmp_path / "oversized.png"
    Image.new("RGB", (700, 500), "white").save(oversized)
    engine = _mock_engine()
    limits = DocumentSafetyLimits(max_image_width=650)
    with pytest.raises(DocumentSafetyError, match="dimension"):
        process_document_with_preprocessing(
            oversized,
            ocr_engine=engine,
            safety_limits=limits,
        )
    engine.process_page.assert_not_called()


def test_invalid_pdf_is_rejected_before_page_processing(tmp_path):
    invalid = tmp_path / "invalid.pdf"
    invalid.write_bytes(b"%PDF- but malformed")
    engine = _mock_engine()

    with pytest.raises(DocumentSafetyError):
        process_document_with_preprocessing(invalid, ocr_engine=engine)

    engine.process_page.assert_not_called()


def test_native_extraction_is_bounded_and_keeps_source_numeric_text(tmp_path):
    path = tmp_path / "numbers.pdf"
    document = fitz.open()
    page = document.new_page()
    page.insert_text((50, 60), "0.5 mg versus 5 mg; 500 mg versus 500 mcg")
    page.insert_text((50, 90), "1-0-1 versus 1-1-1")
    document.save(path)
    document.close()

    result = process_document_with_preprocessing(path, pdf_dpi=72)
    text = result.pages[0].native_text_evidence["text"]

    assert result.pages[0].route == "native_pdf_text"
    assert "0.5 mg" in text
    assert "500 mcg" in text
    assert "1-0-1" in text
    assert "1-1-1" in text


def test_two_page_searchable_pdf_keeps_independent_native_pages(tmp_path):
    path = tmp_path / "two_searchable_pages.pdf"
    document = fitz.open()
    for page_number in range(2):
        page = document.new_page()
        page.insert_text((50, 60), f"Tab FictionalMed {page_number + 1} 500 mg")
        page.insert_text((50, 90), "1-0-1 after food for 5 days")
    document.save(path)
    document.close()

    engine = _mock_engine()
    result = process_document_with_preprocessing(path, ocr_engine=engine)

    assert [page.route for page in result.pages] == [
        "native_pdf_text",
        "native_pdf_text",
    ]
    assert "FictionalMed 1" in result.pages[0].result.full_text
    assert "FictionalMed 2" in result.pages[1].result.full_text
    assert engine.process_page.call_count == 0


def test_two_page_scanned_pdf_uses_existing_ocr_for_each_page(tmp_path):
    path = tmp_path / "two_scanned_pages.pdf"
    document = fitz.open()
    for _ in range(2):
        page = document.new_page()
        page.insert_image(page.rect, stream=_scanned_page_image())
    document.save(path)
    document.close()
    engine = _mock_engine()

    result = process_document_with_preprocessing(
        path,
        ocr_engine=engine,
        pdf_dpi=72,
    )

    assert [page.page_number for page in result.pages] == [1, 2]
    assert [page.route for page in result.pages] == ["raster_ocr", "raster_ocr"]
    assert engine.process_page.call_count == 2


def test_pdf_page_and_word_evidence_is_bounded(tmp_path):
    path = tmp_path / "bounded.pdf"
    document = fitz.open()
    page = document.new_page()
    page.insert_text((50, 60), "Tab FictionalMed 500 mg 1-0-1")
    document.save(path)
    document.close()

    from app.layer1_document_processing.pdf_text_extractor import (
        extract_searchable_pdf_text,
    )

    evidence = extract_searchable_pdf_text(
        path,
        max_pages=1,
        max_chars_per_page=12,
        max_words_per_page=2,
    )
    assert evidence["processed_page_count"] == 1
    assert len(evidence["pages"][0]["text"]) == 12
    assert len(evidence["pages"][0]["words"]) == 2
    assert "text_layer_truncated" in evidence["pages"][0]["warnings"]
    assert "word_list_truncated" in evidence["pages"][0]["warnings"]
