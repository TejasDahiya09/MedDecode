"""Environment-backed local OCR settings with disabled-by-default adaptive mode."""

from __future__ import annotations

import os
import hashlib
from dataclasses import dataclass
from pathlib import Path


def boolean_environment(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None or not value.strip():
        return default
    normalized = value.strip().casefold()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be an explicit boolean")


@dataclass(frozen=True)
class AdaptiveOCRSettings:
    enabled: bool
    paddle_detection_model_directory: Path | None = None
    paddle_recognition_model_directory: Path | None = None

    @classmethod
    def from_environment(cls) -> "AdaptiveOCRSettings":
        enabled = boolean_environment("MEDDECODE_ADAPTIVE_OCR_ENABLED", False)
        if not enabled:
            return cls(False)
        detection_value = os.environ.get("MEDDECODE_PADDLEOCR_DETECTION_MODEL_DIRECTORY", "").strip()
        recognition_value = os.environ.get("MEDDECODE_PADDLEOCR_RECOGNITION_MODEL_DIRECTORY", "").strip()
        detection = Path(detection_value).expanduser() if detection_value else None
        recognition = Path(recognition_value).expanduser() if recognition_value else None
        if detection is None or recognition is None or not detection.is_dir() or not recognition.is_dir():
            raise RuntimeError("PaddleOCR local model assets are unavailable")
        return cls(True, detection, recognition)


TROCR_CHECKPOINT_SHA256 = "25a40cddc7e6120140a3d5b9e3dd3878a92ada7b4f312953ab22edc19c2a5acc"


@dataclass(frozen=True)
class TrOCRSettings:
    requested: bool
    enabled: bool
    interpreter: Path | None = None
    model_directory: Path | None = None
    timeout_seconds: float = 20.0

    @classmethod
    def from_environment(cls, *, adaptive_enabled: bool) -> "TrOCRSettings":
        requested = boolean_environment("MEDDECODE_TROCR_ENABLED", False)
        # The explicit policy is that TrOCR cannot bypass the adaptive router.
        if not requested or not adaptive_enabled:
            return cls(requested, False)
        interpreter_value = os.environ.get("MEDDECODE_TROCR_PYTHON", "").strip()
        model_value = os.environ.get("MEDDECODE_TROCR_MODEL_DIRECTORY", "").strip()
        interpreter = Path(interpreter_value).expanduser() if interpreter_value else None
        model_directory = Path(model_value).expanduser() if model_value else None
        if interpreter is None or not interpreter.is_file():
            raise RuntimeError("TrOCR isolated interpreter is unavailable")
        required = ("config.json", "preprocessor_config.json", "model.safetensors")
        if model_directory is None or not model_directory.is_dir() or any(
            not (model_directory / name).is_file() for name in required
        ):
            raise RuntimeError("TrOCR local model assets are unavailable")
        digest = hashlib.sha256()
        with (model_directory / "model.safetensors").open("rb") as handle:
            for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest().casefold() != TROCR_CHECKPOINT_SHA256:
            raise RuntimeError("TrOCR checkpoint integrity verification failed")
        timeout_value = os.environ.get("MEDDECODE_TROCR_TIMEOUT_SECONDS", "20").strip()
        try:
            timeout_seconds = float(timeout_value)
        except ValueError as error:
            raise RuntimeError("MEDDECODE_TROCR_TIMEOUT_SECONDS must be numeric") from error
        if not 1 <= timeout_seconds <= 60:
            raise RuntimeError("MEDDECODE_TROCR_TIMEOUT_SECONDS must be between 1 and 60")
        return cls(True, True, interpreter, model_directory, timeout_seconds)
