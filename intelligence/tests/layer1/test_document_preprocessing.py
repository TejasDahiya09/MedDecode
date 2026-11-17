from PIL import Image, ImageDraw

from app.layer1_document_processing.document_preprocessing import (
    analyze_document_quality,
    apply_safe_image_preprocessing,
)


def _make_text_image(text: str, *, size=(900, 600), background=(255, 255, 255), foreground=(0, 0, 0)) -> Image.Image:
    image = Image.new("RGB", size, background)
    draw = ImageDraw.Draw(image)
    draw.text((60, 80), text, fill=foreground)
    return image


def test_document_quality_analysis_detects_low_contrast_and_small_text_risk():
    image = _make_text_image("0.5 mg", size=(320, 220), background=(245, 245, 245), foreground=(30, 30, 30))
    quality = analyze_document_quality(image)

    assert quality.resolution > 0
    assert quality.contrast_ratio >= 0.0
    assert quality.brightness >= 0.0
    assert quality.low_resolution or quality.unreadable_small_text or quality.reasons


def test_safe_preprocessing_keeps_numeric_tokens_and_returns_metadata():
    image = _make_text_image("Tab Metformin 500 mg\n0-1-0 after food", size=(700, 400))
    result = apply_safe_image_preprocessing(image)

    assert result.image.size[0] > 0
    assert result.original_size == (700, 400)
    assert result.output_size == result.image.size
    assert result.quality.resolution > 0
    assert result.applied_steps or result.warnings


def test_safe_preprocessing_handles_skewed_document_and_keeps_original_as_copy():
    image = _make_text_image("Cap Amlodipine 5 mg\n1-0-1", size=(900, 500))
    result = apply_safe_image_preprocessing(image)

    assert result.image is not image
    assert result.image.mode == "RGB"
    assert result.quality.skew_estimate_degrees is not None
