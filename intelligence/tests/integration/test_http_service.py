"""FastAPI transport tests; OCR and catalogue execution remain outside this suite."""
from __future__ import annotations

import base64
import asyncio
import json
import socket
import threading
import tempfile
from pathlib import Path

import fitz
import pytest
from fastapi.testclient import TestClient

from app.integration import http_service
from app.integration.contract_v1 import synthetic_success
from app.integration.document_safety import DocumentSafetyLimits
from app.integration.process_supervisor import ProcessingTimeout, SupervisedResult

TOKEN = "test-only-internal-token-with-32-characters"
REQUEST = {"schema_version": "1.0", "job_id": "10000000-0000-4000-8000-000000000001",
           "prescription_id": "20000000-0000-4000-8000-000000000001",
           "document": {"access_type": "authorized_url", "file_url": "https://worker.invalid/authorized-document", "file_type": "application/pdf"},
           "requested_analysis": {"extract_prescription": True, "match_medicines": True, "find_alternatives": False, "generate_recommendations": True}}


class FakeSupervisor:
    def __init__(self, failure=None):
        self.failure = failure
        self.paths: list[Path] = []
        self.shutdown_called = False

    async def run(self, path, metadata):
        self.paths.append(Path(path))
        if self.failure is not None:
            raise self.failure
        return SupervisedResult(synthetic_success(metadata), 1, 1024)

    async def shutdown(self):
        self.shutdown_called = True


class BlockingSupervisor(FakeSupervisor):
    def __init__(self):
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()

    async def run(self, path, metadata):
        import asyncio
        self.paths.append(Path(path))
        self.started.set()
        while not self.release.is_set():
            await asyncio.sleep(0.01)
        return SupervisedResult(synthetic_success(metadata), 1, 1024)


def valid_pdf() -> bytes:
    document = fitz.open()
    document.new_page()
    data = document.tobytes()
    document.close()
    return data


@pytest.fixture
def client(monkeypatch):
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
    monkeypatch.setenv("MEDDECODE_INTERNAL_TOKEN", TOKEN)
    monkeypatch.setenv("MEDDECODE_CATALOGUE_ENV", "local")
    supervisor = FakeSupervisor()
    def initialize(app):
        app.state.limits = DocumentSafetyLimits()
        app.state.supervisor = supervisor
    monkeypatch.setattr(http_service, "_initialize_runtime", initialize)
    with TestClient(http_service.app) as test:
        assert test.get("/ready").status_code == 200
        yield test, supervisor
    assert supervisor.shutdown_called


def headers(metadata=REQUEST):
    encoded = base64.b64encode(json.dumps(metadata).encode()).decode()
    return {"authorization": "Bearer " + TOKEN, "content-type": "application/octet-stream", "x-meddecode-contract": encoded}


@pytest.mark.parametrize("value", ["true", "TRUE", "1", "yes", "on"])
def test_explicit_boolean_environment_accepts_enabled_values(monkeypatch, value):
    monkeypatch.setenv("MEDDECODE_ADAPTIVE_OCR_ENABLED", value)
    assert http_service._boolean_environment("MEDDECODE_ADAPTIVE_OCR_ENABLED") is True


@pytest.mark.parametrize("value", ["false", "FALSE", "0", "no", "off"])
def test_explicit_boolean_environment_accepts_disabled_values(monkeypatch, value):
    monkeypatch.setenv("MEDDECODE_ADAPTIVE_OCR_ENABLED", value)
    assert http_service._boolean_environment("MEDDECODE_ADAPTIVE_OCR_ENABLED", True) is False


def test_adaptive_flag_is_disabled_by_default_and_invalid_values_fail_closed(monkeypatch):
    monkeypatch.delenv("MEDDECODE_ADAPTIVE_OCR_ENABLED", raising=False)
    assert http_service._boolean_environment("MEDDECODE_ADAPTIVE_OCR_ENABLED") is False
    monkeypatch.setenv("MEDDECODE_ADAPTIVE_OCR_ENABLED", "sometimes")
    with pytest.raises(RuntimeError, match="explicit boolean"):
        http_service._boolean_environment("MEDDECODE_ADAPTIVE_OCR_ENABLED")


