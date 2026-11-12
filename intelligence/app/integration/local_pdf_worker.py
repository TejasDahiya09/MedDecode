"""Real local-PDF Contract-v1 worker entry point.

The document path is deliberately supplied only by the Node worker after an
authorized private-object download. This module never uses fixture OCR and does
not download documents itself.
"""

from __future__ import annotations

import argparse
import json
import sys
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from typing import Any

from app.integration.contract_v1 import ContractError, validate_request

# Some optional document libraries emit import-time notices to stdout. Stdout
# is this worker's Contract-v1 JSON channel, so suppress library import noise.
with redirect_stdout(StringIO()):
    from app.integration.local_pdf_pipeline import (
        LocalPdfProcessingError,
        process_local_pdf_with_hybrid_ocr_to_contract_v1,
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
    parser.add_argument("--aws-region")
    args = parser.parse_args(argv)
    request: dict[str, Any] | None = None
    try:
        payload = sys.stdin.read(MAX_INPUT_BYTES + 1)
        if len(payload) > MAX_INPUT_BYTES:
            return 2
        request = validate_request(json.loads(payload))
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
        hybrid_ocr = HybridOCREngine(
            whole_page_providers=(provider,),
            max_parallel_providers=1,
        )
        # Provider/library output must not leak into the stdout JSON channel.
        with redirect_stdout(StringIO()):
            output, pages = process_local_pdf_with_hybrid_ocr_to_contract_v1(
                pdf_path=args.local_pdf_path,
                job_id=request["job_id"],
                prescription_id=request["prescription_id"],
                hybrid_ocr=hybrid_ocr,
            )
        if any(page.failures for page in pages) or not any(page.predictions for page in pages):
            raise LocalPdfProcessingError("EasyOCR did not produce a usable result.")
    except (json.JSONDecodeError, ContractError):
        return 2
    except LocalPdfProcessingError:
        if request is None:
            return 3
        output = _failure(request, "PROCESSING_FAILED")
    except Exception:
        if request is None:
            return 3
        output = _failure(request, "PROCESSING_FAILED")
    sys.stdout.write(json.dumps(output, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
