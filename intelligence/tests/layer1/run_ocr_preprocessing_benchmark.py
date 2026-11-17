from __future__ import annotations

import argparse
from collections import Counter
import json
import os
import re
import sys
import tempfile
import threading
import time
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import psutil

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Avoid Paddle's optional network model-source check. The benchmark supplies
# explicit local model directories and must not download weights.
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

from PIL import Image

from app.layer1_document_processing.document_loader import get_document_type
from app.layer1_document_processing.image_processor import load_and_normalize_image
from app.layer1_document_processing.ocr_engine import PaddleOCRLocalModelConfig
from app.layer1_document_processing.pdf_processor import load_pdf_as_images
from app.layer1_document_processing.pipeline import process_document_with_preprocessing
from app.layer1_document_processing.hybrid_ocr import (
    EasyOCRProvider,
    OCRPrediction,
    PaddleOCRProvider,
)
from app.schemas.ocr import OCRBlock, OCRPageResult
from tests.layer1.ocr_accuracy_fixtures import (
    OCRAccuracyFixture,
    build_ocr_accuracy_fixtures,
)


FIELDS = (
    "medicine_names",
    "strengths",
    "units",
    "frequencies",
    "timings",
    "durations",
)


class ProviderPageProcessor:
    def __init__(self, provider: Any, *, name: str) -> None:
        self.provider = provider
        self.name = name
        self.calls: list[float] = []
        self.last_call_ms = 0.0
        self.first_call_ms: float | None = None

    def process_page(self, image: Image.Image) -> OCRPageResult:
        started = time.perf_counter()
        predictions: list[OCRPrediction] = self.provider.recognize(
            image,
            page_number=1,
            timeout_seconds=60.0,
        )
        elapsed_ms = (time.perf_counter() - started) * 1000
        self.last_call_ms = elapsed_ms
        self.calls.append(elapsed_ms)
        if self.first_call_ms is None:
            self.first_call_ms = elapsed_ms
        blocks = [
            OCRBlock(
                text=item.text,
                confidence=float(item.raw_confidence or 0.0),
                bounding_box=[list(point) for point in item.polygon] if item.polygon else [],
            )
            for item in predictions
        ]
        return OCRPageResult(
            full_text="\n".join(block.text for block in blocks),
            blocks=blocks,
        )


class ProcessTreeMemoryMonitor:
    def __init__(self) -> None:
        self._process = psutil.Process()
        self._stop = threading.Event()
        self._peak = 0
        self._thread = threading.Thread(target=self._sample, daemon=True)

    def start(self) -> None:
        self._sample()
        self._thread.start()

    def stop(self) -> dict[str, int]:
        self._stop.set()
        self._thread.join(timeout=2)
        self._sample()
        return {"peak_sampled_rss_bytes": self._peak, "final_tree_rss_bytes": self._tree_rss()}

    def _tree_rss(self) -> int:
        total = 0
        try:
            processes = [self._process, *self._process.children(recursive=True)]
        except psutil.Error:
            processes = [self._process]
        for process in processes:
            try:
                total += process.memory_info().rss
            except psutil.Error:
                continue
        return total

    def _sample(self) -> None:
        self._peak = max(self._peak, self._tree_rss())

    def _run_sample_loop(self) -> None:
        while not self._stop.wait(0.1):
            self._sample()


def _start_monitor() -> ProcessTreeMemoryMonitor:
    monitor = ProcessTreeMemoryMonitor()
    monitor._thread = threading.Thread(target=monitor._run_sample_loop, daemon=True)
    monitor.start()
    return monitor


def _make_provider(
    engine_name: str,
    easyocr_model_directory: Path,
    paddle_detection_directory: Path,
    paddle_recognition_directory: Path,
) -> ProviderPageProcessor:
    if engine_name == "easyocr":
        provider = EasyOCRProvider(
            model_storage_directory=easyocr_model_directory,
            languages=("en",),
        )
        return ProviderPageProcessor(provider, name=engine_name)

    config = PaddleOCRLocalModelConfig(
        text_detection_model_dir=paddle_detection_directory,
        text_recognition_model_dir=paddle_recognition_directory,
        device="cpu",
        enable_mkldnn=False,
    )
    config.validate()
    return ProviderPageProcessor(PaddleOCRProvider(config), name=engine_name)


def _package_version(package: str) -> str:
    try:
        return version(package)
    except PackageNotFoundError:
        return "not-installed"


