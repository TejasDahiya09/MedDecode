from __future__ import annotations

import asyncio
import json
import os
import socket
import sys
import time
from pathlib import Path

import pytest

from app.integration.document_safety import DocumentSafetyLimits
from app.integration.process_supervisor import ProcessingChildExit, ProcessingOutputLimit, ProcessingSupervisor, ProcessingTimeout, _rss_bytes

REQUEST = {"job_id": "10000000-0000-4000-8000-000000000001", "prescription_id": "20000000-0000-4000-8000-000000000001"}


@pytest.fixture(autouse=True)
def permit_event_loop_socketpair(monkeypatch):
    import conftest
    original_pair = socket.socketpair
    def loopback_pair(*args, **kwargs):
        denied = socket.socket.connect
        try:
            socket.socket.connect = conftest._ORIGINAL_SOCKET_CONNECT
            return original_pair(*args, **kwargs)
        finally:
            socket.socket.connect = denied
    monkeypatch.setattr(socket, "socketpair", loopback_pair)


def fake_module(tmp_path: Path) -> tuple[str, dict[str, str]]:
    package = tmp_path / "fakeworker"
    package.mkdir()
    (package / "__init__.py").write_text("", encoding="utf-8")
    (package / "main.py").write_text(
        "import json,os,socket,sys,time\n"
        "probe=socket.socket(); probe.close()\n"
        "data=json.load(sys.stdin)\n"
        "mode=os.environ.get('FAKE_MODE','success')\n"
        "if mode=='sleep': time.sleep(30)\n"
        "if mode=='large': print('x'*2000000); raise SystemExit(0)\n"
        "if mode=='exit': raise SystemExit(7)\n"
        "if os.environ.get('MEDDECODE_SAFE_OCR_DIAGNOSTICS')=='1': print('SAFE_OCR_ROUTE:EASYOCR=3:PADDLEOCR=1',file=sys.stderr)\n"
        "print(json.dumps({'schema_version':'1.0','job_id':data['job_id'],'prescription_id':data['prescription_id'],'status':'completed','medicines':[],'warnings':[],'recommendations':[],'child_argv':sys.argv[1:],'paddle_source_check_disabled':os.environ.get('PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK')}))\n",
        encoding="utf-8",
    )
    existing = os.environ.get("PYTHONPATH", "")
    return "fakeworker.main", {"PYTHONPATH": str(tmp_path) + (os.pathsep + existing if existing else "")}


def supervisor(tmp_path: Path, mode="success", timeout=2.0):
    module, environment = fake_module(tmp_path)
    environment["FAKE_MODE"] = mode
    values = DocumentSafetyLimits().__dict__ | {"processing_timeout_seconds": timeout}
    return ProcessingSupervisor(DocumentSafetyLimits(**values), tmp_path, worker_module=module, environment_overrides=environment)


def test_success_and_identity_validation(tmp_path):
    document = tmp_path / "document.pdf"
    document.write_bytes(b"test")
    async def exercise():
        runner = supervisor(tmp_path)
        result = await runner.run(document, REQUEST)
        assert result.payload["status"] == "completed"
        assert result.elapsed_ms >= 0
        assert runner.active_process_count == 0
    asyncio.run(exercise())


def test_timeout_terminates_child_and_allows_repeated_attempts(tmp_path):
    document = tmp_path / "document.pdf"
    document.write_bytes(b"test")
    async def exercise():
        runner = supervisor(tmp_path, "sleep", 0.2)
        for _ in range(2):
            with pytest.raises(ProcessingTimeout):
                await runner.run(document, REQUEST)
            assert runner.active_process_count == 0
    asyncio.run(exercise())


def test_request_cancellation_and_shutdown_terminate_exact_children(tmp_path):
    document = tmp_path / "document.pdf"
    document.write_bytes(b"test")
    async def exercise():
        runner = supervisor(tmp_path, "sleep", 30)
        task = asyncio.create_task(runner.run(document, REQUEST))
        for _ in range(100):
            if runner.active_process_count:
                break
            await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert runner.active_process_count == 0
        task = asyncio.create_task(runner.run(document, REQUEST))
        for _ in range(100):
            if runner.active_process_count:
                break
            await asyncio.sleep(0.01)
        await runner.shutdown()
        with pytest.raises((ProcessingChildExit, asyncio.CancelledError)):
            await task
        assert runner.active_process_count == 0
    asyncio.run(exercise())


