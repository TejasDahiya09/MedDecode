"""Local-first hybrid OCR with explicit cloud opt-in and preserved evidence.

Providers are deliberately lazy. Missing packages, local model assets, cloud
permission, or provider failures become per-engine errors; they never trigger a
synthetic OCR fallback or invent a clinical value.
"""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from threading import Lock
from time import perf_counter
from typing import TYPE_CHECKING, Any, Protocol, Sequence

import numpy as np
from PIL import Image

from app.schemas.ocr import OCRBlock, OCRPageResult

if TYPE_CHECKING:
    from app.layer1_document_processing.ocr_engine import OCREngine, PaddleOCRLocalModelConfig


class OCRProviderError(RuntimeError):
    """Safe provider failure; callers must not log source document content."""


class CloudOCRDisabledError(OCRProviderError):
    pass


class CloudOCRTimeoutError(OCRProviderError):
    pass


class CloudOCRThrottledError(OCRProviderError):
    pass


class CloudOCRPermissionError(OCRProviderError):
    pass


class CloudOCRMalformedResponseError(OCRProviderError):
    pass


Polygon = tuple[tuple[float, float], ...]


@dataclass(frozen=True)
class OCRPrediction:
    engine_name: str
    engine_version: str
    page_number: int
    text: str
    polygon: Polygon | None
    raw_confidence: float | None
    content_style: str = "unknown"
    model_provenance: str = "unknown"


@dataclass(frozen=True)
class OCRProviderFailure:
    engine_name: str
    code: str


@dataclass(frozen=True)
class OCRRegion:
    polygon: Polygon
    image: Image.Image


@dataclass(frozen=True)
class ReconciledOCRRegion:
    predictions: tuple[OCRPrediction, ...]
    state: str
    selected_prediction: OCRPrediction | None


@dataclass(frozen=True)
class HybridOCRPageResult:
    page_number: int
    predictions: tuple[OCRPrediction, ...]
    regions: tuple[ReconciledOCRRegion, ...]
    failures: tuple[OCRProviderFailure, ...]
    elapsed_ms: float

    def to_ocr_page_result(self) -> OCRPageResult:
        """Return only non-conflicting evidence to Layers 2-5.

        Conflicting predictions remain in ``regions`` for manual verification,
        but are never handed to the medicine extractor as an invented answer.
        """
        accepted = [
            region.selected_prediction
            for region in self.regions
            if region.state in {"single_source", "agreement"}
            and region.selected_prediction is not None
        ]
        blocks = [
            OCRBlock(
                text=item.text,
                confidence=item.raw_confidence if item.raw_confidence is not None else 0.0,
                bounding_box=[list(point) for point in item.polygon] if item.polygon else [],
            )
            for item in accepted
        ]
        return OCRPageResult(full_text="\n".join(block.text for block in blocks), blocks=blocks)


class WholePageOCRProvider(Protocol):
    engine_name: str

    def recognize(self, image: Image.Image, page_number: int, timeout_seconds: float) -> list[OCRPrediction]: ...


class HandwrittenRegionOCRProvider(Protocol):
    engine_name: str

    def recognize_regions(self, regions: Sequence[OCRRegion], page_number: int, timeout_seconds: float) -> list[OCRPrediction]: ...


@dataclass(frozen=True)
class PaddleOCRProvider:
    local_model_config: PaddleOCRLocalModelConfig
    engine: OCREngine | None = None
    engine_name: str = "paddleocr"

    def recognize(self, image: Image.Image, page_number: int, timeout_seconds: float) -> list[OCRPrediction]:
        # PaddleOCR has no per-call cancellation API. The hybrid coordinator
        # enforces a caller-visible deadline and records a timeout safely.
        from app.layer1_document_processing.ocr_engine import OCREngine

        engine = self.engine or OCREngine(self.local_model_config)
        result = engine.process_page(image)
        return [
            OCRPrediction(
                engine_name=self.engine_name,
                engine_version="paddleocr-3.x",
                page_number=page_number,
                text=block.text,
                polygon=_polygon(block.bounding_box),
                raw_confidence=block.confidence,
                model_provenance="local-paddle-model-directory",
            )
            for block in result.blocks
            if block.text.strip()
        ]


