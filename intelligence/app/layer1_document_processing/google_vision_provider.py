"""Opt-in Google Cloud Vision document OCR provider.

The Google client is imported and constructed only when an enabled provider
performs a request. Tests and local runs can inject a transport and make no
credential or network calls.
"""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import math
from typing import Any, Protocol

from PIL import Image

from app.layer1_document_processing.hybrid_ocr import (
    CloudOCRDisabledError,
    OCRPrediction,
    OCRProviderError,
    Polygon,
)


class GoogleVisionTimeoutError(OCRProviderError):
    """A Vision request exceeded its configured deadline."""


class GoogleVisionTransportProtocol(Protocol):
    def document_text(self, image_bytes: bytes, timeout_seconds: float) -> Any: ...


@dataclass
class GoogleVisionTransport:
    """Lazy transport; constructing or importing it does not discover credentials."""

    def document_text(self, image_bytes: bytes, timeout_seconds: float) -> Any:
        try:
            from google.cloud import vision
        except ImportError as error:
            raise OCRProviderError("Google Cloud Vision client is not installed.") from error

        try:
            client = vision.ImageAnnotatorClient()
            response = client.document_text_detection(
                image=vision.Image(content=image_bytes),
                timeout=timeout_seconds,
            )
        except Exception as error:
            if isinstance(error, TimeoutError) or type(error).__name__ in {"DeadlineExceeded", "Timeout"}:
                raise GoogleVisionTimeoutError("Google Cloud Vision request timed out.") from error
            raise OCRProviderError("Google Cloud Vision request failed.") from error

        api_error = getattr(getattr(response, "error", None), "message", "")
        if api_error:
            raise OCRProviderError("Google Cloud Vision returned an OCR error.")
        return response


class GoogleVisionProvider:
    """DOCUMENT_TEXT_DETECTION provider for rendered page images."""

    engine_name = "google_cloud_vision"

    def __init__(
        self,
        *,
        enabled: bool = False,
        transport: GoogleVisionTransportProtocol | None = None,
    ) -> None:
        self._enabled = enabled
        self._transport = transport if transport is not None else GoogleVisionTransport()

    def recognize(
        self,
        image: Image.Image,
        page_number: int,
        timeout_seconds: float,
    ) -> list[OCRPrediction]:
        if not self._enabled:
            raise CloudOCRDisabledError("Google Cloud Vision is disabled.")
        if page_number < 1:
            raise OCRProviderError("Google Cloud Vision requires a positive page number.")
        if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
            raise GoogleVisionTimeoutError("Google Cloud Vision request timed out.")

        try:
            buffer = BytesIO()
            image.convert("RGB").save(buffer, format="PNG")
            response = self._transport.document_text(buffer.getvalue(), timeout_seconds)
        except (CloudOCRDisabledError, GoogleVisionTimeoutError, OCRProviderError):
            raise
        except TimeoutError as error:
            raise GoogleVisionTimeoutError("Google Cloud Vision request timed out.") from error
        except Exception as error:
            raise OCRProviderError("Google Cloud Vision request failed.") from error

        if response is None:
            raise OCRProviderError("Google Cloud Vision returned a malformed response.")
        api_error = getattr(getattr(response, "error", None), "message", "")
        if api_error:
            raise OCRProviderError("Google Cloud Vision returned an OCR error.")
        annotation = getattr(response, "full_text_annotation", None)
        if annotation is None:
            return []
        pages = getattr(annotation, "pages", None)
        if pages is None or isinstance(pages, (str, bytes)):
            raise OCRProviderError("Google Cloud Vision returned a malformed response.")

        predictions: list[OCRPrediction] = []
        try:
            for page in pages:
                for block in page.blocks:
                    for paragraph in block.paragraphs:
                        for word in paragraph.words:
                            text = "".join(symbol.text for symbol in word.symbols).strip()
                            if not text:
                                continue
                            confidence = getattr(word, "confidence", None)
                            if confidence is not None:
                                confidence = float(confidence)
                                if not math.isfinite(confidence) or not 0 <= confidence <= 1:
                                    raise ValueError("Invalid OCR confidence.")
                            predictions.append(
                                OCRPrediction(
                                    engine_name=self.engine_name,
                                    engine_version="document-text-detection",
                                    page_number=page_number,
                                    text=text,
                                    polygon=_word_polygon(word.bounding_box),
                                    raw_confidence=confidence,
                                    model_provenance="google-cloud-vision-document-text-detection",
                                )
                            )
        except (AttributeError, TypeError, ValueError) as error:
            raise OCRProviderError("Google Cloud Vision returned a malformed response.") from error
        return predictions


def _word_polygon(bounding_box: Any) -> Polygon | None:
    vertices = getattr(bounding_box, "vertices", None)
    if vertices is None:
        vertices = getattr(bounding_box, "normalized_vertices", None)
    if vertices is None:
        return None

    try:
        points = tuple(
            (float(getattr(vertex, "x", 0)), float(getattr(vertex, "y", 0)))
            for vertex in vertices
        )
    except (TypeError, ValueError, OverflowError):
        return None
    return points if len(points) >= 3 else None
