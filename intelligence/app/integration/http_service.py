"""Private, resource-bounded HTTP boundary around real-document intelligence."""
from __future__ import annotations

import asyncio
import base64
import hmac
import importlib.util
import json
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app.integration.contract_v1 import ContractError, validate_request
from app.integration.document_safety import DocumentSafetyError, DocumentSafetyLimits, validate_staged_document
from app.integration.ocr_runtime_config import AdaptiveOCRSettings, TrOCRSettings, boolean_environment
from app.integration.process_supervisor import ProcessingMemoryLimit, ProcessingOutputLimit, ProcessingSupervisor, ProcessingTimeout, SupervisionError

MAX_METADATA_BYTES = 8192
TYPES = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}


def _boolean_environment(name: str, default: bool = False) -> bool:
    return boolean_environment(name, default)


def _initialize_runtime(app: FastAPI) -> None:
    directory = os.environ.get("MEDDECODE_EASYOCR_MODEL_DIRECTORY", "").strip()
    model_directory = Path(directory).expanduser() if directory else None
    if model_directory is None or not model_directory.is_dir():
        raise RuntimeError("EasyOCR model directory is unavailable")
    model_files = [path for path in model_directory.glob("*.pth") if path.is_file() and path.stat().st_size > 0]
    if len(model_files) < 2 or importlib.util.find_spec("easyocr") is None:
        raise RuntimeError("EasyOCR runtime assets are unavailable")
    limits = DocumentSafetyLimits.from_environment()
    adaptive_settings = AdaptiveOCRSettings.from_environment()
    trocr_settings = TrOCRSettings.from_environment(adaptive_enabled=adaptive_settings.enabled)
    if adaptive_settings.enabled:
        if importlib.util.find_spec("paddleocr") is None:
            raise RuntimeError("PaddleOCR runtime is unavailable")
    # Readiness means the restricted catalogue dependency can execute a
    # read-only query now, not merely that environment variables parse.
    from app.database.catalogue_connection import connect_catalogue
    connection = connect_catalogue()
    try:
        connection.execute("SELECT 1").fetchone()
    finally:
        connection.close()
    app.state.limits = limits
    app.state.adaptive_ocr_enabled = adaptive_settings.enabled
    app.state.trocr_enabled = trocr_settings.enabled
    app.state.supervisor = ProcessingSupervisor(
        limits,
        model_directory,
        adaptive_ocr_enabled=adaptive_settings.enabled,
        paddle_detection_model_directory=adaptive_settings.paddle_detection_model_directory,
        paddle_recognition_model_directory=adaptive_settings.paddle_recognition_model_directory,
        trocr_enabled=trocr_settings.enabled,
        trocr_interpreter=trocr_settings.interpreter,
        trocr_model_directory=trocr_settings.model_directory,
        trocr_timeout_seconds=trocr_settings.timeout_seconds,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.initialization = "starting"
    app.state.gate = asyncio.Lock()
    app.state.supervisor = None
    try:
        _initialize_runtime(app)
        app.state.initialization = "ready"
    except Exception:
        app.state.initialization = "unavailable"
    yield
    if app.state.supervisor is not None:
        await app.state.supervisor.shutdown()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
async def health():
    return {"status": "alive"}


@app.get("/ready")
async def ready(request: Request):
    token = os.environ.get("MEDDECODE_INTERNAL_TOKEN", "")
    try:
        from app.database.catalogue_connection import load_catalogue_connection_settings
        load_catalogue_connection_settings()
        catalogue_configured = True
    except Exception:
        catalogue_configured = False
    available = request.app.state.initialization == "ready" and len(token) >= 32 and catalogue_configured
    payload = {"status": "ready" if available else "not_ready"}
    return JSONResponse(payload, status_code=200 if available else 503)


def _authorized(request: Request) -> bool:
    token = os.environ.get("MEDDECODE_INTERNAL_TOKEN", "")
    supplied = request.headers.get("authorization", "")
    return len(token) >= 32 and len(supplied) <= 512 and hmac.compare_digest(
        supplied.encode("utf-8"), ("Bearer " + token).encode("utf-8")
    )


def _metadata(request: Request) -> dict:
    encoded = request.headers.get("x-meddecode-contract", "")
    if not encoded or len(encoded) > MAX_METADATA_BYTES:
        raise HTTPException(status_code=400, detail="Invalid request metadata")
    try:
        decoded = base64.b64decode(encoded, validate=True)
        if len(decoded) > MAX_METADATA_BYTES:
            raise ValueError("decoded metadata is too large")
        return validate_request(json.loads(decoded))
    except (ValueError, TypeError, UnicodeError, json.JSONDecodeError, ContractError):
        raise HTTPException(status_code=400, detail="Invalid request metadata") from None


async def _stage_request(request: Request, path: Path, limit: int, timeout: float) -> None:
    total = 0
    try:
        with path.open("xb") as handle:
            async with asyncio.timeout(timeout):
                async for chunk in request.stream():
                    total += len(chunk)
                    if total > limit:
                        raise HTTPException(status_code=413, detail="Document is too large")
                    handle.write(chunk)
    except TimeoutError:
        raise HTTPException(status_code=408, detail="Document transfer timed out") from None
    except HTTPException:
        raise
    except OSError:
        raise HTTPException(status_code=503, detail="Temporary document storage is unavailable") from None
    if total < 1:
        raise HTTPException(status_code=400, detail="Document is empty")


@app.post("/api/v1/intelligence/process")
async def process(request: Request):
    if not _authorized(request):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/octet-stream":
        raise HTTPException(status_code=415, detail="Unsupported content type")
    if request.app.state.initialization != "ready":
        raise HTTPException(status_code=503, detail="Intelligence service is not ready")
    metadata = _metadata(request)
    try:
        await asyncio.wait_for(request.app.state.gate.acquire(), timeout=0.01)
    except TimeoutError:
        raise HTTPException(status_code=429, detail="Intelligence service is busy") from None
    try:
        limits: DocumentSafetyLimits = request.app.state.limits
        suffix = TYPES[metadata["document"]["file_type"]]
        with tempfile.TemporaryDirectory(prefix="meddecode-intelligence-") as directory:
            path = Path(directory) / ("document" + suffix)
            await _stage_request(request, path, limits.max_document_bytes, limits.transfer_timeout_seconds)
            try:
                validate_staged_document(path, metadata["document"]["file_type"], limits)
            except DocumentSafetyError as error:
                raise HTTPException(status_code=error.status_code, detail=error.safe_message) from None
            try:
                result = await request.app.state.supervisor.run(path, metadata)
                return result.payload
            except ProcessingTimeout:
                raise HTTPException(status_code=504, detail="Intelligence processing timed out") from None
            except ProcessingMemoryLimit:
                raise HTTPException(status_code=503, detail="Intelligence processing exceeded its resource limit") from None
            except ProcessingOutputLimit:
                raise HTTPException(status_code=502, detail="Intelligence response exceeded its limit") from None
            except SupervisionError:
                raise HTTPException(status_code=422, detail="Document processing failed") from None
    finally:
        request.app.state.gate.release()


