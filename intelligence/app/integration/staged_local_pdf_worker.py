"""Sequential Easy/Paddle -> TrOCR -> intelligence worker coordinator.

This process deliberately imports no native OCR model runtime. Primary OCR is
performed in a child which must exit before TrOCR is launched. The existing
outer ProcessingSupervisor owns this coordinator and all descendants, and
therefore remains the authoritative timeout/cancellation/memory boundary.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from typing import Any

from app.integration.contract_v1 import ContractError, validate_request
from app.integration.staged_ocr_protocol import (
    MAX_STAGE_RESPONSE_BYTES,
    PROTOCOL_VERSION,
    prediction_from_json,
    predictions_from_json,
    region_from_json,
)
from app.layer1_document_processing.hybrid_ocr import HybridOCRPageResult, _reconcile
from app.layer1_document_processing.trocr_ipc import (
    TrOCRIPCError,
    TrOCRSubprocessConfig,
    TrOCRSubprocessProvider,
    _terminate_tree,
)

MAX_INPUT_BYTES = 1024 * 1024
# A genuine staged Easy/Paddle -> TrOCR run measured 3,214,577,664 bytes for
# the supervised descendant tree. Fail before model loading under the 2 GiB
# ceiling; a future budget change requires explicit review and approval.
STAGED_TROCR_RESERVE_BYTES = 3_300_000_000


def _failure(request: dict[str, Any], code: str = "PROCESSING_FAILED") -> dict[str, Any]:
    return {
        "schema_version": "1.0", "job_id": request["job_id"],
        "prescription_id": request["prescription_id"], "status": "failed",
        "error": {"code": code, "message": "Local prescription processing failed safely.", "retryable": False},
    }


def _run_primary_stage(args: argparse.Namespace, file_type: str) -> dict[str, Any]:
    command = [
        sys.executable, "-m", "app.integration.staged_primary_ocr_worker",
        "--document-path", args.local_pdf_path, "--file-type", file_type,
        "--easyocr-model-directory", args.easyocr_model_directory,
        "--paddle-detection-model-directory", args.paddle_detection_model_directory,
        "--paddle-recognition-model-directory", args.paddle_recognition_model_directory,
    ]
    environment = {
        key: value for key, value in os.environ.items()
        if key.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"}
    }
    environment["PYTHONPATH"] = str(Path(__file__).resolve().parents[2])
    environment["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
    options: dict[str, Any] = {
        "stdin": subprocess.DEVNULL, "stdout": subprocess.PIPE, "stderr": subprocess.PIPE,
        "env": environment, "shell": False,
    }
    if sys.platform == "win32":
        options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    else:
        options["start_new_session"] = True
    process = subprocess.Popen(command, **options)
    try:
        stdout, stderr = process.communicate(timeout=150)
    except subprocess.TimeoutExpired as error:
        _terminate_tree(process)
        raise RuntimeError("PRIMARY_STAGE_TIMEOUT") from error
    except BaseException:
        _terminate_tree(process)
        raise
    if process.returncode != 0 or len(stdout) > MAX_STAGE_RESPONSE_BYTES or len(stderr) > 64 * 1024:
        raise RuntimeError("PRIMARY_STAGE_FAILED")
    marker = b"MEDDECODE_STAGED_EVIDENCE:"
    marker_index = stdout.rfind(marker)
    if marker_index < 0:
        raise RuntimeError("PRIMARY_STAGE_INVALID")
    payload = json.loads(stdout[marker_index + len(marker):])
    if payload.get("schema_version") != PROTOCOL_VERSION or payload.get("status") != "ok":
        raise RuntimeError("PRIMARY_STAGE_INVALID")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--local-pdf-path", required=True)
    parser.add_argument("--ocr-provider", default="easyocr")
    parser.add_argument("--easyocr-model-directory", required=True)
    parser.add_argument("--adaptive-ocr", action="store_true")
    parser.add_argument("--paddle-detection-model-directory", required=True)
    parser.add_argument("--paddle-recognition-model-directory", required=True)
    parser.add_argument("--trocr", action="store_true")
    parser.add_argument("--trocr-python", required=True)
    parser.add_argument("--trocr-model-directory", required=True)
    parser.add_argument("--trocr-timeout-seconds", type=float, default=20.0)
    parser.add_argument("--max-process-tree-rss-bytes", type=int, default=2 * 1024**3)
    parser.add_argument("--official-catalogue", action="store_true")
    args = parser.parse_args(argv)
    request: dict[str, Any] | None = None
    connection = None
    try:
        raw = sys.stdin.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            return 2
        request = validate_request(json.loads(raw))
        if not args.adaptive_ocr or not args.trocr or not args.official_catalogue:
            raise RuntimeError("STAGED_CONFIGURATION_REQUIRED")
        primary = _run_primary_stage(args, request["document"]["file_type"])
        provider = TrOCRSubprocessProvider(TrOCRSubprocessConfig(
            interpreter=Path(args.trocr_python), model_directory=Path(args.trocr_model_directory),
            timeout_seconds=args.trocr_timeout_seconds,
            max_process_tree_rss_bytes=args.max_process_tree_rss_bytes,
            memory_reserve_bytes=STAGED_TROCR_RESERVE_BYTES,
        ))
        hybrid_pages: list[HybridOCRPageResult] = []
        for page in primary["pages"]:
            predictions = [
                *predictions_from_json(page["primary_predictions"]),
                *predictions_from_json(page["secondary_predictions"]),
            ]
            trocr_predictions = ()
            trocr_status = "not_needed"
            if page["handwriting_classification"] == "possible" and page["fallback_regions"]:
                regions = tuple(region_from_json(item) for item in page["fallback_regions"])
                try:
                    trocr_predictions = tuple(provider.recognize_regions(
                        regions, int(page["page_number"]), args.trocr_timeout_seconds,
                    ))
                except TrOCRIPCError:
                    trocr_predictions = ()
                trocr_status = provider.last_status_code
            predictions.extend(trocr_predictions)
            warnings = [*(f"Adaptive OCR quality signal: {item}." for item in page["quality_reasons"]), *page["warnings"]]
            if trocr_status not in {"not_needed", "ok"}:
                warnings.append("Handwritten line OCR was unavailable or withheld by its resource policy; existing local OCR evidence was retained.")
            if trocr_predictions:
                warnings.append("Local handwriting OCR evidence was reconciled conservatively with primary OCR evidence.")
            hybrid_pages.append(HybridOCRPageResult(
                page_number=int(page["page_number"]), predictions=tuple(predictions),
                regions=tuple(_reconcile(predictions)), failures=(), elapsed_ms=0.0,
                review_warnings=tuple(dict.fromkeys(warnings)),
            ))

        # Catalogue and Layers 2-5 start only after both native OCR stages have
        # exited, keeping their memory out of the provider overlap window.
        from app.database.catalogue_connection import connect_catalogue
        from app.integration.contract_v1_mapper import map_contract_v1
        from app.integration.offline_pipeline import run_offline_pipeline
        from app.layer4_medicine_intelligence.runtime.official_catalogue_provider import LocalOfficialCatalogueMedicineRepository
        connection = connect_catalogue()
        repository = LocalOfficialCatalogueMedicineRepository(connection)
        pages = [page.to_ocr_page_result() for page in hybrid_pages]
        with redirect_stdout(StringIO()):
            result = run_offline_pipeline(pages, repository)
            output = map_contract_v1(request, result, source_mode="local_pdf_official_catalogue")
        counts = {
            name: sum(1 for page in hybrid_pages for item in page.predictions if item.engine_name == name)
            for name in ("easyocr", "paddleocr", "trocr_base_handwritten")
        }
        if os.environ.get("MEDDECODE_SAFE_OCR_DIAGNOSTICS") == "1":
            print(f"SAFE_OCR_ROUTE:EASYOCR={counts['easyocr']}:PADDLEOCR={counts['paddleocr']}:TROCR={counts['trocr_base_handwritten']}", file=sys.stderr)
    except (json.JSONDecodeError, ContractError):
        return 2
    except Exception as error:
        print(f"SAFE_WORKER_FAILURE:STAGED_PIPELINE:{type(error).__name__.upper()}", file=sys.stderr)
        if request is None:
            return 3
        output = _failure(request)
    finally:
        if connection is not None:
            connection.close()
    sys.stdout.write(json.dumps(output, separators=(",", ":"), allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
