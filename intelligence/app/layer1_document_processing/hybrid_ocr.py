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
from PIL import Image, ImageOps
from app.layer2_information_extraction.numbered_medicine_rows import (
    detect_unverified_numbered_rows,
    infer_numbered_list_region,
)
from app.schemas.ocr import OCRBlock, OCRPageResult, UnverifiedNumberedRow

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
    selection_rationale: str = ""
    uncertainty_indicators: tuple[str, ...] = ()


@dataclass(frozen=True)
class HybridOCRPageResult:
    page_number: int
    predictions: tuple[OCRPrediction, ...]
    regions: tuple[ReconciledOCRRegion, ...]
    failures: tuple[OCRProviderFailure, ...]
    elapsed_ms: float
    unverified_numbered_rows: tuple[UnverifiedNumberedRow, ...] = ()
    review_warnings: tuple[str, ...] = ()

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
        return OCRPageResult(
            full_text="\n".join(block.text for block in blocks),
            blocks=blocks,
            unverified_numbered_rows=list(self.unverified_numbered_rows),
            processing_warnings=list(self.review_warnings),
        )


class WholePageOCRProvider(Protocol):
    engine_name: str

    def recognize(self, image: Image.Image, page_number: int, timeout_seconds: float) -> list[OCRPrediction]: ...


class HandwrittenRegionOCRProvider(Protocol):
    engine_name: str

    def recognize_regions(self, regions: Sequence[OCRRegion], page_number: int, timeout_seconds: float) -> list[OCRPrediction]: ...


@dataclass
class PaddleOCRProvider:
    local_model_config: PaddleOCRLocalModelConfig
    engine: OCREngine | None = None
    engine_name: str = "paddleocr"
    _engine_lock: Lock = field(default_factory=Lock, init=False, repr=False)

    def _engine_or_create(self) -> OCREngine:
        if self.engine is not None:
            return self.engine
        with self._engine_lock:
            if self.engine is None:
                from app.layer1_document_processing.ocr_engine import OCREngine
                self.engine = OCREngine(self.local_model_config)
        return self.engine

    def recognize(self, image: Image.Image, page_number: int, timeout_seconds: float) -> list[OCRPrediction]:
        # PaddleOCR has no per-call cancellation API. The hybrid coordinator
        # enforces a caller-visible deadline and records a timeout safely.
        engine = self._engine_or_create()
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

    def recognize_regions(self, regions: Sequence[OCRRegion], page_number: int, timeout_seconds: float) -> list[OCRPrediction]:
        """Run the local engine only on bounded crops and restore page coordinates."""
        output: list[OCRPrediction] = []
        for region in regions:
            left, top, _, _ = _bounds(region.polygon)
            for prediction in self.recognize(region.image, page_number, timeout_seconds):
                output.append(_translate_prediction(prediction, left, top))
        return output


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
    def model_storage_directory(self) -> Path:
        return self._model_storage_directory

    def _resolved_model_storage_directory(self) -> Path:
        candidates = [self._model_storage_directory]
        nested = self._model_storage_directory / "model"
        if nested.exists():
            candidates.append(nested)
        for candidate in candidates:
            if not candidate.is_dir():
                continue
            if any(candidate.joinpath(name).is_file() for name in ("english_g2.pth", "craft_mlt_25k.pth")):
                return candidate
        return self._model_storage_directory

    @property
    def initialization_elapsed_ms(self) -> float | None:
        return self._initialization_elapsed_ms

    @property
    def last_inference_elapsed_ms(self) -> float | None:
        return self._last_inference_elapsed_ms

    def _reader_or_raise(self) -> Any:
        if self._reader is not None:
            return self._reader
        model_directory = self._resolved_model_storage_directory()
        if not model_directory.is_dir():
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
                try:
                    self._reader = easyocr.Reader(
                        list(self._languages),
                        gpu=False,
                        model_storage_directory=str(model_directory),
                        download_enabled=False,
                        verbose=False,
                    )
                except FileNotFoundError as error:
                    raise OCRProviderError("EasyOCR local model assets are unavailable.") from error
            finally:
                self._initialization_elapsed_ms = (perf_counter() - started) * 1000
        self._model_storage_directory = model_directory
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

    def recognize_regions(self, regions: Sequence[OCRRegion], page_number: int, timeout_seconds: float) -> list[OCRPrediction]:
        output: list[OCRPrediction] = []
        for region in regions:
            left, top, _, _ = _bounds(region.polygon)
            for prediction in self.recognize(region.image, page_number, timeout_seconds):
                output.append(_translate_prediction(prediction, left, top))
        return output


