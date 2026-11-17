from pathlib import Path

import pytest

from app.integration.ocr_runtime_config import (
    AdaptiveOCRSettings,
    TROCR_CHECKPOINT_SHA256,
    TrOCRSettings,
    boolean_environment,
)


def test_adaptive_settings_default_to_disabled_without_model_requirements(monkeypatch) -> None:
    monkeypatch.delenv("MEDDECODE_ADAPTIVE_OCR_ENABLED", raising=False)
    monkeypatch.delenv("MEDDECODE_PADDLEOCR_DETECTION_MODEL_DIRECTORY", raising=False)
    monkeypatch.delenv("MEDDECODE_PADDLEOCR_RECOGNITION_MODEL_DIRECTORY", raising=False)

    assert AdaptiveOCRSettings.from_environment() == AdaptiveOCRSettings(False)


def test_adaptive_settings_require_both_existing_local_model_directories(tmp_path: Path, monkeypatch) -> None:
    detection = tmp_path / "detection"
    recognition = tmp_path / "recognition"
    detection.mkdir()
    recognition.mkdir()
    monkeypatch.setenv("MEDDECODE_ADAPTIVE_OCR_ENABLED", "true")
    monkeypatch.setenv("MEDDECODE_PADDLEOCR_DETECTION_MODEL_DIRECTORY", str(detection))
    monkeypatch.setenv("MEDDECODE_PADDLEOCR_RECOGNITION_MODEL_DIRECTORY", str(recognition))

    settings = AdaptiveOCRSettings.from_environment()

    assert settings == AdaptiveOCRSettings(True, detection, recognition)


def test_adaptive_settings_fail_closed_for_missing_assets_or_ambiguous_boolean(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MEDDECODE_ADAPTIVE_OCR_ENABLED", "true")
    monkeypatch.setenv("MEDDECODE_PADDLEOCR_DETECTION_MODEL_DIRECTORY", str(tmp_path / "missing"))
    monkeypatch.setenv("MEDDECODE_PADDLEOCR_RECOGNITION_MODEL_DIRECTORY", str(tmp_path / "missing"))
    with pytest.raises(RuntimeError, match="assets are unavailable"):
        AdaptiveOCRSettings.from_environment()
    monkeypatch.setenv("MEDDECODE_ADAPTIVE_OCR_ENABLED", "auto")
    with pytest.raises(RuntimeError, match="explicit boolean"):
        boolean_environment("MEDDECODE_ADAPTIVE_OCR_ENABLED")


def test_trocr_request_is_inert_when_adaptive_ocr_is_disabled(monkeypatch) -> None:
    monkeypatch.setenv("MEDDECODE_TROCR_ENABLED", "true")
    monkeypatch.delenv("MEDDECODE_TROCR_PYTHON", raising=False)
    monkeypatch.delenv("MEDDECODE_TROCR_MODEL_DIRECTORY", raising=False)

    assert TrOCRSettings.from_environment(adaptive_enabled=False) == TrOCRSettings(True, False)


def test_trocr_settings_require_isolated_runtime_and_matching_checkpoint(tmp_path: Path, monkeypatch) -> None:
    interpreter = tmp_path / "python.exe"
    interpreter.write_bytes(b"python")
    model = tmp_path / "model"
    model.mkdir()
    (model / "config.json").write_text("{}", encoding="utf-8")
    (model / "preprocessor_config.json").write_text("{}", encoding="utf-8")
    weights = b"verified-checkpoint"
    (model / "model.safetensors").write_bytes(weights)
    import hashlib
    monkeypatch.setattr("app.integration.ocr_runtime_config.TROCR_CHECKPOINT_SHA256", hashlib.sha256(weights).hexdigest())
    monkeypatch.setenv("MEDDECODE_TROCR_ENABLED", "true")
    monkeypatch.setenv("MEDDECODE_TROCR_PYTHON", str(interpreter))
    monkeypatch.setenv("MEDDECODE_TROCR_MODEL_DIRECTORY", str(model))

    settings = TrOCRSettings.from_environment(adaptive_enabled=True)

    assert settings.enabled is True
    assert settings.interpreter == interpreter
    assert settings.model_directory == model
    assert TROCR_CHECKPOINT_SHA256


def test_trocr_settings_fail_closed_for_checkpoint_mismatch(tmp_path: Path, monkeypatch) -> None:
    interpreter = tmp_path / "python.exe"
    interpreter.write_bytes(b"python")
    model = tmp_path / "model"
    model.mkdir()
    for name in ("config.json", "preprocessor_config.json", "model.safetensors"):
        (model / name).write_bytes(b"wrong")
    monkeypatch.setenv("MEDDECODE_TROCR_ENABLED", "true")
    monkeypatch.setenv("MEDDECODE_TROCR_PYTHON", str(interpreter))
    monkeypatch.setenv("MEDDECODE_TROCR_MODEL_DIRECTORY", str(model))

    with pytest.raises(RuntimeError, match="integrity"):
        TrOCRSettings.from_environment(adaptive_enabled=True)