class EasyOCRProvider:
    engine_name = "easyocr"

    def __init__(
        self,
        *,
        model_storage_directory: Path,
        languages: Sequence[str] = ("en",),
        reader: Any | None = None,
    ) -> None:
        self._model_storage_directory = model_storage_directory
        self._languages = tuple(languages)
        self._reader = reader
        self._reader_lock = Lock()
        self._initialization_elapsed_ms: float | None = None
        self._last_inference_elapsed_ms: float | None = None

    @property
    def initialization_elapsed_ms(self) -> float | None:
        return self._initialization_elapsed_ms

    @property
    def last_inference_elapsed_ms(self) -> float | None:
        return self._last_inference_elapsed_ms

    def _reader_or_raise(self) -> Any:
        if self._reader is not None:
            return self._reader
        if not self._model_storage_directory.is_dir():
            raise OCRProviderError("EasyOCR local model assets are unavailable.")
        with self._reader_lock:
            if self._reader is not None:
                return self._reader
            started = perf_counter()
            try:
                try:
                    import easyocr
                except ImportError as error:
                    raise OCRProviderError("EasyOCR is not installed.") from error
                # EasyOCR is explicitly prevented from downloading weights at runtime.
                self._reader = easyocr.Reader(
                    list(self._languages),
                    gpu=False,
                    model_storage_directory=str(self._model_storage_directory),
                    download_enabled=False,
                    verbose=False,
                )
            finally:
                self._initialization_elapsed_ms = (perf_counter() - started) * 1000
        return self._reader

    def recognize(self, image: Image.Image, page_number: int, timeout_seconds: float) -> list[OCRPrediction]:
        reader = self._reader_or_raise()
        started = perf_counter()
        try:
            values = reader.readtext(np.array(image.convert("RGB")), detail=1, paragraph=False)
        finally:
            self._last_inference_elapsed_ms = (perf_counter() - started) * 1000
        return [
            OCRPrediction(
                engine_name=self.engine_name,
                engine_version="easyocr",
                page_number=page_number,
                text=str(text),
                polygon=_polygon(box),
                raw_confidence=float(confidence),
                model_provenance="local-easyocr-model-directory",
            )
            for box, text, confidence in values
            if str(text).strip()
        ]


class TrOCRHandwrittenProvider:
    engine_name = "trocr_base_handwritten"

    def __init__(self, *, model_directory: Path, processor: Any | None = None, model: Any | None = None) -> None:
        self._model_directory = model_directory
        self._processor = processor
        self._model = model

    def _load_or_raise(self) -> tuple[Any, Any]:
        if self._processor is not None and self._model is not None:
            return self._processor, self._model
        if not self._model_directory.is_dir():
            raise OCRProviderError("TrOCR local model assets are unavailable.")
        try:
            from transformers import TrOCRProcessor, VisionEncoderDecoderModel
        except ImportError as error:
            raise OCRProviderError("TrOCR requires transformers and torch.") from error
        # local_files_only is the no-download boundary for this provider.
        self._processor = TrOCRProcessor.from_pretrained(str(self._model_directory), local_files_only=True)
        self._model = VisionEncoderDecoderModel.from_pretrained(str(self._model_directory), local_files_only=True)
        self._model.to("cpu")
        self._model.eval()
        return self._processor, self._model

    def recognize_regions(self, regions: Sequence[OCRRegion], page_number: int, timeout_seconds: float) -> list[OCRPrediction]:
        if not regions:
            return []
        processor, model = self._load_or_raise()
        images = [region.image.convert("RGB") for region in regions]
        pixel_values = processor(images=images, return_tensors="pt").pixel_values
        generated = model.generate(pixel_values)
        texts = processor.batch_decode(generated, skip_special_tokens=True)
        return [
            OCRPrediction(
                engine_name=self.engine_name,
                engine_version="microsoft-trocr-base-handwritten",
                page_number=page_number,
                text=str(text).strip(),
                polygon=region.polygon,
                raw_confidence=None,
                content_style="handwritten",
                model_provenance="local-transformers-model-directory",
            )
            for region, text in zip(regions, texts, strict=True)
            if str(text).strip()
        ]


