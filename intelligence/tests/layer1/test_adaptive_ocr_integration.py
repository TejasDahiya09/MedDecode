from __future__ import annotations

from types import SimpleNamespace

from PIL import Image

from app.layer1_document_processing.adaptive_ocr_integration import (
    AdaptiveEasyPaddleOCREngine,
    _MemoryBoundEasyOCRProvider,
)
from app.layer1_document_processing.hybrid_ocr import OCRPrediction, OCRRegion


POLYGON = ((10.0, 10.0), (210.0, 10.0), (210.0, 40.0), (10.0, 40.0))


def prediction(engine: str, text: str, confidence: float) -> OCRPrediction:
    return OCRPrediction(engine, "test", 1, text, POLYGON, confidence, model_provenance="test")


def engine_with_result(result: object) -> AdaptiveEasyPaddleOCREngine:
    engine = object.__new__(AdaptiveEasyPaddleOCREngine)
    engine._timeout_seconds = 12.0
    engine._router = SimpleNamespace(route=lambda *args, **kwargs: result)
    return engine


def test_adaptive_page_uses_agreed_secondary_evidence_and_preserves_provenance() -> None:
    routed = SimpleNamespace(
        primary_predictions=(prediction("easyocr", "Examplemed 10 mg", 0.42),),
        secondary_predictions=(prediction("paddleocr", "Examplemed 10 mg", 0.99),),
        quality=SimpleNamespace(reasons=("low confidence OCR regions",), needs_secondary_ocr=True),
        warnings=(),
    )

    page = engine_with_result(routed).recognize_page(Image.new("RGB", (300, 100), "white"), 1)
    converted = page.to_ocr_page_result()

    assert {item.engine_name for item in page.predictions} == {"easyocr", "paddleocr"}
    assert converted.full_text == "Examplemed 10 mg"
    assert any("low confidence" in warning for warning in converted.processing_warnings)


def test_adaptive_page_withholds_medically_material_disagreement() -> None:
    routed = SimpleNamespace(
        primary_predictions=(prediction("easyocr", "Examplemed 0.5 mg", 0.41),),
        secondary_predictions=(prediction("paddleocr", "Examplemed 5 mcg", 0.99),),
        quality=SimpleNamespace(reasons=("low confidence OCR regions",), needs_secondary_ocr=True),
        warnings=(),
    )

    page = engine_with_result(routed).recognize_page(Image.new("RGB", (300, 100), "white"), 1)

    assert page.to_ocr_page_result().full_text == ""
    assert page.regions[0].state == "disagreement"
    assert "numeric_conflict" in page.regions[0].uncertainty_indicators
    assert "unit_conflict" in page.regions[0].uncertainty_indicators


def test_adaptive_page_keeps_primary_and_warns_when_paddle_is_unavailable() -> None:
    routed = SimpleNamespace(
        primary_predictions=(prediction("easyocr", "Examplemed 10 mg", 0.43),),
        secondary_predictions=(),
        quality=SimpleNamespace(reasons=("low confidence OCR regions",), needs_secondary_ocr=True),
        warnings=("Secondary local OCR provider was unavailable.",),
    )

    page = engine_with_result(routed).recognize_page(Image.new("RGB", (300, 100), "white"), 1)
    converted = page.to_ocr_page_result()

    assert converted.full_text == "Examplemed 10 mg"
    assert "Secondary local OCR provider was unavailable." in converted.processing_warnings
    assert any("retained conservatively" in warning for warning in converted.processing_warnings)


def test_adaptive_easyocr_provider_releases_reader_after_each_primary_pass(monkeypatch, tmp_path) -> None:
    class Reader:
        def readtext(self, *_args, **_kwargs):
            return [(POLYGON, "Examplemed 10 mg", 0.9)]

    provider = _MemoryBoundEasyOCRProvider(
        model_storage_directory=tmp_path,
        reader=Reader(),
    )

    output = provider.recognize(Image.new("RGB", (300, 100), "white"), 1, 5.0)

    assert output[0].text == "Examplemed 10 mg"
    assert provider._reader is None


def test_low_confidence_paddle_only_evidence_is_preserved_but_not_extracted() -> None:
    routed = SimpleNamespace(
        primary_predictions=(),
        secondary_predictions=(prediction("paddleocr", "Eompies g", 0.389),),
        quality=SimpleNamespace(reasons=("no recognized text regions",), needs_secondary_ocr=True),
        warnings=(),
    )

    page = engine_with_result(routed).recognize_page(Image.new("RGB", (300, 100), "white"), 1)

    assert page.predictions[0].text == "Eompies g"
    assert page.regions[0].state == "low_confidence_secondary"
    assert page.regions[0].selected_prediction is None
    assert page.to_ocr_page_result().full_text == ""
    assert any("withheld" in warning for warning in page.review_warnings)


def test_possible_handwriting_invokes_bounded_provider_and_preserves_conflict() -> None:
    class HandwritingProvider:
        last_status_code = "not_invoked"
        config = SimpleNamespace(timeout_seconds=5.0)

        def recognize_regions(self, regions, page_number, timeout_seconds):
            self.last_status_code = "ok"
            assert len(regions) == 1
            return [prediction("trocr_base_handwritten", "Examplemed 50 mg", 0.0)]

    routed = SimpleNamespace(
        primary_predictions=(prediction("easyocr", "Examplemed 5 mg", 0.40),),
        secondary_predictions=(prediction("paddleocr", "Examplemed 5 mg", 0.90),),
        quality=SimpleNamespace(
            reasons=("possible handwriting; unverified heuristic",),
            needs_secondary_ocr=True,
            handwriting_classification="possible",
        ),
        warnings=(),
        fallback_regions=(OCRRegion(POLYGON, Image.new("RGB", (200, 30), "white")),),
    )
    engine = engine_with_result(routed)
    engine._trocr_provider = HandwritingProvider()

    page = engine.recognize_page(Image.new("RGB", (300, 100), "white"), 1)

    assert {item.engine_name for item in page.predictions} == {
        "easyocr", "paddleocr", "trocr_base_handwritten"
    }
    assert page.regions[0].state == "disagreement"
    assert page.regions[0].selected_prediction is None
    assert "numeric_conflict" in page.regions[0].uncertainty_indicators
