"""Privacy-safe OCR-only staged benchmark (no catalogue or patient logging)."""

from __future__ import annotations

import argparse
import json
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import psutil

from app.integration.staged_local_pdf_worker import (
    STAGED_TROCR_RESERVE_BYTES,
    _run_primary_stage,
)
from app.integration.staged_ocr_protocol import predictions_from_json, region_from_json
from app.layer1_document_processing.trocr_ipc import TrOCRSubprocessConfig, TrOCRSubprocessProvider


def _tree_rss() -> int:
    process = psutil.Process()
    values = [process, *process.children(recursive=True)]
    total = 0
    for item in values:
        try:
            total += int(item.memory_info().rss)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return total


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--document-path", required=True)
    parser.add_argument("--file-type", required=True)
    parser.add_argument("--easyocr-model-directory", required=True)
    parser.add_argument("--paddle-detection-model-directory", required=True)
    parser.add_argument("--paddle-recognition-model-directory", required=True)
    parser.add_argument("--trocr-python", required=True)
    parser.add_argument("--trocr-model-directory", required=True)
    parser.add_argument("--memory-limit-bytes", type=int, default=2 * 1024**3)
    args = parser.parse_args(argv)
    stop = threading.Event()
    peak = [0]

    def monitor() -> None:
        while not stop.wait(0.05):
            peak[0] = max(peak[0], _tree_rss())

    thread = threading.Thread(target=monitor, daemon=True)
    started = time.perf_counter()
    thread.start()
    try:
        primary_args = SimpleNamespace(
            local_pdf_path=args.document_path,
            easyocr_model_directory=args.easyocr_model_directory,
            paddle_detection_model_directory=args.paddle_detection_model_directory,
            paddle_recognition_model_directory=args.paddle_recognition_model_directory,
        )
        primary = _run_primary_stage(primary_args, args.file_type)
        provider = TrOCRSubprocessProvider(TrOCRSubprocessConfig(
            interpreter=Path(args.trocr_python), model_directory=Path(args.trocr_model_directory),
            timeout_seconds=60.0, max_process_tree_rss_bytes=args.memory_limit_bytes,
            memory_reserve_bytes=STAGED_TROCR_RESERVE_BYTES,
        ))
        counts = {"easyocr": 0, "paddleocr": 0, "trocr": 0}
        statuses: list[str] = []
        for page in primary["pages"]:
            for item in predictions_from_json(page["primary_predictions"]):
                counts[item.engine_name] = counts.get(item.engine_name, 0) + 1
            for item in predictions_from_json(page["secondary_predictions"]):
                counts[item.engine_name] = counts.get(item.engine_name, 0) + 1
            if page["handwriting_classification"] == "possible" and page["fallback_regions"]:
                regions = tuple(region_from_json(item) for item in page["fallback_regions"])
                output = provider.recognize_regions(regions, int(page["page_number"]), 60.0)
                counts["trocr"] += len(output)
                statuses.append(provider.last_status_code)
        status = "ok"
    except Exception as error:
        status = f"failed:{type(error).__name__}"
        counts = {}
        statuses = []
    finally:
        stop.set()
        thread.join(timeout=2)
        peak[0] = max(peak[0], _tree_rss())
    print(json.dumps({
        "status": status, "provider_counts": counts, "trocr_statuses": statuses,
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "peak_process_tree_rss_bytes": peak[0],
        "memory_limit_bytes": args.memory_limit_bytes,
        "within_memory_limit": peak[0] <= args.memory_limit_bytes,
    }, separators=(",", ":")))
    return 0 if status == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