class TrOCRHandwrittenProvider:
    engine_name = "trocr_base_handwritten"

    def __init__(
        self,
        *,
        model_directory: Path,
        processor: Any | None = None,
        model: Any | None = None,
        max_new_tokens: int = 64,
        max_pixels: int = 2_000_000,
        torch_num_threads: int = 1,
        torch_num_interop_threads: int = 1,
    ) -> None:
        self._model_directory = model_directory
        self._processor = processor
        self._model = model
        self._max_new_tokens = max_new_tokens
        self._max_pixels = max_pixels
        self._torch_num_threads = int(torch_num_threads)
        self._torch_num_interop_threads = int(torch_num_interop_threads)

    @property
    def model_directory(self) -> Path:
        return self._model_directory

    def _load_or_raise(self) -> tuple[Any, Any]:
        if self._processor is not None and self._model is not None:
            return self._processor, self._model
        if not self._model_directory.is_dir():
            raise OCRProviderError("TrOCR local model assets are unavailable.")
        try:
            import torch
            from transformers import TrOCRProcessor, VisionEncoderDecoderModel
        except ImportError as error:
            raise OCRProviderError("TrOCR requires transformers and torch.") from error

        if self._torch_num_threads > 0:
            torch.set_num_threads(self._torch_num_threads)
        if self._torch_num_interop_threads > 0:
            torch.set_num_interop_threads(self._torch_num_interop_threads)

        # local_files_only is the no-download boundary for this provider.
        self._processor = TrOCRProcessor.from_pretrained(str(self._model_directory), local_files_only=True)
        self._model = VisionEncoderDecoderModel.from_pretrained(str(self._model_directory), local_files_only=True)
        self._model.to("cpu")
        self._model.eval()
        return self._processor, self._model

    def recognize_regions(self, regions: Sequence[OCRRegion], page_number: int, timeout_seconds: float) -> list[OCRPrediction]:
        if not regions:
            return []
        if timeout_seconds <= 0:
            raise OCRProviderError("TrOCR requires a positive timeout.")

        processor, model = self._load_or_raise()
        prepared: list[tuple[OCRRegion, Image.Image]] = []
        for region in regions:
            prepared_image = _prepare_trocr_image(region.image, self._max_pixels)
            if prepared_image is None:
                continue
            prepared.append((region, prepared_image))
        if not prepared:
            return []

        images = [image for _, image in prepared]
        pixel_values = processor(images=images, return_tensors="pt").pixel_values
        import torch

        with torch.inference_mode():
            generated = model.generate(pixel_values, max_new_tokens=self._max_new_tokens)
        texts = processor.batch_decode(generated, skip_special_tokens=True)
        predictions: list[OCRPrediction] = []
        for (region, _), text in zip(prepared, texts, strict=True):
            cleaned = str(text).strip()
            if not cleaned:
                continue
            predictions.append(
                OCRPrediction(
                    engine_name=self.engine_name,
                    engine_version="microsoft-trocr-base-handwritten",
                    page_number=page_number,
                    text=cleaned,
                    polygon=region.polygon,
                    raw_confidence=None,
                    content_style="handwritten",
                    model_provenance="local-transformers-model-directory",
                )
            )
        return predictions


def _prepare_trocr_image(image: Image.Image, max_pixels: int = 2_000_000) -> Image.Image | None:
    rgb = image.convert("RGB")
    width, height = rgb.size
    if width <= 0 or height <= 0:
        return None
    if max_pixels <= 0:
        raise OCRProviderError("TrOCR crop limit must be positive.")
    if width * height > max_pixels:
        scale = (max_pixels / float(width * height)) ** 0.5
        rgb = rgb.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.Resampling.BILINEAR)
        width, height = rgb.size
    if min(width, height) < 8:
        raise OCRProviderError("TrOCR crop is too small for handwriting recognition.")
    if width * height > max_pixels:
        raise OCRProviderError("TrOCR crop exceeds the supported maximum dimensions.")

    gray = np.asarray(rgb.convert("L"), dtype=np.float32)
    if gray.size == 0 or float(gray.std()) < 6.0:
        return None

    padding = max(8, int(min(width, height) * 0.08))
    padded = ImageOps.expand(rgb, border=padding, fill="white")
    return padded


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
        if response is None:
            raise OCRProviderError("Google Vision returned a malformed response.")
        api_error = getattr(getattr(response, "error", None), "message", "")
        if api_error:
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
        numbered_rows: tuple[UnverifiedNumberedRow, ...] = ()
        review_warnings: tuple[str, ...] = ()
        easyocr_provider = next(
            (
                provider
                for provider in self.whole_page_providers
                if isinstance(provider, EasyOCRProvider)
            ),
            None,
        )
        if easyocr_provider is not None:
            easyocr_predictions = [
                prediction
                for prediction in predictions
                if prediction.engine_name == easyocr_provider.engine_name
            ]
            review_blocks = [
                OCRBlock(
                    text=prediction.text,
                    confidence=prediction.raw_confidence or 0.0,
                    bounding_box=[list(point) for point in prediction.polygon or ()],
                )
                for prediction in easyocr_predictions
                if prediction.polygon
            ]
            region = infer_numbered_list_region(review_blocks, image.size)
            if region is not None:
                try:
                    left, top, _, _ = region
                    crop = image.crop(region)
                    crop_predictions = easyocr_provider.recognize(
                        crop,
                        page_number,
                        self.per_engine_timeout_seconds,
                    )
                    crop_blocks = [
                        OCRBlock(
                            text=prediction.text,
                            confidence=prediction.raw_confidence or 0.0,
                            bounding_box=[list(point) for point in prediction.polygon or ()],
                        )
                        for prediction in crop_predictions
                        if prediction.polygon
                    ]
                    crop_page = OCRPageResult(
                        full_text="\n".join(block.text for block in crop_blocks),
                        blocks=crop_blocks,
                    )
                    detected_rows = detect_unverified_numbered_rows(
                        crop_page,
                        page_number=page_number,
                        page_size=crop.size,
                    )
                    numbered_rows = tuple(
                        _translate_numbered_row(row, left, top)
                        for row in detected_rows
                    )
                    if not numbered_rows:
                        review_warnings = (
                            "A numbered text region was found but could not be segmented into review rows.",
                        )
                except Exception:
                    review_warnings = (
                        "A numbered text region was found but OCR row review was unavailable.",
                    )
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
            unverified_numbered_rows=numbered_rows,
            review_warnings=review_warnings,
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


