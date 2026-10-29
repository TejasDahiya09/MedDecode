from pathlib import Path


SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
SUPPORTED_PDF_EXTENSION = ".pdf"


def get_document_type(file_path: str) -> str:
    """
    Identify whether the given file is an image or a PDF.

    Returns:
        "image" for JPG, JPEG, PNG files
        "pdf" for PDF files

    Raises:
        ValueError if the file type is not supported.
    """

    extension = Path(file_path).suffix.lower()

    if extension in SUPPORTED_IMAGE_EXTENSIONS:
        return "image"

    if extension == SUPPORTED_PDF_EXTENSION:
        return "pdf"

    raise ValueError(
        f"Unsupported file type: {extension}. "
        "Supported formats are JPG, JPEG, PNG, and PDF."
    )