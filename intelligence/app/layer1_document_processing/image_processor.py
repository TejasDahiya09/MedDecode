from pathlib import Path

from PIL import Image, ImageOps


def load_and_normalize_image(file_path: str) -> Image.Image:
    """
    Load an image and convert it into a standardized format
    for the MedDecode document-processing pipeline.

    Processing performed:
    - Verifies that the file exists.
    - Opens the image.
    - Applies EXIF orientation correction.
    - Converts the image to RGB.

    Returns:
        A normalized Pillow Image object.

    Raises:
        FileNotFoundError:
            If the image file does not exist.

        ValueError:
            If the file cannot be opened as a valid image.
    """

    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(
            f"Image file not found: {file_path}"
        )

    try:
        with Image.open(path) as image:
            # Correct orientation using EXIF metadata when available.
            image = ImageOps.exif_transpose(image)

            # Standardize all images to RGB.
            image = image.convert("RGB")

            # Return an independent image object after the source
            # file has been closed.
            return image.copy()

    except (OSError, ValueError) as error:
        raise ValueError(
            f"Unable to process image file: {file_path}"
        ) from error