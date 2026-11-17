"""Explicit, fictional-only local PDF worker for Node integration tests.

This module never runs OCR. It renders a user-supplied *marked synthetic PDF*
and injects deterministic fixture OCR so the Node subprocess boundary can be
tested without representing fixture data as genuine document recognition.
"""

from __future__ import annotations

import argparse
import json
import sys
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from typing import Any

from app.integration.contract_v1 import ContractError, failure, validate_request
from app.schemas.ocr import OCRBlock, OCRPageResult

with redirect_stdout(StringIO()):
    import pymupdf
    from app.integration.local_pdf_pipeline import (
        LocalPdfProcessingError,
        process_local_pdf_to_contract_v1,
    )

MAX_INPUT_BYTES = 1024 * 1024
FIXTURE_NAME = "synthetic-prescription-001.pdf"
FIXTURE_MARKERS = (b"MEDDECODE SYNTHETIC INTEGRATION TEST", b"NOT A REAL PRESCRIPTION")


class FictionalInjectedOcr:
    """Deterministic fixture text; it is never presented as genuine OCR."""

    def process_page(self, _image: object) -> OCRPageResult:
        lines = ("Rx", "Examplemed 10 mg", "One tablet once daily for 3 days")
        return OCRPageResult(
            full_text="\n".join(lines),
            blocks=[
                OCRBlock(
                    text=line,
                    confidence=1.0,
                    bounding_box=[[0.0, index * 20.0], [500.0, index * 20.0], [500.0, index * 20.0 + 10.0], [0.0, index * 20.0 + 10.0]],
                )
                for index, line in enumerate(lines)
            ],
        )


def _fixture_path(value: str) -> Path:
    path = Path(value).expanduser().resolve()
    if path.name != FIXTURE_NAME:
        raise LocalPdfProcessingError("The development worker accepts only the approved fictional fixture.")
    try:
        document = pymupdf.open(path)
        sample = "".join(page.get_text() for page in document)
        document.close()
    except OSError as error:
        raise LocalPdfProcessingError("The approved fictional fixture is unavailable.") from error
    if not all(marker.decode("ascii") in sample for marker in FIXTURE_MARKERS):
        raise LocalPdfProcessingError("The supplied PDF is not the marked fictional fixture.")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--fictional-fixture-pdf", required=True)
    parser.add_argument("--injected-ocr-fixture", action="store_true")
    args = parser.parse_args(argv)
    request: dict[str, Any] | None = None
    try:
        if not args.injected_ocr_fixture:
            return 2
        payload = sys.stdin.read(MAX_INPUT_BYTES + 1)
        if len(payload) > MAX_INPUT_BYTES:
            return 2
        value = json.loads(payload)
        request = validate_request(value)
        output = process_local_pdf_to_contract_v1(
            pdf_path=_fixture_path(args.fictional_fixture_pdf),
            job_id=request["job_id"],
            prescription_id=request["prescription_id"],
            ocr_engine=FictionalInjectedOcr(),
            source_mode="local_pdf_injected_fixture",
        )
    except (json.JSONDecodeError, ContractError, LocalPdfProcessingError) as error:
        if isinstance(locals().get("value"), dict):
            output = failure(value, "Invalid local development fixture request.")
        else:
            return 2
    except Exception:
        if request is None:
            return 3
        output = failure(request, "Local development fixture processing failed safely.")
    sys.stdout.write(json.dumps(output, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
