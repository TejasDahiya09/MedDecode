from __future__ import annotations

from pathlib import Path

import fitz
import pytest
from PIL import Image

from app.integration.local_pdf_pipeline import (
    LocalPdfProcessingError,
    _bound_ocr_image,
    process_local_pdf_to_contract_v1,
    process_local_pdf_with_hybrid_ocr_to_contract_v1,
)
from app.layer1_document_processing.hybrid_ocr import (
    HybridOCREngine,
    OCRPrediction,
)
from app.schemas.ocr import OCRBlock, OCRPageResult


JOB_ID = "11111111-1111-4111-8111-111111111111"
PRESCRIPTION_ID = "22222222-2222-4222-8222-222222222222"


def _pdf(path: Path) -> Path:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "MEDDECODE SYNTHETIC LOCAL PDF TEST")
    document.save(path)
    document.close()
    return path


def _fictional_pages() -> list[OCRPageResult]:
    lines = [
        "Dr. Test Only",
        "Fictional Test Clinic",
        "Date: 2099-01-01",
        "Patient Name: Synthetic Patient 001",
        "Age: 30",
        "Gender: Other",
        "Rx",
        "Tab Examplemed 10 mg",
        "1-0-0 for 3 days",
    ]
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
    def __init__(self, pages: list[OCRPageResult] | None = None, error: Exception | None = None) -> None:
        self.pages = _fictional_pages() if pages is None else pages
        self.error = error
        self.images: list[object] = []

    def process_page(self, image: object) -> OCRPageResult:
        self.images.append(image)
        if self.error is not None:
            raise self.error
        if not self.pages:
            return object()  # type: ignore[return-value]
        return self.pages[len(self.images) - 1]


def test_local_pdf_path_uses_injected_ocr_and_maps_contract_v1(tmp_path: Path) -> None:
    pdf_path = _pdf(tmp_path / "fictional.pdf")
    engine = FakeOcrEngine()

    response = process_local_pdf_to_contract_v1(
        pdf_path=pdf_path,
        job_id=JOB_ID,
        prescription_id=PRESCRIPTION_ID,
        ocr_engine=engine,
    )

    assert len(engine.images) == 1
    assert getattr(engine.images[0], "mode") == "RGB"
    assert response["schema_version"] == "1.0"
    assert response["job_id"] == JOB_ID
    assert response["prescription_id"] == PRESCRIPTION_ID
    assert response["status"] == "completed_with_warnings"
    assert response["medicines"][0]["medicine_match"]["brand_name"] == "Examplemed"
    assert response["warnings"][0]["code"] == "LOCAL_PDF_FICTIONAL_CATALOGUE"
    assert str(pdf_path.resolve()) not in str(response)
    assert "file_url" not in response


@pytest.mark.parametrize("name, contents", [("missing.pdf", None), ("not-a-pdf.txt", b"plain text"), ("invalid.pdf", b"not a PDF")])
def test_local_pdf_path_validation_rejects_missing_or_invalid_input(tmp_path: Path, name: str, contents: bytes | None) -> None:
    path = tmp_path / name
    if contents is not None:
        path.write_bytes(contents)

    with pytest.raises(LocalPdfProcessingError):
        process_local_pdf_to_contract_v1(
            pdf_path=path,
            job_id=JOB_ID,
            prescription_id=PRESCRIPTION_ID,
            ocr_engine=FakeOcrEngine(),
        )


def test_ocr_failure_is_reported_without_synthetic_fallback(tmp_path: Path) -> None:
    pdf_path = _pdf(tmp_path / "fictional.pdf")
    engine = FakeOcrEngine(error=RuntimeError("deliberate test failure"))

    with pytest.raises(LocalPdfProcessingError, match="OCR processing failed"):
        process_local_pdf_to_contract_v1(
            pdf_path=pdf_path,
            job_id=JOB_ID,
            prescription_id=PRESCRIPTION_ID,
            ocr_engine=engine,
        )

    assert len(engine.images) == 1


def test_empty_or_malformed_ocr_output_is_rejected(tmp_path: Path) -> None:
    pdf_path = _pdf(tmp_path / "fictional.pdf")

    with pytest.raises(LocalPdfProcessingError, match="no valid page"):
        process_local_pdf_to_contract_v1(
            pdf_path=pdf_path,
            job_id=JOB_ID,
            prescription_id=PRESCRIPTION_ID,
            ocr_engine=FakeOcrEngine(pages=[]),
        )


def test_blank_ocr_page_is_rejected(tmp_path: Path) -> None:
    pdf_path = _pdf(tmp_path / "blank-scan.pdf")
    blank_ocr_page = OCRPageResult(full_text="", blocks=[])

    with pytest.raises(LocalPdfProcessingError, match="no usable OCR text"):
        process_local_pdf_to_contract_v1(
            pdf_path=pdf_path,
            job_id=JOB_ID,
            prescription_id=PRESCRIPTION_ID,
            ocr_engine=FakeOcrEngine(pages=[blank_ocr_page]),
        )


def test_conflicting_hybrid_ocr_is_not_reported_as_success(tmp_path: Path) -> None:
    class StaticProvider:
        def __init__(self, engine_name: str, text: str) -> None:
            self.engine_name = engine_name
            self.text = text

        def recognize(self, _image, page_number: int, _timeout_seconds: float):
            return [
                OCRPrediction(
                    self.engine_name,
                    "test",
                    page_number,
                    self.text,
                    ((10.0, 10.0), (200.0, 10.0), (200.0, 30.0), (10.0, 30.0)),
                    0.9,
                    model_provenance="test",
                )
            ]

    hybrid_ocr = HybridOCREngine(
        [
            StaticProvider("engine-a", "Examplemed 10 mg"),
            StaticProvider("engine-b", "Examplemed 40 mg"),
        ]
    )

    with pytest.raises(LocalPdfProcessingError, match="no usable OCR text"):
        process_local_pdf_with_hybrid_ocr_to_contract_v1(
            pdf_path=_pdf(tmp_path / "conflicting-scan.pdf"),
            job_id=JOB_ID,
            prescription_id=PRESCRIPTION_ID,
            hybrid_ocr=hybrid_ocr,
        )


def test_ocr_image_normalization_bounds_pixels_without_upscaling() -> None:
    large = Image.new("RGB", (2000, 1500), "white")
    bounded = _bound_ocr_image(large, 1_000_000)
    already_bounded = Image.new("RGB", (800, 600), "white")

    assert bounded.width * bounded.height <= 1_000_000
    assert bounded.width / bounded.height == pytest.approx(4 / 3, rel=0.01)
    assert _bound_ocr_image(already_bounded, 1_000_000).size == (800, 600)