def test_unexpected_child_exit_is_sanitized(tmp_path):
    document = tmp_path / "document.pdf"
    document.write_bytes(b"test")
    async def exercise():
        runner = supervisor(tmp_path, "exit")
        with pytest.raises(ProcessingChildExit):
            await runner.run(document, REQUEST)
        assert runner.active_process_count == 0
    asyncio.run(exercise())


def test_child_output_is_bounded_and_process_is_reaped(tmp_path):
    document = tmp_path / "document.pdf"
    document.write_bytes(b"test")
    async def exercise():
        runner = supervisor(tmp_path, "large")
        with pytest.raises(ProcessingOutputLimit):
            await runner.run(document, REQUEST)
        assert runner.active_process_count == 0
    asyncio.run(exercise())


def test_peak_memory_probe_reports_current_process():
    measured = _rss_bytes(os.getpid())
    assert measured is not None and measured > 1024 * 1024


def test_adaptive_mode_is_explicit_and_passes_only_local_model_paths(tmp_path):
    document = tmp_path / "document.pdf"
    document.write_bytes(b"test")
    detection = tmp_path / "paddle-detection"
    recognition = tmp_path / "paddle-recognition"
    detection.mkdir()
    recognition.mkdir()
    module, environment = fake_module(tmp_path)
    runner = ProcessingSupervisor(
        DocumentSafetyLimits(),
        tmp_path,
        worker_module=module,
        environment_overrides=environment,
        adaptive_ocr_enabled=True,
        paddle_detection_model_directory=detection,
        paddle_recognition_model_directory=recognition,
        safe_ocr_diagnostics=True,
        preprocessing_enabled=True,
    )

    result = asyncio.run(runner.run(document, REQUEST))

    assert "--adaptive-ocr" in result.payload["child_argv"]
    assert "--preprocessing" in result.payload["child_argv"]
    assert str(detection) in result.payload["child_argv"]
    assert str(recognition) in result.payload["child_argv"]
    assert result.payload["paddle_source_check_disabled"] == "True"
    assert result.provider_counts == {"easyocr": 3, "paddleocr": 1}


def test_adaptive_mode_fails_closed_without_explicit_paddle_paths(tmp_path):
    with pytest.raises(ValueError, match="explicit local PaddleOCR model directories"):
        ProcessingSupervisor(DocumentSafetyLimits(), tmp_path, adaptive_ocr_enabled=True)


def test_trocr_mode_passes_only_explicit_isolated_assets(tmp_path):
    document = tmp_path / "document.pdf"
    document.write_bytes(b"test")
    detection = tmp_path / "paddle-detection"
    recognition = tmp_path / "paddle-recognition"
    model = tmp_path / "trocr-model"
    for directory in (detection, recognition, model):
        directory.mkdir()
    interpreter = tmp_path / "trocr-python.exe"
    interpreter.write_bytes(b"test")
    module, environment = fake_module(tmp_path)
    runner = ProcessingSupervisor(
        DocumentSafetyLimits(),
        tmp_path,
        worker_module=module,
        environment_overrides=environment,
        adaptive_ocr_enabled=True,
        paddle_detection_model_directory=detection,
        paddle_recognition_model_directory=recognition,
        trocr_enabled=True,
        trocr_interpreter=interpreter,
        trocr_model_directory=model,
        trocr_timeout_seconds=17.0,
    )

    result = asyncio.run(runner.run(document, REQUEST))

    arguments = result.payload["child_argv"]
    assert "--trocr" in arguments
    assert str(interpreter) in arguments
    assert str(model) in arguments
    assert arguments[arguments.index("--trocr-timeout-seconds") + 1] == "17.0"


def test_trocr_mode_cannot_bypass_adaptive_policy(tmp_path):
    with pytest.raises(ValueError, match="requires adaptive OCR"):
        ProcessingSupervisor(
            DocumentSafetyLimits(), tmp_path,
            trocr_enabled=True,
            trocr_interpreter=tmp_path / "python.exe",
            trocr_model_directory=tmp_path / "model",
        )