def _run_fixture(
    fixture: OCRAccuracyFixture,
    engine: ProviderPageProcessor,
) -> dict[str, Any]:
    if get_document_type(str(fixture.path)) == "image":
        original_images = [load_and_normalize_image(str(fixture.path))]
    else:
        original_images = load_pdf_as_images(str(fixture.path), dpi=120)

    baseline: list[dict[str, Any]] = []
    for image in original_images:
        started = time.perf_counter()
        result = engine.process_page(image)
        baseline.append(
            {
                "text": result.full_text,
                "latency_ms": (time.perf_counter() - started) * 1000,
            }
        )

    prepared_document = process_document_with_preprocessing(
        fixture.path,
        ocr_engine=engine,
        pdf_dpi=120,
    )
    prepared = [
        {
            "text": page.result.full_text,
            "route": page.route,
            "latency_ms": engine.last_call_ms if page.route == "raster_ocr" else 0.0,
            "applied_steps": list(page.applied_steps),
            "warnings": list(page.warnings),
        }
        for page in prepared_document.pages
    ]

    raster_indexes = [
        index for index, page in enumerate(prepared)
        if page["route"] == "raster_ocr"
    ]
    native_indexes = [
        index for index, page in enumerate(prepared)
        if page["route"] == "native_pdf_text"
    ]
    baseline_pairs = [
        (fixture.expected_pages[index], baseline[index]["text"])
        for index in raster_indexes
    ]
    prepared_pairs = [
        (fixture.expected_pages[index], prepared[index]["text"])
        for index in raster_indexes
    ]
    native_pairs = [
        (fixture.expected_pages[index], prepared[index]["text"])
        for index in native_indexes
    ]
    return {
        "id": fixture.identifier,
        "document_type": fixture.document_type,
        "writing_style": fixture.writing_style,
        "expected_pages": list(fixture.expected_pages),
        "baseline_ocr": baseline,
        "prepared": prepared,
        "raster_page_indexes": raster_indexes,
        "native_page_indexes": native_indexes,
        "baseline_metrics": _text_metrics(baseline_pairs),
        "prepared_metrics": _text_metrics(prepared_pairs),
        "native_text_metrics": _text_metrics(native_pairs),
        "baseline_fields": _field_metrics(fixture, baseline, raster_indexes),
        "prepared_fields": _field_metrics(fixture, prepared, raster_indexes),
        "native_fields": _field_metrics(fixture, prepared, native_indexes),
        "critical_numeric_substitutions_baseline": _critical_substitutions(
            fixture, baseline, raster_indexes
        ),
        "critical_numeric_substitutions_prepared": _critical_substitutions(
            fixture, prepared, raster_indexes
        ),
        "unsupported_field_count": fixture.unsupported_field_count,
        "ocr_comparison_page_count": len(raster_indexes),
    }


def _text_metrics(pairs: list[tuple[str, str]]) -> dict[str, Any]:
    if not pairs:
        return {"page_count": 0, "cer": None, "wer": None, "exact_matches": 0}
    from app.evaluation.ocr_benchmark import (
        character_error_rate,
        normalize_observation,
        word_error_rate,
    )

    return {
        "page_count": len(pairs),
        "cer": sum(character_error_rate(expected, observed) for expected, observed in pairs) / len(pairs),
        "wer": sum(word_error_rate(expected, observed) for expected, observed in pairs) / len(pairs),
        "exact_matches": sum(
            normalize_observation(expected) == normalize_observation(observed)
            for expected, observed in pairs
        ),
        "exact_match_accuracy": sum(
            normalize_observation(expected) == normalize_observation(observed)
            for expected, observed in pairs
        ) / len(pairs),
    }


def _field_metrics(
    fixture: OCRAccuracyFixture,
    observations: list[dict[str, Any]],
    page_indexes: list[int],
) -> dict[str, dict[str, int | float]]:
    from app.evaluation.ocr_benchmark import normalize_observation

    output: dict[str, dict[str, int | float]] = {}
    observed_text = normalize_observation(" ".join(
        observations[index]["text"]
        for index in page_indexes
        if index < len(observations)
    ))
    expected_page_indexes = [
        index for index in page_indexes if index < len(fixture.expected_pages)
    ]
    for field in FIELDS:
        declared = Counter(
            normalize_observation(token)
            for token in fixture.fields.get(field, ())
        )
        expected = Counter()
        for token, count in declared.items():
            occurrence_count = sum(
                _count_token(
                    normalize_observation(fixture.expected_pages[index]),
                    token,
                )
                for index in expected_page_indexes
            )
            expected[token] = min(count, occurrence_count)
        expected += Counter()
        if not expected:
            continue
        matched = sum(
            min(count, _count_token(observed_text, token))
            for token, count in expected.items()
        )
        total = sum(expected.values())
        output[field] = {
            "correct": matched,
            "total": total,
            "accuracy": matched / total,
        }
    return output


