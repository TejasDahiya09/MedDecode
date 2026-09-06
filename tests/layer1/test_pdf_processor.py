import pytest
import fitz

from app.layer1_document_processing.pdf_processor import (
    load_pdf_as_images,
)


def create_test_pdf(file_path, page_count=1):
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

    document.save(file_path)
    document.close()


def test_pdf_is_converted_to_images(tmp_path):
    pdf_path = tmp_path / "prescription.pdf"

    create_test_pdf(
        pdf_path,
        page_count=1,
    )

    images = load_pdf_as_images(
        str(pdf_path)
    )

    assert len(images) == 1
    assert images[0].mode == "RGB"


def test_multiple_pdf_pages_are_converted(tmp_path):
    pdf_path = tmp_path / "multiple_pages.pdf"

    create_test_pdf(
        pdf_path,
        page_count=3,
    )

    images = load_pdf_as_images(
        str(pdf_path)
    )

    assert len(images) == 3

    for image in images:
        assert image.mode == "RGB"


def test_missing_pdf_raises_file_not_found_error():
    with pytest.raises(FileNotFoundError):
        load_pdf_as_images(
            "this_pdf_does_not_exist.pdf"
        )


def test_invalid_pdf_raises_value_error(tmp_path):
    invalid_pdf = tmp_path / "invalid.pdf"

    invalid_pdf.write_text(
        "This is not actually a PDF."
    )

    with pytest.raises(ValueError):
        load_pdf_as_images(
            str(invalid_pdf)
        )