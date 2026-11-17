from __future__ import annotations

import base64
import subprocess
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw

from app.integration.staged_ocr_protocol import (
    prediction_from_json,
    prediction_to_json,
    region_from_json,
    region_to_json,
)
from app.layer1_document_processing.hybrid_ocr import OCRPrediction, OCRRegion
from app.integration import staged_local_pdf_worker


def test_prediction_round_trip_preserves_provider_evidence() -> None:
    value = OCRPrediction(
        "easyocr", "1.7.2", 2, "Examplemed 10 mg",
        ((1.0, 2.0), (11.0, 2.0), (11.0, 8.0), (1.0, 8.0)),
        0.71, "unknown", "local-model",
    )
    assert prediction_from_json(prediction_to_json(value)) == value


def test_region_round_trip_is_bounded_png_not_pickle() -> None:
    image = Image.new("RGB", (80, 24), "white")
    ImageDraw.Draw(image).text((2, 2), "Rx", fill="black")
    value = OCRRegion(((0.0, 0.0), (80.0, 0.0), (80.0, 24.0), (0.0, 24.0)), image)
    encoded = region_to_json(value)
    assert set(encoded) == {"polygon", "image_png_base64"}
    decoded = region_from_json(encoded)
    assert decoded.polygon == value.polygon
    assert decoded.image.size == value.image.size


def test_region_decoder_rejects_non_image_payload() -> None:
    with pytest.raises(Exception):
        region_from_json({
            "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "image_png_base64": base64.b64encode(b"not an image").decode("ascii"),
        })


def test_primary_stage_timeout_terminates_the_process_tree(monkeypatch) -> None:
    class Process:
        returncode = None

        def communicate(self, timeout):
            raise subprocess.TimeoutExpired("primary", timeout)

    process = Process()
    terminated = []
    monkeypatch.setattr(staged_local_pdf_worker.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(staged_local_pdf_worker, "_terminate_tree", lambda value: terminated.append(value))
    args = SimpleNamespace(
        local_pdf_path="fictional.pdf", easyocr_model_directory="easy",
        paddle_detection_model_directory="det", paddle_recognition_model_directory="rec",
    )
    with pytest.raises(RuntimeError, match="PRIMARY_STAGE_TIMEOUT"):
        staged_local_pdf_worker._run_primary_stage(args, "application/pdf")
    assert terminated == [process]
