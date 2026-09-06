import pytest
from PIL import Image

from app.layer1_document_processing.image_processor import (
    load_and_normalize_image,
)


def test_image_is_loaded_and_normalized(tmp_path):
    image_path = tmp_path / "prescription.png"

    image = Image.new(
        "RGBA",
        (500, 300),
        (255, 255, 255, 255),
    )

    image.save(image_path)

    result = load_and_normalize_image(
        str(image_path)
    )

    assert result.mode == "RGB"
    assert result.size == (500, 300)


def test_missing_image_raises_file_not_found_error():
    with pytest.raises(FileNotFoundError):
        load_and_normalize_image(
            "this_image_does_not_exist.jpg"
        )


def test_invalid_image_raises_value_error(tmp_path):
    invalid_file = tmp_path / "not_an_image.jpg"

    invalid_file.write_text(
        "This is not actually an image."
    )

    with pytest.raises(ValueError):
        load_and_normalize_image(
            str(invalid_file)
        )