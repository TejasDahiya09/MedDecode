from __future__ import annotations

from typing import TYPE_CHECKING

from PIL import Image

from app.layer1_document_processing.document_loader import (
    get_document_type,
)
from app.layer1_document_processing.image_processor import (
    load_and_normalize_image,
)
from app.layer1_document_processing.pdf_processor import (
    DEFAULT_DPI,
    load_pdf_as_images,
)
from app.schemas.ocr import OCRPageResult

if TYPE_CHECKING:
    from app.layer1_document_processing.ocr_engine import OCREngine


def process_document(
    file_path: str,
    pdf_dpi: int = DEFAULT_DPI,
) -> list[Image.Image]:
    """
    Process a supported prescription document and convert it
    into standardized RGB Pillow images.

    Supported input formats:
    - JPG
    - JPEG
    - PNG
    - PDF

    PDF pages use ``pdf_dpi`` for rendering; image inputs are unaffected.

    Returns:
        A list of standardized RGB Pillow Image objects.

        Image input:
            Returns a list containing one image.

        PDF input:
            Returns one image for each PDF page.
    """

    document_type = get_document_type(
        file_path
    )

    if document_type == "image":

        image = load_and_normalize_image(
            file_path
        )

        return [image]

    if document_type == "pdf":

        return load_pdf_as_images(
            file_path,
            dpi=pdf_dpi,
        )

    # Defensive fallback.
    # get_document_type() should already prevent this.
    raise ValueError(
        f"Unsupported document type: {document_type}"
    )

def process_document_with_ocr(
    file_path: str,
    ocr_engine: OCREngine | None = None,
) -> list[OCRPageResult]:
    """
    Process a prescription document and perform OCR on every page.

    Args:
        file_path:
            Path to the prescription image or PDF.

        ocr_engine:
            Optional OCR engine instance. Supplying an engine allows
            the caller to reuse an already initialized OCR model.

    Returns:
        A list containing one OCRPageResult per document page.
    """

    pages = process_document(
        file_path
    )

    if ocr_engine is None:
        from app.layer1_document_processing.ocr_engine import OCREngine

        ocr_engine = OCREngine()

    results = []

    for page in pages:
        page_result = ocr_engine.process_page(
            page
        )

        results.append(
            page_result
        )

    return results