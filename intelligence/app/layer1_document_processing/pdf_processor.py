from pathlib import Path

import fitz
from PIL import Image


DEFAULT_DPI = 300


def load_pdf_as_images(
    file_path: str,
    dpi: int = DEFAULT_DPI,
) -> list[Image.Image]:
    """
    Load a PDF and convert each page into a standardized RGB image.

    Args:
        file_path:
            Path to the PDF file.

        dpi:
            Resolution used when rendering PDF pages.

    Returns:
        A list containing one Pillow Image object per PDF page.
    """

    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(
            f"PDF file not found: {file_path}"
        )

    try:
        images = []

        zoom = dpi / 72
        matrix = fitz.Matrix(
            zoom,
            zoom,
        )

        with fitz.open(path) as pdf_document:

            for page in pdf_document:
                pixmap = page.get_pixmap(
                    matrix=matrix,
                    alpha=False,
                )

                image = Image.frombytes(
                    "RGB",
                    (
                        pixmap.width,
                        pixmap.height,
                    ),
                    pixmap.samples,
                )

                images.append(image)

        return images

    except Exception as error:
        raise ValueError(
            f"Unable to process PDF file: {file_path}"
        ) from error