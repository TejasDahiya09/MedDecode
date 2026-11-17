"""Bounded JSON evidence shared by sequential OCR subprocess stages."""

from __future__ import annotations

import base64
import io
from typing import Any, Iterable

from PIL import Image

from app.layer1_document_processing.hybrid_ocr import OCRPrediction, OCRRegion

PROTOCOL_VERSION = "1.0"
MAX_STAGE_RESPONSE_BYTES = 12 * 1024 * 1024


def prediction_to_json(value: OCRPrediction) -> dict[str, Any]:
    return {
        "engine_name": value.engine_name,
        "engine_version": value.engine_version,
        "page_number": value.page_number,
        "text": value.text,
        "polygon": [list(point) for point in value.polygon] if value.polygon else None,
        "raw_confidence": value.raw_confidence,
        "content_style": value.content_style,
        "model_provenance": value.model_provenance,
    }


def prediction_from_json(value: dict[str, Any]) -> OCRPrediction:
    polygon_value = value.get("polygon")
    polygon = None if polygon_value is None else tuple(
        (float(point[0]), float(point[1])) for point in polygon_value
    )
    return OCRPrediction(
        engine_name=str(value["engine_name"]),
        engine_version=str(value["engine_version"]),
        page_number=int(value["page_number"]),
        text=str(value["text"]),
        polygon=polygon,  # type: ignore[arg-type]
        raw_confidence=(None if value.get("raw_confidence") is None else float(value["raw_confidence"])),
        content_style=str(value.get("content_style", "unknown")),
        model_provenance=str(value.get("model_provenance", "unknown")),
    )


def region_to_json(value: OCRRegion) -> dict[str, Any]:
    buffer = io.BytesIO()
    value.image.convert("RGB").save(buffer, format="PNG", optimize=True)
    return {
        "polygon": [list(point) for point in value.polygon],
        "image_png_base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
    }


def region_from_json(value: dict[str, Any]) -> OCRRegion:
    raw = base64.b64decode(str(value["image_png_base64"]), validate=True)
    with Image.open(io.BytesIO(raw)) as source:
        source.verify()
    with Image.open(io.BytesIO(raw)) as source:
        image = source.convert("RGB")
        image.load()
    polygon = tuple((float(point[0]), float(point[1])) for point in value["polygon"])
    return OCRRegion(polygon=polygon, image=image)  # type: ignore[arg-type]


def predictions_from_json(values: Iterable[dict[str, Any]]) -> tuple[OCRPrediction, ...]:
    return tuple(prediction_from_json(value) for value in values)
