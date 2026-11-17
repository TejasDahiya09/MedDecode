"""Isolated, local-only TrOCR JSON worker.

This entry point is executed only by ``.venv-trocr``.  Stdout is a bounded JSON
protocol channel; diagnostics use non-sensitive codes on stderr.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path
from uuid import UUID

from PIL import Image, UnidentifiedImageError

from app.layer1_document_processing.hybrid_ocr import OCRRegion, TrOCRHandwrittenProvider

IPC_VERSION = "1.0"
MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_OUTPUT_BYTES = 1024 * 1024
MAX_REGIONS = 4
MAX_CROP_PIXELS = 1_000_000
MAX_TOTAL_CROP_PIXELS = 2_000_000
MAX_DECODED_IMAGE_BYTES = 4 * 1024 * 1024


def _fail(code: str, exit_code: int = 3) -> int:
    print(f"TROCR_IPC_FAILED:{code}", file=sys.stderr)
    return exit_code


def _parse_polygon(value: object) -> tuple[tuple[float, float], ...]:
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError("polygon")
    polygon = tuple((float(point[0]), float(point[1])) for point in value)
    if any(not (0 <= coordinate <= 1_000_000) for point in polygon for coordinate in point):
        raise ValueError("polygon")
    return polygon


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--model-directory", required=True)
    args = parser.parse_args(argv)
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            return _fail("REQUEST_TOO_LARGE", 2)
        request = json.loads(raw)
        if not isinstance(request, dict) or request.get("schema_version") != IPC_VERSION:
            return _fail("INVALID_REQUEST", 2)
        request_id = str(UUID(str(request.get("request_id"))))
        page_number = int(request.get("page_number"))
        values = request.get("regions")
        if not isinstance(values, list) or not 1 <= len(values) <= MAX_REGIONS or page_number < 1:
            return _fail("INVALID_REQUEST", 2)
        regions: list[OCRRegion] = []
        total_pixels = 0
        Image.MAX_IMAGE_PIXELS = MAX_CROP_PIXELS
        for value in values:
            if not isinstance(value, dict):
                return _fail("INVALID_REQUEST", 2)
            encoded = value.get("image_png_base64")
            if not isinstance(encoded, str):
                return _fail("INVALID_REQUEST", 2)
            decoded = base64.b64decode(encoded, validate=True)
            if len(decoded) > MAX_DECODED_IMAGE_BYTES:
                return _fail("IMAGE_TOO_LARGE", 2)
            with Image.open(io.BytesIO(decoded)) as opened:
                opened.verify()
            with Image.open(io.BytesIO(decoded)) as opened:
                image = opened.convert("RGB")
            pixels = image.width * image.height
            if pixels < 1 or pixels > MAX_CROP_PIXELS or total_pixels + pixels > MAX_TOTAL_CROP_PIXELS:
                return _fail("PIXEL_LIMIT", 2)
            total_pixels += pixels
            regions.append(OCRRegion(_parse_polygon(value.get("polygon")), image))

        model_directory = Path(args.model_directory).resolve(strict=True)
        required = ("config.json", "preprocessor_config.json", "model.safetensors")
        if not model_directory.is_dir() or any(not (model_directory / name).is_file() for name in required):
            return _fail("MODEL_UNAVAILABLE")
        provider = TrOCRHandwrittenProvider(
            model_directory=model_directory,
            max_new_tokens=64,
            max_pixels=MAX_CROP_PIXELS,
        )
        with redirect_stdout(io.StringIO()):
            predictions = provider.recognize_regions(regions, page_number, timeout_seconds=30.0)
        response = {
            "schema_version": IPC_VERSION,
            "request_id": request_id,
            "status": "ok",
            "predictions": [
                {
                    "text": prediction.text,
                    "polygon": [[float(x), float(y)] for x, y in prediction.polygon or ()],
                }
                for prediction in predictions
            ],
        }
        output = json.dumps(response, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(output) > MAX_OUTPUT_BYTES:
            return _fail("RESPONSE_TOO_LARGE")
        sys.stdout.buffer.write(output)
        return 0
    except (ValueError, TypeError, UnicodeError, json.JSONDecodeError, UnidentifiedImageError, OSError):
        return _fail("INVALID_REQUEST", 2)
    except Exception:
        return _fail("PROVIDER_FAILED")


if __name__ == "__main__":
    raise SystemExit(main())