class Boto3TextractTransport:
    """Actual Textract transport, created only after explicit opt-in."""

    def __init__(self, *, region: str, client: Any | None = None) -> None:
        if not region.strip():
            raise ValueError("AWS Textract region is required.")
        self._region = region
        self._client = client
        self._client_lock = Lock()

    def _client_or_raise(self, timeout_seconds: float) -> Any:
        if self._client is not None:
            return self._client
        with self._client_lock:
            if self._client is not None:
                return self._client
            try:
                import boto3
                from botocore.config import Config
            except ImportError as error:
                raise OCRProviderError("AWS Textract requires boto3.") from error
            self._client = boto3.client(
                "textract",
                region_name=self._region,
                config=Config(
                    connect_timeout=timeout_seconds,
                    read_timeout=timeout_seconds,
                    retries={"max_attempts": 0},
                ),
            )
        return self._client

    def detect_document_text(self, image_bytes: bytes, timeout_seconds: float) -> MappingLike:
        client = self._client_or_raise(timeout_seconds)
        try:
            response = client.detect_document_text(Document={"Bytes": image_bytes})
        except Exception as error:
            code = _aws_error_code(error)
            if code in {"AccessDeniedException", "InvalidSignatureException", "UnrecognizedClientException"}:
                raise CloudOCRPermissionError("AWS Textract permission was denied.") from error
            if code in {"ProvisionedThroughputExceededException", "ThrottlingException", "TooManyRequestsException"}:
                raise CloudOCRThrottledError("AWS Textract throttled the request.") from error
            if error.__class__.__name__ in {"ConnectTimeoutError", "ReadTimeoutError", "EndpointConnectionError"}:
                raise CloudOCRTimeoutError("AWS Textract timed out.") from error
            raise OCRProviderError("AWS Textract request failed safely.") from error
        if not isinstance(response, dict):
            raise CloudOCRMalformedResponseError("AWS Textract returned an invalid response.")
        return response


class AwsTextractProvider:
    engine_name = "aws_textract"

    MAX_SYNC_IMAGE_BYTES = 5 * 1024 * 1024

    def __init__(self, *, enabled: bool = False, region: str | None = None, transport: Any | None = None) -> None:
        self._enabled = enabled
        self._transport = transport
        if enabled and transport is None:
            if region is None or not region.strip():
                raise ValueError("AWS Textract region is required when enabled.")
            self._transport = Boto3TextractTransport(region=region)

    def recognize(self, image: Image.Image, page_number: int, timeout_seconds: float) -> list[OCRPrediction]:
        if not self._enabled:
            raise CloudOCRDisabledError("AWS Textract is disabled.")
        image_bytes = _png_bytes(image)
        if len(image_bytes) > self.MAX_SYNC_IMAGE_BYTES:
            raise OCRProviderError("Rendered page exceeds the Textract synchronous image limit.")
        response = self._transport.detect_document_text(image_bytes, timeout_seconds)
        blocks = response.get("Blocks") if isinstance(response, dict) else None
        if not isinstance(blocks, list):
            raise CloudOCRMalformedResponseError("AWS Textract returned an invalid response.")
        predictions: list[OCRPrediction] = []
        for block in blocks:
            if not isinstance(block, dict):
                raise CloudOCRMalformedResponseError("AWS Textract returned an invalid block.")
            if block.get("BlockType") != "LINE":
                continue
            text = block.get("Text")
            confidence = _percent_confidence(block.get("Confidence"))
            polygon = _aws_polygon(
                block.get("Geometry", {}).get("Polygon"), image.width, image.height
            ) if isinstance(block.get("Geometry"), dict) else None
            if not isinstance(text, str) or not text.strip() or confidence is None or polygon is None:
                raise CloudOCRMalformedResponseError("AWS Textract returned an invalid line block.")
            predictions.append(
                OCRPrediction(
                    engine_name=self.engine_name,
                    engine_version="detect-document-text",
                    page_number=page_number,
                    text=text,
                    polygon=polygon,
                    raw_confidence=confidence,
                    content_style=str(block.get("TextType", "unknown")).casefold(),
                    model_provenance="aws-textract-detect-document-text",
                )
            )
        return predictions


class GoogleVisionTransport:
    """Actual Vision transport, created only after explicit opt-in."""

    def document_text(self, image_bytes: bytes, timeout_seconds: float) -> Any:
        try:
            from google.cloud import vision
        except ImportError as error:
            raise OCRProviderError("Google Vision requires google-cloud-vision.") from error
        response = vision.ImageAnnotatorClient().document_text_detection(
            image=vision.Image(content=image_bytes), timeout=timeout_seconds
        )
        if response.error.message:
            raise OCRProviderError("Google Vision returned an OCR error.")
        return response


