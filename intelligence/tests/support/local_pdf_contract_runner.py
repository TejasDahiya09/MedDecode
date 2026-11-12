"""Test-only subprocess fixture for backend Contract v1 validation.

It creates a temporary fictional PDF and injects deterministic OCR pages into
the local-PDF entry point. It must not initialize PaddleOCR or contact a
service; the parent backend test consumes stdout without logging it.
"""

from __future__ import annotations

import json
import sys
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

with redirect_stdout(StringIO()):
    import pymupdf as fitz

# Running this support file directly makes its containing directory the first
# import location; restore the intelligence project root before importing app.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

with redirect_stdout(StringIO()):
    from app.integration.local_pdf_pipeline import process_local_pdf_to_contract_v1
from app.schemas.ocr import OCRBlock, OCRPageResult


def _pages() -> list[OCRPageResult]:
    lines = ["Rx", "Tab Examplemed 10 mg", "1-0-0 for 3 days"]
    return [
        OCRPageResult(
            full_text="\n".join(lines),
            blocks=[
                OCRBlock(
                    text=line,
                    confidence=0.99,
                    bounding_box=[[0.0, index * 20.0], [500.0, index * 20.0], [500.0, index * 20.0 + 10.0], [0.0, index * 20.0 + 10.0]],
                )
                for index, line in enumerate(lines)
            ],
        )
    ]


class FakeOcrEngine:
    def process_page(self, _image: object) -> OCRPageResult:
        return _pages()[0]


def main() -> int:
    request = json.loads(sys.stdin.read())
    with TemporaryDirectory() as directory:
        pdf_path = Path(directory) / "fictional.pdf"
        document = fitz.open()
        page = document.new_page()
        page.insert_text((72, 72), "MEDDECODE SYNTHETIC LOCAL PDF TEST")
        document.save(pdf_path)
        document.close()
        response = process_local_pdf_to_contract_v1(
            pdf_path=pdf_path,
            job_id=request["job_id"],
            prescription_id=request["prescription_id"],
            ocr_engine=FakeOcrEngine(),
        )
    print(json.dumps(response))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
