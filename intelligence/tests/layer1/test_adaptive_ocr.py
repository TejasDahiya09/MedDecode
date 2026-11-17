from __future__ import annotations

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFilter

from app.layer1_document_processing.adaptive_ocr import AdaptiveOCRRouter, analyze_document_quality, build_fallback_regions
from app.layer1_document_processing.hybrid_ocr import OCRPrediction


def _polygon(y: float = 10.0):
    return ((10.0, y), (200.0, y), (200.0, y + 20.0), (10.0, y + 20.0))


class PrimaryProvider:
    def __init__(self, text: str, confidence: float):
        self.text = text
        self.confidence = confidence

    def recognize(self, image: Image.Image, page_number: int, timeout_seconds: float):
        return [OCRPrediction("easyocr", "test", page_number, self.text, _polygon(), self.confidence, model_provenance="test")]


class SecondaryProvider:
    full_page_calls = 0
    region_calls = 0
    def recognize(self, image: Image.Image, page_number: int, timeout_seconds: float):
        self.full_page_calls += 1
        return []
    def recognize_regions(self, regions, page_number: int, timeout_seconds: float):
        self.region_calls += 1
        return [OCRPrediction("paddleocr", "test", page_number, "Examplemed 10 mg", regions[0].polygon, 0.95, model_provenance="test")]


class HandwrittenProvider:
    def recognize_regions(self, regions, page_number: int, timeout_seconds: float):
        return [OCRPrediction("trocr", "test", page_number, "Examplemed", regions[0].polygon, None, "handwritten", "test")]


def test_document_quality_signals_low_confidence_regions() -> None:
    prediction = OCRPrediction("easyocr", "test", 1, "Examplemed", _polygon(), 0.40, model_provenance="test")
    quality = analyze_document_quality(Image.new("RGB", (200, 100), "white"), [prediction])
    assert quality.low_confidence_region_count == 1
    assert quality.needs_secondary_ocr is True


def test_adaptive_router_runs_easyocr_primary_and_selective_secondary_provider() -> None:
    secondary = SecondaryProvider()
    router = AdaptiveOCRRouter(
        primary_provider=PrimaryProvider("Examplemed", 0.4),
        secondary_provider=secondary,
        handwritten_provider=HandwrittenProvider(),
    )
    result = router.route(Image.new("RGB", (200, 100), "white"), 1, timeout_seconds=1.0)
    assert result.primary_predictions[0].engine_name == "easyocr"
    assert result.secondary_predictions[0].engine_name == "paddleocr"
    assert secondary.region_calls == 1
    assert secondary.full_page_calls == 0
    assert result.fallback_regions[0].polygon == ((2.0, 2.0), (200.0, 2.0), (200.0, 38.0), (2.0, 38.0))


def _quality_image(*, foreground=0, background=255, blur=False):
    image = Image.new("L", (300, 120), background)
    draw = ImageDraw.Draw(image)
    draw.rectangle((10, 10, 210, 32), fill=foreground)
    return image.filter(ImageFilter.GaussianBlur(5)) if blur else image


def test_quality_metrics_have_documented_units_and_correct_contrast_threshold() -> None:
    clean = analyze_document_quality(_quality_image(), [OCRPrediction("easyocr", "v", 1, "Examplemed", _polygon(), 0.9)])
    low = analyze_document_quality(_quality_image(foreground=125, background=130), [OCRPrediction("easyocr", "v", 1, "Examplemed", _polygon(), 0.9)])
    assert clean.contrast > 18.0
    assert "low contrast" not in clean.reasons
    assert 0 <= low.contrast < 18.0
    assert "low contrast" in low.reasons
    assert clean.resolution == 36_000
    assert 0.0 <= clean.text_density <= 1.0


def test_quality_detects_blur_skew_and_unknown_handwriting_status() -> None:
    sharp = analyze_document_quality(_quality_image(), [OCRPrediction("easyocr", "v", 1, "A", _polygon(), 0.9)])
    blurred = analyze_document_quality(_quality_image(blur=True), [OCRPrediction("easyocr", "v", 1, "A", _polygon(), 0.9)])
    skewed = OCRPrediction("easyocr", "v", 1, "A", ((10., 10.), (200., 30.), (200., 50.), (10., 30.)), 0.9)
    skew = analyze_document_quality(_quality_image(), [skewed])
    assert sharp.blur_score > blurred.blur_score
    assert "low sharpness" in blurred.reasons
    assert skew.rotation_estimate_degrees > 4.0
    assert "page text skew" in skew.reasons
    assert sharp.handwriting_classification == "unknown"


def test_empty_page_is_unrecognized_not_proven_handwriting() -> None:
    quality = analyze_document_quality(Image.new("RGB", (200, 100), "white"), [])
    assert quality.unrecognized_region_count == 1
    assert "no recognized text regions" in quality.reasons
    assert quality.handwriting_classification == "unknown"


def test_fallback_regions_clamp_group_deduplicate_and_enforce_pixel_budget() -> None:
    image = Image.new("RGB", (300, 120), "white")
    predictions = [
        OCRPrediction("easyocr", "v", 1, "A", ((-3., 5.), (100., 5.), (100., 20.), (-3., 20.)), 0.2),
        OCRPrediction("easyocr", "v", 1, "B", ((105., 6.), (205., 6.), (205., 21.), (105., 21.)), 0.3),
        OCRPrediction("easyocr", "v", 1, "ignored", _polygon(70), 0.9),
    ]
    regions = build_fallback_regions(image, predictions, padding=8, max_regions=2, max_total_pixels=20_000)
    assert len(regions) == 1
    assert regions[0].polygon == ((0.0, 0.0), (213.0, 0.0), (213.0, 29.0), (0.0, 29.0))
    assert regions[0].image.size == (213, 29)
    assert build_fallback_regions(image, predictions, max_total_pixels=10) == []


def test_invalid_region_limits_fail_closed() -> None:
    with pytest.raises(ValueError):
        AdaptiveOCRRouter(max_fallback_regions=0)
