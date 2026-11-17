"""Machine-readable local harness for explicitly fictional documents only."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv

from app.integration.document_safety import DocumentSafetyError, DocumentSafetyLimits, validate_staged_document
from app.integration.ocr_runtime_config import AdaptiveOCRSettings, TrOCRSettings
from app.integration.process_supervisor import ProcessingSupervisor, SupervisionError

load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)


async def _run(args: argparse.Namespace) -> dict:
    path = Path(args.document).resolve()
    limits = DocumentSafetyLimits.from_environment()
    validate_staged_document(path, args.file_type, limits)
    model = Path(os.environ.get("MEDDECODE_EASYOCR_MODEL_DIRECTORY", "")).expanduser()
    if not model.is_dir():
        raise RuntimeError("EasyOCR model directory is unavailable")
    metadata = {
        "schema_version": "1.0", "job_id": str(uuid4()), "prescription_id": str(uuid4()),
        "document": {"access_type": "authorized_url", "file_url": "https://fictional.invalid/local-document", "file_type": args.file_type},
        "requested_analysis": {"extract_prescription": True, "match_medicines": True, "find_alternatives": False, "generate_recommendations": True},
    }
    adaptive_settings = AdaptiveOCRSettings.from_environment()
    trocr_settings = TrOCRSettings.from_environment(adaptive_enabled=adaptive_settings.enabled)
    supervisor = ProcessingSupervisor(
        limits,
        model,
        adaptive_ocr_enabled=adaptive_settings.enabled,
        paddle_detection_model_directory=adaptive_settings.paddle_detection_model_directory,
        paddle_recognition_model_directory=adaptive_settings.paddle_recognition_model_directory,
        trocr_enabled=trocr_settings.enabled,
        trocr_interpreter=trocr_settings.interpreter,
        trocr_model_directory=trocr_settings.model_directory,
        trocr_timeout_seconds=trocr_settings.timeout_seconds,
        safe_ocr_diagnostics=True,
        preprocessing_enabled=os.environ.get("MEDDECODE_DOCUMENT_PREPROCESSING_ENABLED") == "true",
    )
    try:
        result = await supervisor.run(path, metadata)
    finally:
        await supervisor.shutdown()
    payload = result.payload
    if args.contract_output:
        output_path = Path(args.contract_output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    return {
        "status": "passed" if payload.get("status") in {"completed", "completed_with_warnings"} else "failed",
        "contract_status": payload.get("status"), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "document_bytes": path.stat().st_size, "elapsed_ms": result.elapsed_ms,
        "peak_child_rss_bytes": result.peak_rss_bytes,
        "adaptive_ocr_enabled": adaptive_settings.enabled,
        "trocr_enabled": trocr_settings.enabled,
        "medicine_count": len(payload.get("medicines", [])) if isinstance(payload.get("medicines"), list) else 0,
        "warning_count": len(payload.get("warnings", [])) if isinstance(payload.get("warnings"), list) else 0,
        "error_category": result.diagnostic_code,
        "provider_counts": result.provider_counts,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--document", required=True)
    parser.add_argument("--file-type", required=True, choices=("application/pdf", "image/jpeg", "image/png"))
    parser.add_argument("--fictional-confirmed", action="store_true")
    parser.add_argument("--contract-output")
    args = parser.parse_args(argv)
    if not args.fictional_confirmed:
        print(json.dumps({"status": "rejected", "error_category": "FICTIONAL_CONFIRMATION_REQUIRED"}))
        return 2
    try:
        output = asyncio.run(_run(args))
    except DocumentSafetyError as error:
        output = {"status": "rejected", "error_category": error.code}
    except SupervisionError as error:
        output = {"status": "failed", "error_category": error.code}
        if hasattr(error, "return_code"):
            output["child_return_code"] = error.return_code
            output["child_diagnostic"] = error.diagnostic_code
    except Exception:
        output = {"status": "failed", "error_category": "HARNESS_CONFIGURATION_OR_RUNTIME"}
    print(json.dumps(output, separators=(",", ":"), allow_nan=False))
    return 0 if output["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
