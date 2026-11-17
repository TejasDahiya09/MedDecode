from __future__ import annotations

import argparse
import json
import math
import statistics
import time
import unicodedata
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]

from app.layer1_document_processing.hybrid_ocr import (
    EasyOCRProvider,
    HybridOCREngine,
    OCRPrediction,
)
from app.layer1_document_processing.pipeline import process_document


DEMO_DIR = ROOT / "frontend" / "public" / "demo" / "phase-d1"
EXPECTED_OUTPUT = DEMO_DIR / "expected-output.json"
PDF = DEMO_DIR / "sample-prescription.pdf"
DEFAULT_REPORT = ROOT / "demos" / "phase-d1" / "ocr-evaluation.json"
PAGE_HEIGHT_POINTS = 842
ROW_START_POINTS = 211
ROW_STEP_POINTS = 96
ROW_TOP_INSET_POINTS = -14
ROW_BOTTOM_INSET_POINTS = 73
PDF_DPI = 120


def _package_version(package: str) -> str:
    try:
        return version(package)
    except PackageNotFoundError:
        return "not-installed"


def _normalized_alphanumeric(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return "".join(character for character in normalized if character.isalnum())


def _prediction_center_y(prediction: OCRPrediction) -> float | None:
    if not prediction.polygon:
        return None
    return statistics.fmean(point[1] for point in prediction.polygon)


def _row_predictions(
    predictions: tuple[OCRPrediction, ...],
    row_index: int,
    page_height: int,
) -> list[OCRPrediction]:
    scale = page_height / PAGE_HEIGHT_POINTS
    row_start = ROW_START_POINTS + row_index * ROW_STEP_POINTS
    upper = (row_start + ROW_TOP_INSET_POINTS) * scale
    lower = (row_start + ROW_BOTTOM_INSET_POINTS) * scale
    return sorted(
        (
            prediction
            for prediction in predictions
            if (center_y := _prediction_center_y(prediction)) is not None
            and upper <= center_y <= lower
        ),
        key=lambda prediction: (
            _prediction_center_y(prediction) or 0.0,
            min((point[0] for point in prediction.polygon or ()), default=0.0),
        ),
    )


def _model_assets_present(directory: Path) -> bool:
    candidates = (directory, directory / "model")
    return any(
        candidate.is_dir()
        and all((candidate / filename).is_file() for filename in ("craft_mlt_25k.pth", "english_g2.pth"))
        for candidate in candidates
    )


def evaluate(model_directory: Path, report_path: Path) -> dict[str, Any]:
    expected: dict[str, Any] = json.loads(EXPECTED_OUTPUT.read_text(encoding="utf-8"))
    expected_medicines: list[dict[str, Any]] = expected["expected_medicines"]
    if not PDF.is_file():
        raise FileNotFoundError(f"Generated sample PDF is unavailable: {PDF}")
    if not _model_assets_present(model_directory):
        raise FileNotFoundError(f"Required local EasyOCR model assets are unavailable: {model_directory}")

    provider = EasyOCRProvider(
        model_storage_directory=model_directory,
        languages=("en",),
    )
    engine = HybridOCREngine(
        whole_page_providers=(provider,),
        max_parallel_providers=1,
        per_engine_timeout_seconds=60.0,
    )
    render_started = time.perf_counter()
    images = process_document(str(PDF), pdf_dpi=PDF_DPI)
    render_elapsed_ms = (time.perf_counter() - render_started) * 1000
    if len(images) != 1:
        raise RuntimeError(f"Expected a single rendered sample page; received {len(images)}.")

    page_results = []
    recognition_started = time.perf_counter()
    for page_number, image in enumerate(images, start=1):
        page_results.append(engine.recognize_page(image, page_number))
    recognition_elapsed_ms = (time.perf_counter() - recognition_started) * 1000

    field_results: list[dict[str, Any]] = []
    for row_index, medicine in enumerate(expected_medicines):
        row_text = " ".join(
            prediction.text
            for page_result in page_results
            for prediction in _row_predictions(page_result.predictions, row_index, images[0].height)
        )
        normalized_row = _normalized_alphanumeric(row_text)
        fields = {
            "medicine_name": medicine["medicine_name"],
            "strength": medicine["strength"],
            "dosage_form": medicine["dosage_form"],
            "dosage_not_specified": medicine["dosage_statement"],
            "catalogue_record_id": medicine["catalogue_record_id"],
        }
        field_matches = {
            field_name: _normalized_alphanumeric(expected_value) in normalized_row
            for field_name, expected_value in fields.items()
        }
        field_results.append({
            "source_record_id": medicine["catalogue_record_id"],
            "field_matches": field_matches,
            "matched_field_count": sum(field_matches.values()),
            "expected_field_count": len(field_matches),
            "recognized_row_text": row_text,
        })

    predictions = [
        prediction
        for page_result in page_results
        for prediction in page_result.predictions
    ]
    confidences = [
        prediction.raw_confidence
        for prediction in predictions
        if prediction.raw_confidence is not None and math.isfinite(prediction.raw_confidence)
    ]
    expected_field_count = sum(result["expected_field_count"] for result in field_results)
    matched_field_count = sum(result["matched_field_count"] for result in field_results)
    report: dict[str, Any] = {
        "evaluation": "local_layer1_render_and_hybrid_ocr",
        "scope": "Generated, clearly printed academic demonstration only; not handwriting or clinical accuracy.",
        "input_pdf": str(PDF.relative_to(ROOT)),
        "pdf_dpi": PDF_DPI,
        "page_count": len(images),
        "image_size_pixels": [list(image.size) for image in images],
        "engine": "EasyOCRProvider through HybridOCREngine",
        "download_enabled": False,
        "model_assets": "Local EasyOCR assets are present; the host-specific filesystem path is omitted.",
        "package_versions": {
            "easyocr": _package_version("easyocr"),
            "torch": _package_version("torch"),
            "PyMuPDF": _package_version("PyMuPDF"),
            "Pillow": _package_version("Pillow"),
        },
        "engine_versions_reported": sorted({prediction.engine_version for prediction in predictions}),
        "model_provenance": sorted({prediction.model_provenance for prediction in predictions}),
        "runtime_ms": {
            "pdf_rendering": round(render_elapsed_ms, 2),
            "ocr_recognition_including_hybrid_processing": round(recognition_elapsed_ms, 2),
            "easyocr_initialization": (
                round(provider.initialization_elapsed_ms, 2)
                if provider.initialization_elapsed_ms is not None
                else None
            ),
            "hybrid_page_elapsed": [
                round(page_result.elapsed_ms, 2)
                for page_result in page_results
            ],
        },
        "confidence": {
            "prediction_count": len(confidences),
            "mean_raw_prediction_confidence": round(statistics.fmean(confidences), 4) if confidences else None,
            "minimum_raw_prediction_confidence": round(min(confidences), 4) if confidences else None,
            "maximum_raw_prediction_confidence": round(max(confidences), 4) if confidences else None,
            "note": "Raw engine confidences are not calibrated probabilities.",
        },
        "field_accuracy": {
            "matched": matched_field_count,
            "expected": expected_field_count,
            "percentage": round(100 * matched_field_count / expected_field_count, 2) if expected_field_count else None,
            "method": "Each expected field must occur as an exact contiguous match after Unicode NFKC, case-folding, and removal of punctuation/spacing, within its printed record row.",
            "fields": field_results,
        },
        "limitations": [
            "This is a single generated digital PDF with large, clearly printed text.",
            "It does not measure handwriting, camera capture, real prescriptions, clinical entity resolution, or safety.",
            "Field accuracy is specific to this sample and must not be generalized to production documents.",
        ],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure local HybridOCR on the fictional Phase D.1 PDF.")
    parser.add_argument(
        "--model-directory",
        type=Path,
        default=Path.home() / ".EasyOCR" / "model",
    )
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    arguments = parser.parse_args()
    result = evaluate(arguments.model_directory, arguments.report)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