class GoogleVisionProvider:
    engine_name = "google_cloud_vision"

    def __init__(self, *, enabled: bool = False, transport: Any | None = None) -> None:
        self._enabled = enabled
        self._transport = transport or GoogleVisionTransport()

    def recognize(self, image: Image.Image, page_number: int, timeout_seconds: float) -> list[OCRPrediction]:
        if not self._enabled:
            raise CloudOCRDisabledError("Google Cloud Vision is disabled.")
        response = self._transport.document_text(_png_bytes(image), timeout_seconds)
        predictions: list[OCRPrediction] = []
        for page in getattr(getattr(response, "full_text_annotation", None), "pages", []):
            for block in page.blocks:
                for paragraph in block.paragraphs:
                    for word in paragraph.words:
                        text = "".join(symbol.text for symbol in word.symbols)
                        if text:
                            predictions.append(
                                OCRPrediction(
                                    engine_name=self.engine_name,
                                    engine_version="document-text-detection",
                                    page_number=page_number,
                                    text=text,
                                    polygon=_google_polygon(word.bounding_box),
                                    raw_confidence=float(word.confidence) if word.confidence else None,
                                    model_provenance="google-cloud-vision",
                                )
                            )
        return predictions


@dataclass
class HybridOCREngine:
    whole_page_providers: Sequence[WholePageOCRProvider]
    handwritten_provider: HandwrittenRegionOCRProvider | None = None
    max_parallel_providers: int = 2
    per_engine_timeout_seconds: float = 15.0

    def recognize_page(self, image: Image.Image, page_number: int) -> HybridOCRPageResult:
        started = perf_counter()
        predictions, failures = self._run_whole_page(image, page_number)
        if self.handwritten_provider is not None:
            regions = _line_crops(image, predictions)
            if regions:
                try:
                    predictions.extend(
                        self.handwritten_provider.recognize_regions(
                            regions, page_number, self.per_engine_timeout_seconds
                        )
                    )
                except Exception as error:
                    failures.append(_safe_failure(self.handwritten_provider.engine_name, error))
        regions = _reconcile(predictions)
        return HybridOCRPageResult(
            page_number=page_number,
            predictions=tuple(predictions),
            regions=tuple(regions),
            failures=tuple(failures),
            elapsed_ms=(perf_counter() - started) * 1000,
        )

    def _run_whole_page(self, image: Image.Image, page_number: int) -> tuple[list[OCRPrediction], list[OCRProviderFailure]]:
        predictions: list[OCRPrediction] = []
        failures: list[OCRProviderFailure] = []
        providers = tuple(self.whole_page_providers)
        if not providers:
            return predictions, failures
        executor = ThreadPoolExecutor(max_workers=max(1, min(self.max_parallel_providers, len(providers))))
        futures: list[tuple[WholePageOCRProvider, Future[list[OCRPrediction]]]] = [
            (provider, executor.submit(provider.recognize, image.copy(), page_number, self.per_engine_timeout_seconds))
            for provider in providers
        ]
        try:
            completed, _ = wait(
                [future for _, future in futures],
                timeout=self.per_engine_timeout_seconds,
            )
            for provider, future in futures:
                if future not in completed:
                    future.cancel()
                    failures.append(OCRProviderFailure(provider.engine_name, "TIMEOUT"))
                    continue
                try:
                    predictions.extend(future.result())
                except Exception as error:
                    failures.append(_safe_failure(provider.engine_name, error))
        finally:
            executor.shutdown(wait=False, cancel_futures=True)
        return predictions, failures


def _safe_failure(engine_name: str, error: Exception) -> OCRProviderFailure:
    if isinstance(error, (TimeoutError, CloudOCRTimeoutError)):
        return OCRProviderFailure(engine_name, "TIMEOUT")
    if isinstance(error, CloudOCRThrottledError):
        return OCRProviderFailure(engine_name, "THROTTLED")
    if isinstance(error, CloudOCRPermissionError):
        return OCRProviderFailure(engine_name, "PERMISSION_DENIED")
    if isinstance(error, CloudOCRMalformedResponseError):
        return OCRProviderFailure(engine_name, "MALFORMED_RESPONSE")
    if isinstance(error, CloudOCRDisabledError):
        return OCRProviderFailure(engine_name, "DISABLED")
    return OCRProviderFailure(engine_name, "UNAVAILABLE")