def test_health_authentication_contract_and_cleanup(client):
    test, supervisor = client
    assert test.get("/health").json() == {"status": "alive"}
    assert test.post("/api/v1/intelligence/process", content=valid_pdf()).status_code == 401
    response = test.post("/api/v1/intelligence/process", content=valid_pdf(), headers=headers())
    assert response.status_code == 200
    assert response.json()["job_id"] == REQUEST["job_id"]
    assert supervisor.paths and not supervisor.paths[-1].exists()


def test_invalid_metadata_signature_type_and_size(client):
    test, _ = client
    assert test.post("/api/v1/intelligence/process", content=b"bad", headers=headers()).status_code == 400
    assert test.post("/api/v1/intelligence/process", content=valid_pdf(), headers={"authorization": "Bearer " + TOKEN, "content-type": "application/octet-stream"}).status_code == 400
    assert test.post("/api/v1/intelligence/process", content=valid_pdf(), headers={**headers(), "content-type": "application/pdf"}).status_code == 415
    test.app.state.limits = DocumentSafetyLimits(**(DocumentSafetyLimits().__dict__ | {"max_document_bytes": 4}))
    assert test.post("/api/v1/intelligence/process", content=valid_pdf(), headers=headers()).status_code == 413


def test_supervised_timeout_releases_gate_and_cleans_temporary_file(client):
    test, old = client
    replacement = FakeSupervisor(ProcessingTimeout("deadline"))
    test.app.state.supervisor = replacement
    assert test.post("/api/v1/intelligence/process", content=valid_pdf(), headers=headers()).status_code == 504
    assert replacement.paths and not replacement.paths[-1].exists()
    test.app.state.supervisor = old
    assert test.post("/api/v1/intelligence/process", content=valid_pdf(), headers=headers()).status_code == 200


def test_document_page_limit_returns_safe_client_error(client):
    test, _ = client
    document = fitz.open()
    document.new_page(); document.new_page()
    data = document.tobytes(); document.close()
    test.app.state.limits = DocumentSafetyLimits(**(DocumentSafetyLimits().__dict__ | {"max_pdf_pages": 1}))
    response = test.post("/api/v1/intelligence/process", content=data, headers=headers())
    assert response.status_code == 413
    assert "pages" in response.json()["detail"].lower()


def test_concurrent_request_is_rejected_without_starting_second_child(client):
    from concurrent.futures import ThreadPoolExecutor
    test, old = client
    replacement = BlockingSupervisor()
    test.app.state.supervisor = replacement
    with ThreadPoolExecutor(max_workers=1) as executor:
        first = executor.submit(test.post, "/api/v1/intelligence/process", content=valid_pdf(), headers=headers())
        assert replacement.started.wait(timeout=2)
        second = test.post("/api/v1/intelligence/process", content=valid_pdf(), headers=headers())
        assert second.status_code == 429
        assert len(replacement.paths) == 1
        replacement.release.set()
        assert first.result(timeout=3).status_code == 200
    test.app.state.supervisor = old


@pytest.mark.parametrize("after_chunk", [False, True])
def test_cancellation_before_or_during_staging_leaves_no_temporary_document(client, after_chunk):
    class CancelledRequest:
        async def stream(self):
            if after_chunk:
                yield b"%PDF-"
            raise asyncio.CancelledError()
    holder = None
    async def exercise():
        nonlocal holder
        with tempfile.TemporaryDirectory(prefix="meddecode-cancel-test-") as directory:
            holder = Path(directory)
            with pytest.raises(asyncio.CancelledError):
                await http_service._stage_request(CancelledRequest(), holder / "document.pdf", 1024, 1.0)
        assert holder is not None and not holder.exists()
    asyncio.run(exercise())
