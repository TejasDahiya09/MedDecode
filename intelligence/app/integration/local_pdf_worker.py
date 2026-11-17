"""Real local-PDF Contract-v1 worker entry point.

The document path is deliberately supplied only by the Node worker after an
authorized private-object download. This module never uses fixture OCR and does
not download documents itself.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from typing import Any

from app.integration.contract_v1 import ContractError, validate_request
from app.database.catalogue_connection import (
    CatalogueConfigurationError,
    classify_catalogue_connection_error,
    connect_catalogue,
)

# Some optional document libraries emit import-time notices to stdout. Stdout
# is this worker's Contract-v1 JSON channel, so suppress library import noise.
with redirect_stdout(StringIO()):
    from app.integration.local_pdf_pipeline import (
        LocalPdfProcessingError,
        process_local_pdf_with_hybrid_ocr_to_contract_v1,
    )
    from app.layer1_document_processing.adaptive_ocr_integration import (
        build_adaptive_easy_paddle_engine,
    )
    from app.layer1_document_processing.hybrid_ocr import AwsTextractProvider, EasyOCRProvider, HybridOCREngine
    from app.layer1_document_processing.google_vision_provider import GoogleVisionProvider

MAX_INPUT_BYTES = 1024 * 1024


def _failure(request: dict[str, Any], code: str) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "job_id": request["job_id"],
        "prescription_id": request["prescription_id"],
        "status": "failed",
        "error": {
            "code": code,
            "message": "Local prescription processing failed safely.",
            "retryable": code == "PROCESSING_FAILED",
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--local-pdf-path", required=True)
    parser.add_argument(
        "--ocr-provider",
        choices=("easyocr", "aws-textract", "google-cloud-vision"),
        default="easyocr",
    )
    parser.add_argument("--easyocr-model-directory")
    parser.add_argument("--adaptive-ocr", action="store_true")
    parser.add_argument("--preprocessing", action="store_true")
    parser.add_argument("--paddle-detection-model-directory")
    parser.add_argument("--paddle-recognition-model-directory")
    parser.add_argument("--trocr", action="store_true")
    parser.add_argument("--trocr-python")
    parser.add_argument("--trocr-model-directory")
    parser.add_argument("--trocr-timeout-seconds", type=float, default=20.0)
    parser.add_argument("--max-process-tree-rss-bytes", type=int, default=2 * 1024 * 1024 * 1024)
    parser.add_argument("--aws-region")
    parser.add_argument(
        "--official-catalogue",
        dest="official_catalogue",
        action="store_true",
    )
    parser.add_argument("--official-catalogue-local", action="store_true")
    args = parser.parse_args(argv)
    request: dict[str, Any] | None = None
    failure_stage = "REQUEST"
    try:
        payload = sys.stdin.read(MAX_INPUT_BYTES + 1)
        if len(payload) > MAX_INPUT_BYTES:
            return 2
        request = validate_request(json.loads(payload))
        failure_stage = "OCR_CONFIGURATION"
        # A real document must never fall back to the fictional catalogue.
        catalogue_enabled = args.official_catalogue or args.official_catalogue_local
        if not catalogue_enabled:
            raise LocalPdfProcessingError("An official catalogue is required for real processing.")
        if args.ocr_provider == "easyocr":
            if not args.easyocr_model_directory:
                raise LocalPdfProcessingError("EasyOCR local model assets are unavailable.")
            model_directory = Path(args.easyocr_model_directory).expanduser()
            if not model_directory.is_dir():
                raise LocalPdfProcessingError("EasyOCR local model assets are unavailable.")
            provider = EasyOCRProvider(model_storage_directory=model_directory)
        elif args.ocr_provider == "aws-textract":
            if not args.aws_region:
                raise LocalPdfProcessingError("AWS Textract region is required.")
            provider = AwsTextractProvider(enabled=True, region=args.aws_region)
        else:
            provider = GoogleVisionProvider(enabled=True)
        repository = None
        connection = None
        source_mode = "local_pdf"
        if catalogue_enabled:
            failure_stage = "CATALOGUE_CONNECTION"
            from app.layer4_medicine_intelligence.runtime.official_catalogue_provider import LocalOfficialCatalogueMedicineRepository
            connection = connect_catalogue()
            repository = LocalOfficialCatalogueMedicineRepository(connection)
            source_mode = "local_pdf_official_catalogue"
        failure_stage = "OCR_CONFIGURATION"
        if args.adaptive_ocr:
            if args.ocr_provider != "easyocr":
                raise LocalPdfProcessingError("Adaptive OCR supports only the local EasyOCR primary provider.")
            if not args.paddle_detection_model_directory or not args.paddle_recognition_model_directory:
                raise LocalPdfProcessingError("Adaptive OCR local PaddleOCR model assets are unavailable.")
            adaptive_options = dict(
                easyocr_model_directory=model_directory,
                paddle_detection_model_directory=Path(args.paddle_detection_model_directory).expanduser(),
                paddle_recognition_model_directory=Path(args.paddle_recognition_model_directory).expanduser(),
                per_engine_timeout_seconds=60.0,
            )
            if args.trocr:
                adaptive_options.update(
                    trocr_enabled=True,
                    trocr_interpreter=Path(args.trocr_python).expanduser() if args.trocr_python else None,
                    trocr_model_directory=Path(args.trocr_model_directory).expanduser() if args.trocr_model_directory else None,
                    trocr_timeout_seconds=args.trocr_timeout_seconds,
                    max_process_tree_rss_bytes=args.max_process_tree_rss_bytes,
                )
            hybrid_ocr = build_adaptive_easy_paddle_engine(**adaptive_options)
        else:
            hybrid_ocr = HybridOCREngine(
                whole_page_providers=(provider,),
                max_parallel_providers=1,
                # CPU model initialization plus inference can exceed the hybrid
                # coordinator's 15-second interactive default.  The Node worker
                # still owns the subprocess deadline and process-tree cleanup.
                per_engine_timeout_seconds=60.0,
            )
        # Provider/library output must not leak into the stdout JSON channel.
        failure_stage = "FIVE_LAYER_PIPELINE"
        with redirect_stdout(StringIO()):
            call_options = {
                "pdf_path": args.local_pdf_path,
                "job_id": request["job_id"],
                "prescription_id": request["prescription_id"],
                "hybrid_ocr": hybrid_ocr,
                "render_dpi": 120,
                "file_type": request["document"]["file_type"],
            }
            if repository is not None:
                call_options["repository"] = repository
                call_options["source_mode"] = source_mode
            output, pages = process_local_pdf_with_hybrid_ocr_to_contract_v1(
                **call_options,
                use_preprocessing=args.preprocessing,
            )
        provider_counts = {
            "easyocr": sum(
                1 for page in pages for prediction in page.predictions
                if getattr(prediction, "engine_name", None) == "easyocr"
            ),
            "paddleocr": sum(
                1 for page in pages for prediction in page.predictions
                if getattr(prediction, "engine_name", None) == "paddleocr"
            ),
            "trocr": sum(
                1 for page in pages for prediction in page.predictions
                if getattr(prediction, "engine_name", None) == "trocr_base_handwritten"
            ),
        }
        if os.environ.get("MEDDECODE_SAFE_OCR_DIAGNOSTICS") == "1":
            print(
                f"SAFE_OCR_ROUTE:EASYOCR={provider_counts['easyocr']}:PADDLEOCR={provider_counts['paddleocr']}:TROCR={provider_counts['trocr']}",
                file=sys.stderr,
            )
        if any(page.failures for page in pages) or (pages and not any(page.predictions for page in pages)):
            raise LocalPdfProcessingError("EasyOCR did not produce a usable result.")
    except (json.JSONDecodeError, ContractError):
        return 2
    except CatalogueConfigurationError as error:
        print(f"Catalogue configuration error: {error}", file=sys.stderr)
        if request is None:
            return 3
        output = _failure(request, "PROCESSING_FAILED")
    except LocalPdfProcessingError:
        print(f"SAFE_WORKER_FAILURE:{failure_stage}:LOCAL_PROCESSING_ERROR", file=sys.stderr)
        if request is None:
            return 3
        output = _failure(request, "PROCESSING_FAILED")
    except Exception as error:
        category = (
            classify_catalogue_connection_error(error)
            if failure_stage == "CATALOGUE_CONNECTION"
            else type(error).__name__.upper()
        )
        print(f"SAFE_WORKER_FAILURE:{failure_stage}:{category}", file=sys.stderr)
        if request is None:
            return 3
        output = _failure(request, "PROCESSING_FAILED")
    finally:
        if 'connection' in locals() and connection is not None:
            connection.close()
    try:
        serialized_output = json.dumps(output, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError):
        if request is None:
            return 3
        serialized_output = json.dumps(
            _failure(request, "PROCESSING_FAILED"),
            separators=(",", ":"),
            allow_nan=False,
        )
    sys.stdout.write(serialized_output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
