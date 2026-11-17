"""Stage 1/2 worker: bounded rendering and EasyOCR/PaddleOCR only.

The process exits after emitting bounded evidence, which is the memory-release
boundary required before an isolated TrOCR model may be loaded.
"""

from __future__ import annotations

import argparse
import json
import sys
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

with redirect_stdout(StringIO()):
    from app.integration.local_pdf_pipeline import _load_validated_document
    from app.integration.staged_ocr_protocol import (
        MAX_STAGE_RESPONSE_BYTES,
        PROTOCOL_VERSION,
        prediction_to_json,
        region_to_json,
    )
    from app.layer1_document_processing.adaptive_ocr_integration import (
        _MemoryBoundEasyOCRProvider,
    )
    from app.layer1_document_processing.adaptive_ocr import AdaptiveOCRRouter
    from app.layer1_document_processing.hybrid_ocr import PaddleOCRProvider
    from app.layer1_document_processing.ocr_engine import PaddleOCRLocalModelConfig


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--document-path", required=True)
    parser.add_argument("--file-type", required=True)
    parser.add_argument("--easyocr-model-directory", required=True)
    parser.add_argument("--paddle-detection-model-directory", required=True)
    parser.add_argument("--paddle-recognition-model-directory", required=True)
    args = parser.parse_args(argv)
    paddle = PaddleOCRLocalModelConfig(
        text_detection_model_dir=Path(args.paddle_detection_model_directory),
        text_recognition_model_dir=Path(args.paddle_recognition_model_directory),
    )
    paddle.validate()
    router = AdaptiveOCRRouter(
        primary_provider=_MemoryBoundEasyOCRProvider(
            model_storage_directory=Path(args.easyocr_model_directory),
        ),
        secondary_provider=PaddleOCRProvider(paddle),
        handwritten_provider=None,
    )
    pages: list[dict[str, object]] = []
    with redirect_stdout(StringIO()):
        images = _load_validated_document(args.document_path, args.file_type, 120)
        for page_number, image in enumerate(images, 1):
            routed = router.route(image, page_number, timeout_seconds=60.0)
            pages.append({
                "page_number": page_number,
                "primary_predictions": [prediction_to_json(item) for item in routed.primary_predictions],
                "secondary_predictions": [prediction_to_json(item) for item in routed.secondary_predictions],
                "fallback_regions": [region_to_json(item) for item in routed.fallback_regions[:4]],
                "quality_reasons": list(routed.quality.reasons),
                "handwriting_classification": routed.quality.handwriting_classification,
                "warnings": list(routed.warnings),
            })
    payload = json.dumps(
        {"schema_version": PROTOCOL_VERSION, "status": "ok", "pages": pages},
        separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    if len(payload) > MAX_STAGE_RESPONSE_BYTES:
        return 4
    # Native Paddle libraries may write notices directly to the process file
    # descriptor, bypassing redirect_stdout. The coordinator therefore reads
    # only the final versioned marker and never forwards preceding output.
    sys.stdout.buffer.write(b"\nMEDDECODE_STAGED_EVIDENCE:" + payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
