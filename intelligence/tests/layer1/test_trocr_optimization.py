from __future__ import annotations

from PIL import Image, ImageDraw, ImageFont

from app.layer1_document_processing.trocr_optimization import (
    maybe_apply_dynamic_int8_quantization,
    prepare_handwriting_line_image,
)


def _handwriting_like_line(text: str, *, width: int = 800, height: int = 180) -> Image.Image:
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 34)
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw.text((35, 35), text, fill="black", font=font)
    return image


def test_prepare_handwriting_line_image_preserves_content_and_reduces_large_crop() -> None:
    large = _handwriting_like_line("Miraform 250 mg")
    output = prepare_handwriting_line_image(large, max_pixels=150_000)
    assert output is not None
    assert output.size[0] > 0 and output.size[1] > 0
    assert output.mode == "RGB"


def test_prepare_handwriting_line_image_rejects_blank_regions() -> None:
    blank = Image.new("RGB", (120, 40), "white")
    assert prepare_handwriting_line_image(blank) is None


def test_dynamic_quantization_reports_unsupported_when_quantizer_fails() -> None:
    class FakeModel:
        pass

    def failing_quantizer(*_args, **_kwargs):
        raise RuntimeError("not supported")

    model, status = maybe_apply_dynamic_int8_quantization(FakeModel(), quantizer=failing_quantizer)
    assert model is not None
    assert status["status"] == "unsupported"