def _critical_substitutions(
    fixture: OCRAccuracyFixture,
    observations: list[dict[str, Any]],
    page_indexes: list[int],
) -> int:
    from app.evaluation.ocr_benchmark import normalize_observation

    if not fixture.critical_pairs:
        return 0
    expected_text = normalize_observation("\n".join(fixture.expected_pages))
    observed_text = normalize_observation(
        " ".join(
            observations[index]["text"]
            for index in page_indexes
            if index < len(observations)
        )
    )
    substitutions = 0
    for left, right in fixture.critical_pairs:
        expected_left = _count_token(expected_text, normalize_observation(left))
        expected_right = _count_token(expected_text, normalize_observation(right))
        observed_left = _count_token(observed_text, normalize_observation(left))
        observed_right = _count_token(observed_text, normalize_observation(right))
        substitutions += min(max(0, expected_left - observed_left), max(0, observed_right - expected_right))
        substitutions += min(max(0, expected_right - observed_right), max(0, observed_left - expected_left))
    return substitutions


def _count_token(text: str, token: str) -> int:
    pattern = r"(?<![a-z0-9])" + re.escape(token) + r"(?![a-z0-9])"
    return len(re.findall(pattern, text))


def _aggregate_field_metrics(samples: list[dict[str, Any]], field_key: str) -> dict[str, dict[str, int | float]]:
    totals: dict[str, list[int]] = {}
    for sample in samples:
        for field, metrics in sample[field_key].items():
            totals.setdefault(field, [0, 0])
            totals[field][0] += int(metrics["correct"])
            totals[field][1] += int(metrics["total"])
    return {
        field: {
            "correct": values[0],
            "total": values[1],
            "accuracy": values[0] / values[1] if values[1] else 0.0,
        }
        for field, values in totals.items()
    }


def _aggregate_text_metrics(samples: list[dict[str, Any]], key: str) -> dict[str, Any]:
    pages = [sample[key] for sample in samples if sample[key]["page_count"]]
    if not pages:
        return {"page_count": 0, "cer": None, "wer": None, "exact_match_accuracy": None}
    count = sum(int(item["page_count"]) for item in pages)
    exact_count = sum(int(item["exact_matches"]) for item in pages)
    return {
        "page_count": count,
        "macro_page_cer": sum(float(item["cer"]) * int(item["page_count"]) for item in pages) / count,
        "macro_page_wer": sum(float(item["wer"]) * int(item["page_count"]) for item in pages) / count,
        "exact_matches": exact_count,
        "exact_match_accuracy": exact_count / count,
    }


def run_benchmark(
    engine_name: str,
    easyocr_model_directory: Path,
    paddle_detection_directory: Path,
    paddle_recognition_directory: Path,
    sample_limit: int | None,
    sample_id: str | None,
) -> dict[str, Any]:
    monitor = _start_monitor()
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="meddecode-ocr-phase2-9-") as temporary:
        fixtures = build_ocr_accuracy_fixtures(Path(temporary))
        if sample_id is not None:
            fixtures = tuple(fixture for fixture in fixtures if fixture.identifier == sample_id)
            if not fixtures:
                raise ValueError(f"Unknown fixture identifier: {sample_id}")
        if sample_limit is not None:
            fixtures = fixtures[:sample_limit]
        engine = _make_provider(
            engine_name,
            easyocr_model_directory,
            paddle_detection_directory,
            paddle_recognition_directory,
        )
        samples = [_run_fixture(fixture, engine) for fixture in fixtures]
        memory = monitor.stop()
        run_seconds = time.perf_counter() - started

    baseline_raster_metrics = _aggregate_text_metrics(samples, "baseline_metrics")
    prepared_raster_metrics = _aggregate_text_metrics(samples, "prepared_metrics")
    native_metrics = _aggregate_text_metrics(samples, "native_text_metrics")
    prepared_page_indexes = [
        (sample, index)
        for sample in samples
        for index in sample["raster_page_indexes"]
    ]
    return {
        "schema_version": "1.0",
        "genuine_local_inference": True,
        "engine": engine_name,
        "engine_version": _package_version("easyocr" if engine_name == "easyocr" else "paddleocr"),
        "paddle_version": _package_version("paddlepaddle") if engine_name == "paddleocr" else None,
        "model_directory": str(
            easyocr_model_directory if engine_name == "easyocr" else paddle_detection_directory
        ),
        "fixture_count": len(fixtures),
        "writing_style_counts": {
            style: sum(fixture.writing_style == style for fixture in fixtures)
            for style in sorted({fixture.writing_style for fixture in fixtures})
        },
        "original_raster_ocr": baseline_raster_metrics,
        "preprocessed_raster_ocr": prepared_raster_metrics,
        "searchable_native_text_separate": native_metrics,
        "baseline_fields": _aggregate_field_metrics(samples, "baseline_fields"),
        "preprocessed_fields": _aggregate_field_metrics(samples, "prepared_fields"),
        "native_text_fields": _aggregate_field_metrics(samples, "native_fields"),
        "critical_numeric_substitutions": {
            "baseline": sum(sample["critical_numeric_substitutions_baseline"] for sample in samples),
            "preprocessed": sum(sample["critical_numeric_substitutions_prepared"] for sample in samples),
        },
        "unsupported_or_ambiguous_field_count": sum(
            int(sample["unsupported_field_count"]) for sample in samples
        ),
        "raster_ocr_page_count": len(prepared_page_indexes),
        "initialization_and_first_call_ms": engine.first_call_ms,
        "warm_mean_inference_ms": (
            sum(engine.calls[1:]) / len(engine.calls[1:])
            if len(engine.calls) > 1
            else None
        ),
        "inference_call_count": len(engine.calls),
        "elapsed_seconds": run_seconds,
        "memory": memory,
        "samples": samples,
        "limitations": [
            "All image fixtures are digitally rendered fictional text; the handwriting-like sample uses a printed script font and is not genuine handwriting.",
            "No real patient data or hosted OCR was used.",
            "Metrics describe this synthetic set only.",
        ],
    }