def _translate_numbered_row(
    row: UnverifiedNumberedRow,
    horizontal_offset: int,
    vertical_offset: int,
) -> UnverifiedNumberedRow:
    def translate(points: list[list[float]]) -> list[list[float]]:
        return [
            [x + horizontal_offset, y + vertical_offset]
            for x, y in points
        ]

    evidence = tuple(
        OCRBlock(
            text=block.text,
            confidence=block.confidence,
            bounding_box=translate(block.bounding_box),
        )
        for block in row.evidence
    )
    return UnverifiedNumberedRow(
        candidate_sequence_number=row.candidate_sequence_number,
        observed_number=row.observed_number,
        raw_text=row.raw_text,
        page_number=row.page_number,
        confidence=row.confidence,
        bounding_box=translate(row.bounding_box),
        evidence=evidence,
    )


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


def _translate_prediction(prediction: OCRPrediction, horizontal: float, vertical: float) -> OCRPrediction:
    polygon = None if prediction.polygon is None else tuple(
        (x + horizontal, y + vertical) for x, y in prediction.polygon
    )
    return OCRPrediction(
        prediction.engine_name, prediction.engine_version, prediction.page_number,
        prediction.text, polygon, prediction.raw_confidence, prediction.content_style,
        prediction.model_provenance,
    )


def _conflict_indicators(predictions: Sequence[OCRPrediction]) -> tuple[str, ...]:
    import re
    normalized = [" ".join(item.text.casefold().split()) for item in predictions]
    indicators: list[str] = []
    numbers = [{value for value in re.findall(r"(?<!\w)\d+(?:\.\d+)?", text)} for text in normalized]
    units = [{value for value in re.findall(r"\b(?:mg|mcg|g|ml|iu|units?)\b", text)} for text in normalized]
    frequencies = [{value for value in re.findall(r"\b(?:od|bd|bid|tds|tid|qid|once|twice|daily)\b", text)} for text in normalized]
    if len({tuple(sorted(value)) for value in numbers}) > 1:
        indicators.append("numeric_conflict")
    if len({tuple(sorted(value)) for value in units}) > 1:
        indicators.append("unit_conflict")
    if len({tuple(sorted(value)) for value in frequencies}) > 1:
        indicators.append("frequency_conflict")
    if len(set(normalized)) > 1 and not indicators:
        indicators.append("text_conflict")
    return tuple(indicators)


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
            reconciled.append(ReconciledOCRRegion(
                ordered, "disagreement", None,
                "Conflicting provider text was withheld; provider confidence scales were not compared.",
                _conflict_indicators(ordered),
            ))
        else:
            # Cross-provider scores are not calibrated. Preserve provider order
            # and select the first observation when normalized text agrees.
            chosen = group[0]
            state = "agreement" if len(group) > 1 else "single_source"
            rationale = ("Normalized provider text agreed; the primary observation was retained without comparing confidence scales."
                         if len(group) > 1 else "Only one provider supplied this region.")
            reconciled.append(ReconciledOCRRegion(ordered, state, chosen, rationale, ()))
    return reconciled


MappingLike = dict[str, Any]
