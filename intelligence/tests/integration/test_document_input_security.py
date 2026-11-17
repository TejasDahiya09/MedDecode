from pathlib import Path

import pytest
from PIL import Image

from app.integration.local_pdf_pipeline import _load_validated_document, LocalPdfProcessingError


@pytest.mark.parametrize(("kind", "suffix", "mime"), [("JPEG", ".jpg", "image/jpeg"), ("PNG", ".png", "image/png")])
def test_image_decoding_and_mime_enforcement(tmp_path: Path, kind: str, suffix: str, mime: str):
    path = tmp_path / ("synthetic" + suffix)
    Image.new("RGB", (20, 10), "white").save(path, format=kind)
    assert _load_validated_document(path, mime, 120)[0].size == (20, 10)
    with pytest.raises(LocalPdfProcessingError):
        _load_validated_document(path, "image/png" if kind == "JPEG" else "image/jpeg", 120)


def test_transparent_png_is_composited_on_white(tmp_path: Path):
    path = tmp_path / "synthetic.png"
    Image.new("RGBA", (3, 3), (0, 0, 0, 0)).save(path)
    assert _load_validated_document(path, "image/png", 120)[0].getpixel((0, 0)) == (255, 255, 255)


def test_jpeg_exif_orientation_is_applied(tmp_path: Path):
    path = tmp_path / "rotated.jpg"
    image = Image.new("RGB", (20, 10), "white")
    exif = image.getexif()
    exif[274] = 6
    image.save(path, exif=exif)
    assert _load_validated_document(path, "image/jpeg", 120)[0].size == (10, 20)


def test_rejects_corrupt_and_oversized_images(tmp_path: Path):
    corrupt = tmp_path / "bad.jpg"
    corrupt.write_bytes(b"\xff\xd8\xffinvalid")
    with pytest.raises(LocalPdfProcessingError):
        _load_validated_document(corrupt, "image/jpeg", 120)
    huge = tmp_path / "huge.png"
    Image.new("1", (10001, 1)).save(huge)
    with pytest.raises(LocalPdfProcessingError):
        _load_validated_document(huge, "image/png", 120)