def rescore_existing_results(path: Path) -> dict[str, Any]:
    result = json.loads(path.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="meddecode-ocr-rescore-") as temporary:
        fixtures = {
            fixture.identifier: fixture
            for fixture in build_ocr_accuracy_fixtures(Path(temporary))
        }
    samples = result.get("samples")
    if not isinstance(samples, list):
        raise ValueError("Benchmark results do not contain samples.")
    for sample in samples:
        fixture = fixtures.get(sample.get("id"))
        if fixture is None:
            raise ValueError("Benchmark result contains an unknown fixture.")
        raster_indexes = sample.get("raster_page_indexes", [])
        native_indexes = sample.get("native_page_indexes", [])
        baseline = sample.get("baseline_ocr", [])
        prepared = sample.get("prepared", [])
        sample["baseline_fields"] = _field_metrics(fixture, baseline, raster_indexes)
        sample["prepared_fields"] = _field_metrics(fixture, prepared, raster_indexes)
        sample["native_fields"] = _field_metrics(fixture, prepared, native_indexes)
        sample["critical_numeric_substitutions_baseline"] = _critical_substitutions(
            fixture, baseline, raster_indexes
        )
        sample["critical_numeric_substitutions_prepared"] = _critical_substitutions(
            fixture, prepared, raster_indexes
        )
        sample["unsupported_field_count"] = fixture.unsupported_field_count
    result["baseline_fields"] = _aggregate_field_metrics(samples, "baseline_fields")
    result["preprocessed_fields"] = _aggregate_field_metrics(samples, "prepared_fields")
    result["native_text_fields"] = _aggregate_field_metrics(samples, "native_fields")
    result["critical_numeric_substitutions"] = {
        "baseline": sum(sample["critical_numeric_substitutions_baseline"] for sample in samples),
        "preprocessed": sum(sample["critical_numeric_substitutions_prepared"] for sample in samples),
    }
    result["unsupported_or_ambiguous_field_count"] = sum(
        int(sample["unsupported_field_count"]) for sample in samples
    )
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run local OCR against fictional documents.")
    parser.add_argument("--engine", choices=("easyocr", "paddleocr"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--sample", type=str)
    parser.add_argument("--rescore-existing", type=Path)
    parser.add_argument("--easyocr-model-directory", type=Path, default=Path.home() / ".EasyOCR")
    parser.add_argument(
        "--paddle-detection-directory",
        type=Path,
        default=Path.home() / ".paddlex" / "official_models" / "PP-OCRv6_medium_det",
    )
    parser.add_argument(
        "--paddle-recognition-directory",
        type=Path,
        default=Path.home() / ".paddlex" / "official_models" / "PP-OCRv6_medium_rec",
    )
    args = parser.parse_args(argv)
    if args.rescore_existing is not None:
        result = rescore_existing_results(args.rescore_existing)
        destination = args.output or args.rescore_existing
        destination.write_text(
            json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
            encoding="utf-8",
        )
        return 0
    if args.engine is None:
        parser.error("--engine is required unless --rescore-existing is used.")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive.")
    if args.engine == "easyocr":
        model_dir = args.easyocr_model_directory
        nested = model_dir / "model" if (model_dir / "model").is_dir() else model_dir
        if not all((nested / name).is_file() for name in ("english_g2.pth", "craft_mlt_25k.pth")):
            parser.error("EasyOCR local weights are missing; downloads are disabled.")
    else:
        for model_dir in (args.paddle_detection_directory, args.paddle_recognition_directory):
            if not (model_dir / "inference.pdiparams").is_file():
                parser.error(f"PaddleOCR local model weights are missing: {model_dir}")

    result = run_benchmark(
        args.engine,
        args.easyocr_model_directory,
        args.paddle_detection_directory,
        args.paddle_recognition_directory,
        args.limit,
        args.sample,
    )
    encoded = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    else:
        print(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