def _polygon(value: Any) -> Polygon | None:
    if not value:
        return None
    try:
        points = tuple((float(point[0]), float(point[1])) for point in value)
    except (TypeError, ValueError, IndexError):
        return None
    return points if len(points) >= 3 else None


def _aws_polygon(value: Any, width: int, height: int) -> Polygon | None:
    if not value:
        return None
    try:
        points = tuple(
            (float(point["X"]) * width, float(point["Y"]) * height)
            for point in value
        )
    except (KeyError, TypeError, ValueError):
        return None
    return points if len(points) >= 3 else None


def _google_polygon(box: Any) -> Polygon | None:
    vertices = getattr(box, "vertices", [])
    points = tuple((float(vertex.x), float(vertex.y)) for vertex in vertices)
    return points if len(points) >= 3 else None


def _percent_confidence(value: Any) -> float | None:
    try:
        confidence = float(value) / 100.0
    except (TypeError, ValueError):
        return None
    return confidence if 0.0 <= confidence <= 1.0 else None


def _aws_error_code(error: Exception) -> str | None:
    response = getattr(error, "response", None)
    if not isinstance(response, dict):
        return None
    details = response.get("Error")
    return str(details.get("Code")) if isinstance(details, dict) and details.get("Code") else None


def _png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.convert("RGB").save(buffer, format="PNG")
    return buffer.getvalue()


def _bounds(polygon: Polygon) -> tuple[float, float, float, float]:
    xs, ys = zip(*polygon, strict=True)
    return min(xs), min(ys), max(xs), max(ys)


def _iou(first: Polygon, second: Polygon) -> float:
    ax1, ay1, ax2, ay2 = _bounds(first)
    bx1, by1, bx2, by2 = _bounds(second)
    ix1, iy1, ix2, iy2 = max(ax1, bx1), max(ay1, by1), min(ax2, bx2), min(ay2, by2)
    overlap = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - overlap
    return overlap / union if union > 0 else 0.0


def _line_crops(image: Image.Image, predictions: Sequence[OCRPrediction]) -> list[OCRRegion]:
    polygon_groups: list[list[Polygon]] = []
    for prediction in predictions:
        if prediction.polygon is None:
            continue
        for group in polygon_groups:
            if any(_iou(prediction.polygon, candidate) >= 0.8 for candidate in group):
                group.append(prediction.polygon)
                break
        else:
            polygon_groups.append([prediction.polygon])

    regions: list[OCRRegion] = []
    for group in polygon_groups:
        boxes = [_bounds(polygon) for polygon in group]
        x1, y1 = min(box[0] for box in boxes), min(box[1] for box in boxes)
        x2, y2 = max(box[2] for box in boxes), max(box[3] for box in boxes)
        left, top = max(0, int(x1)), max(0, int(y1))
        right, bottom = min(image.width, int(x2) + 1), min(image.height, int(y2) + 1)
        if right > left and bottom > top:
            regions.append(
                OCRRegion(
                    ((float(left), float(top)), (float(right), float(top)), (float(right), float(bottom)), (float(left), float(bottom))),
                    image.crop((left, top, right, bottom)),
                )
            )
    return regions


def _reconcile(predictions: Sequence[OCRPrediction]) -> list[ReconciledOCRRegion]:
    groups: list[list[OCRPrediction]] = []
    for prediction in predictions:
        if not prediction.text.strip():
            continue
        for group in groups:
            anchor = group[0]
            if prediction.polygon and anchor.polygon and _iou(prediction.polygon, anchor.polygon) >= 0.5:
                group.append(prediction)
                break
        else:
            groups.append([prediction])
    reconciled: list[ReconciledOCRRegion] = []
    for group in groups:
        normalized = {" ".join(item.text.casefold().split()) for item in group}
        ordered = tuple(group)
        if len(normalized) > 1:
            reconciled.append(ReconciledOCRRegion(ordered, "disagreement", None))
        else:
            chosen = max(group, key=lambda item: item.raw_confidence if item.raw_confidence is not None else -1.0)
            reconciled.append(ReconciledOCRRegion(ordered, "agreement" if len(group) > 1 else "single_source", chosen))
    return reconciled


MappingLike = dict[str, Any]
