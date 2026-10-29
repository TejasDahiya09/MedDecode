import pytest

from app.layer1_document_processing.document_loader import get_document_type


def test_jpg_is_image():
    assert get_document_type("prescription.jpg") == "image"


def test_jpeg_is_image():
    assert get_document_type("prescription.jpeg") == "image"


def test_png_is_image():
    assert get_document_type("prescription.png") == "image"


def test_pdf_is_pdf():
    assert get_document_type("prescription.pdf") == "pdf"


def test_unsupported_file_raises_error():
    with pytest.raises(ValueError):
        get_document_type("prescription.docx")