from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from app.layer1_document_processing.hybrid_ocr import OCRRegion
from app.layer1_document_processing.trocr_ipc import (
    MAX_REGIONS,
    TrOCRIPCError,
    TrOCRSubprocessConfig,
    TrOCRSubprocessProvider,
)

POLYGON = ((1.0, 2.0), (101.0, 2.0), (101.0, 32.0), (1.0, 32.0))


def provider(tmp_path: Path) -> TrOCRSubprocessProvider:
    interpreter = tmp_path / "python.exe"
    interpreter.write_bytes(b"test")
    model = tmp_path / "model"
    model.mkdir()
    # Unit protocol tests use an explicit synthetic budget above the measured
    # reserve. Production retains the unchanged 2 GiB request-tree ceiling.
    return TrOCRSubprocessProvider(TrOCRSubprocessConfig(
        interpreter, model, max_process_tree_rss_bytes=4 * 1024 * 1024 * 1024
    ))


def test_region_limits_withhold_oversized_and_excess_crops(tmp_path: Path) -> None:
    item = provider(tmp_path)
    valid = OCRRegion(POLYGON, Image.new("RGB", (100, 30), "white"))
    oversized = OCRRegion(POLYGON, Image.new("RGB", (2049, 1), "white"))

    selected = item._bounded_regions([oversized, *([valid] * 10)])

    assert len(selected) == MAX_REGIONS
    assert oversized not in selected


def test_memory_preflight_withholds_provider_without_spawning(tmp_path: Path, monkeypatch) -> None:
    item = provider(tmp_path)
    monkeypatch.setattr(
        "app.layer1_document_processing.trocr_ipc._current_rss_bytes",
        lambda: item.config.max_process_tree_rss_bytes,
    )

    output = item.recognize_regions(
        [OCRRegion(POLYGON, Image.new("RGB", (100, 30), "white"))], 1, 5.0
    )

    assert output == []
    assert item.last_status_code == "resource_budget_unavailable"


def test_unknown_memory_probe_fails_closed_without_spawning(tmp_path: Path, monkeypatch) -> None:
    item = provider(tmp_path)
    monkeypatch.setattr("app.layer1_document_processing.trocr_ipc._current_rss_bytes", lambda: None)

    output = item.recognize_regions(
        [OCRRegion(POLYGON, Image.new("RGB", (100, 30), "white"))], 1, 5.0
    )

    assert output == []
    assert item.last_status_code == "resource_budget_unavailable"


def test_explicit_staged_reserve_still_fails_closed(tmp_path: Path, monkeypatch) -> None:
    interpreter = tmp_path / "python.exe"
    interpreter.write_bytes(b"test")
    model = tmp_path / "model"
    model.mkdir()
    item = TrOCRSubprocessProvider(TrOCRSubprocessConfig(
        interpreter, model, max_process_tree_rss_bytes=1000, memory_reserve_bytes=900,
    ))
    monkeypatch.setattr("app.layer1_document_processing.trocr_ipc._current_rss_bytes", lambda: 200)
    output = item.recognize_regions(
        [OCRRegion(POLYGON, Image.new("RGB", (100, 30), "white"))], 1, 5.0
    )
    assert output == []
    assert item.last_status_code == "resource_budget_unavailable"


def test_versioned_ipc_validates_identity_and_preserves_coordinates(tmp_path: Path, monkeypatch) -> None:
    item = provider(tmp_path)
    monkeypatch.setattr("app.layer1_document_processing.trocr_ipc._current_rss_bytes", lambda: 1)

    class Process:
        pid = 123
        returncode = 0

        def communicate(self, request_bytes, timeout):
            request = json.loads(request_bytes)
            response = {
                "schema_version": "1.0",
                "request_id": request["request_id"],
                "status": "ok",
                "predictions": [{"text": "Examplemed 10 mg", "polygon": request["regions"][0]["polygon"]}],
            }
            return json.dumps(response).encode(), b""

    monkeypatch.setattr("app.layer1_document_processing.trocr_ipc.subprocess.Popen", lambda *a, **k: Process())
    output = item.recognize_regions(
        [OCRRegion(POLYGON, Image.new("RGB", (100, 30), "white"))], 1, 5.0
    )

    assert output[0].text == "Examplemed 10 mg"
    assert output[0].polygon == POLYGON
    assert output[0].raw_confidence is None
    assert output[0].engine_name == "trocr_base_handwritten"


def test_malformed_response_fails_closed(tmp_path: Path, monkeypatch) -> None:
    item = provider(tmp_path)
    monkeypatch.setattr("app.layer1_document_processing.trocr_ipc._current_rss_bytes", lambda: 1)

    class Process:
        pid = 123
        returncode = 0

        def communicate(self, request_bytes, timeout):
            return b"not-json", b""

    monkeypatch.setattr("app.layer1_document_processing.trocr_ipc.subprocess.Popen", lambda *a, **k: Process())
    with pytest.raises(TrOCRIPCError, match="invalid_response"):
        item.recognize_regions(
            [OCRRegion(POLYGON, Image.new("RGB", (100, 30), "white"))], 1, 5.0
        )


def test_timeout_terminates_exact_subprocess_tree(tmp_path: Path, monkeypatch) -> None:
    item = provider(tmp_path)
    monkeypatch.setattr("app.layer1_document_processing.trocr_ipc._current_rss_bytes", lambda: 1)
    terminated = []

    class Process:
        pid = 456
        returncode = None

        def communicate(self, request_bytes, timeout):
            import subprocess
            raise subprocess.TimeoutExpired("trocr", timeout)

    process = Process()
    monkeypatch.setattr("app.layer1_document_processing.trocr_ipc.subprocess.Popen", lambda *a, **k: process)
    monkeypatch.setattr("app.layer1_document_processing.trocr_ipc._terminate_tree", lambda value: terminated.append(value))

    with pytest.raises(TrOCRIPCError, match="timeout"):
        item.recognize_regions(
            [OCRRegion(POLYGON, Image.new("RGB", (100, 30), "white"))], 1, 0.1
        )

    assert terminated == [process]
