from PIL import Image
import fitz

from app.layer1_document_processing.pipeline import (
    process_document,
)
from unittest.mock import Mock

from app.schemas.ocr import OCRPageResult


def create_test_pdf(
    file_path,
    page_count=1,
):
    """
    Create a simple PDF for testing.
    """

    document = fitz.open()

    for page_number in range(page_count):

        page = document.new_page()

        page.insert_text(
            (72, 72),
            f"Prescription Page {page_number + 1}",
        )

    document.save(
        file_path
    )

    document.close()


def test_pipeline_processes_image(
    tmp_path,
):
    image_path = (
        tmp_path / "prescription.png"
    )

    image = Image.new(
        "RGBA",
        (500, 300),
        (255, 255, 255, 255),
    )

    image.save(
        image_path
    )

    result = process_document(
        str(image_path)
    )

    assert len(result) == 1
    assert result[0].mode == "RGB"
    assert result[0].size == (
        500,
        300,
    )


def test_pipeline_processes_single_page_pdf(
    tmp_path,
):
    pdf_path = (
        tmp_path / "prescription.pdf"
    )

    create_test_pdf(
        pdf_path,
        page_count=1,
    )

    result = process_document(
        str(pdf_path)
    )

    assert len(result) == 1
    assert result[0].mode == "RGB"


def test_pipeline_processes_multiple_page_pdf(
    tmp_path,
):
    pdf_path = (
        tmp_path / "multiple_pages.pdf"
    )

    create_test_pdf(
        pdf_path,
        page_count=3,
    )

    result = process_document(
        str(pdf_path)
    )

    assert len(result) == 3

    for image in result:
        assert image.mode == "RGB"

def test_pipeline_processes_image_with_ocr(
    tmp_path,
):
    image_path = (
        tmp_path / "prescription.png"
    )

    image = Image.new(
        "RGB",
        (500, 300),
        "white",
    )

    image.save(
        image_path
    )

    mock_engine = Mock()

    expected_result = OCRPageResult(
        full_text="Paracetamol 500 mg",
        blocks=[],
    )

    mock_engine.process_page.return_value = (
        expected_result
    )

    from app.layer1_document_processing.pipeline import (
        process_document_with_ocr,
    )

    result = process_document_with_ocr(
        str(image_path),
        ocr_engine=mock_engine,
    )

    assert len(result) == 1

    assert result[0].full_text == (
        "Paracetamol 500 mg"
    )

    mock_engine.process_page.assert_called_once()


def test_pipeline_processes_all_pdf_pages_with_ocr(
    tmp_path,
):
    pdf_path = (
        tmp_path / "prescription.pdf"
    )

    create_test_pdf(
        pdf_path,
        page_count=3,
    )

    mock_engine = Mock()

    mock_engine.process_page.return_value = (
        OCRPageResult(
            full_text="Test prescription",
            blocks=[],
        )
    )

    from app.layer1_document_processing.pipeline import (
        process_document_with_ocr,
    )

    result = process_document_with_ocr(
        str(pdf_path),
        ocr_engine=mock_engine,
    )

    assert len(result) == 3

    assert (
        mock_engine.process_page.call_count
        == 3
    )