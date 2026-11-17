"""Guarded EasyOCR/PaddleOCR integration for the supervised processing child.

This module deliberately excludes handwriting providers.  It composes the
Phase 2.1 adaptive router with the existing conservative reconciliation data
types, while leaving TrOCR disabled until its separate review is complete.
"""

from __future__ import annotations

import gc
from pathlib import Path
from time import perf_counter

from PIL import Image

from app.layer1_document_processing.adaptive_ocr import AdaptiveOCRRouter
from app.layer1_document_processing.hybrid_ocr import (
    EasyOCRProvider,
    HybridOCRPageResult,
    PaddleOCRProvider,
    ReconciledOCRRegion,
    _reconcile,
)
from app.layer1_document_processing.ocr_engine import PaddleOCRLocalModelConfig
from app.layer1_document_processing.trocr_ipc import (
    TrOCRIPCError,
    TrOCRSubprocessConfig,
    TrOCRSubprocessProvider,
)


class _MemoryBoundEasyOCRProvider(EasyOCRProvider):
    """Release EasyOCR weights before a possible PaddleOCR initialization.

    The supervised child is single-document and memory-bounded. Keeping both
    native model stacks resident exceeded that established boundary on a real
    JPEG. Paddle remains cached because it may process several bounded crops;
    EasyOCR is reloaded only if another page needs it.
    """

    def recognize(self, image: Image.Image, page_number: int, timeout_seconds: float):
        try:
            return super().recognize(image, page_number, timeout_seconds)
        finally:
            self._reader = None
            gc.collect()


class AdaptiveEasyPaddleOCREngine:
    """Run EasyOCR first and selectively route uncertain regions to PaddleOCR."""

    def __init__(
        self,
        *,
        easyocr_model_directory: Path,
        paddle_detection_model_directory: Path,
        paddle_recognition_model_directory: Path,
        per_engine_timeout_seconds: float = 60.0,
        trocr_enabled: bool = False,
        trocr_interpreter: Path | None = None,
        trocr_model_directory: Path | None = None,
        trocr_timeout_seconds: float = 20.0,
        max_process_tree_rss_bytes: int = 2 * 1024 * 1024 * 1024,
    ) -> None:
        if per_engine_timeout_seconds <= 0:
            raise ValueError("OCR timeout must be positive.")
        paddle_config = PaddleOCRLocalModelConfig(
            text_detection_model_dir=paddle_detection_model_directory,
            text_recognition_model_dir=paddle_recognition_model_directory,
        )
        paddle_config.validate()
        self._timeout_seconds = per_engine_timeout_seconds
        self._router = AdaptiveOCRRouter(
            primary_provider=_MemoryBoundEasyOCRProvider(
                model_storage_directory=easyocr_model_directory,
            ),
            secondary_provider=PaddleOCRProvider(paddle_config),
            # TrOCR is intentionally absent from the live path.
            handwritten_provider=None,
        )
        self._trocr_provider: TrOCRSubprocessProvider | None = None
        if trocr_enabled:
            if trocr_interpreter is None or trocr_model_directory is None:
                raise ValueError("TrOCR requires explicit isolated runtime assets.")
            self._trocr_provider = TrOCRSubprocessProvider(TrOCRSubprocessConfig(
                interpreter=trocr_interpreter,
                model_directory=trocr_model_directory,
                timeout_seconds=trocr_timeout_seconds,
                max_process_tree_rss_bytes=max_process_tree_rss_bytes,
            ))

    def recognize_page(self, image: Image.Image, page_number: int) -> HybridOCRPageResult:
        started = perf_counter()
        routed = self._router.route(
            image,
            page_number,
            timeout_seconds=self._timeout_seconds,
        )
        handwritten_predictions = ()
        trocr_status = "disabled"
        trocr_provider = getattr(self, "_trocr_provider", None)
        if (
            trocr_provider is not None
            and routed.quality.handwriting_classification == "possible"
            and routed.fallback_regions
        ):
            # TrOCR's isolated process has a measured ~1.63 GiB peak. Drop the
            # Paddle engine before launch so all descendants remain inside the
            # unchanged 2 GiB request-tree budget.
            secondary = getattr(self._router, "secondary_provider", None)
            if isinstance(secondary, PaddleOCRProvider):
                secondary.engine = None
            gc.collect()
            try:
                handwritten_predictions = tuple(trocr_provider.recognize_regions(
                    routed.fallback_regions,
                    page_number,
                    min(self._timeout_seconds, trocr_provider.config.timeout_seconds),
                ))
            except TrOCRIPCError:
                handwritten_predictions = ()
            trocr_status = trocr_provider.last_status_code
        predictions = (
            *routed.primary_predictions,
            *routed.secondary_predictions,
            *handwritten_predictions,
        )
        warnings = [
            f"Adaptive OCR quality signal: {reason}."
            for reason in routed.quality.reasons
        ]
        warnings.extend(routed.warnings)
        if trocr_provider is not None and trocr_status not in {"disabled", "ok"}:
            warnings.append(
                "Handwritten line OCR was unavailable or withheld by its resource policy; existing local OCR evidence was retained."
            )
        if handwritten_predictions:
            warnings.append(
                "A handwriting uncertainty heuristic invoked local line OCR; its evidence was reconciled conservatively."
            )
        if routed.quality.needs_secondary_ocr and not routed.secondary_predictions:
            warnings.append(
                "Adaptive secondary OCR produced no usable evidence; EasyOCR evidence was retained conservatively."
            )
        regions = tuple(_withhold_low_confidence_secondary(_reconcile(predictions)))
        if any(region.state == "low_confidence_secondary" for region in regions):
            warnings.append(
                "Low-confidence PaddleOCR-only evidence was withheld from medicine extraction."
            )
        return HybridOCRPageResult(
            page_number=page_number,
            predictions=tuple(predictions),
            regions=regions,
            failures=(),
            elapsed_ms=(perf_counter() - started) * 1000,
            review_warnings=tuple(dict.fromkeys(warnings)),
        )


def _withhold_low_confidence_secondary(
    regions: list[ReconciledOCRRegion],
) -> list[ReconciledOCRRegion]:
    output: list[ReconciledOCRRegion] = []
    for region in regions:
        selected = region.selected_prediction
        if (
            region.state == "single_source"
            and selected is not None
            and selected.engine_name == "paddleocr"
            and (selected.raw_confidence is None or selected.raw_confidence < 0.55)
        ):
            output.append(ReconciledOCRRegion(
                predictions=region.predictions,
                state="low_confidence_secondary",
                selected_prediction=None,
                selection_rationale="PaddleOCR-only evidence was below the conservative acceptance threshold.",
                uncertainty_indicators=("low_confidence_secondary",),
            ))
        else:
            output.append(region)
    return output


def build_adaptive_easy_paddle_engine(
    *,
    easyocr_model_directory: Path,
    paddle_detection_model_directory: Path,
    paddle_recognition_model_directory: Path,
    per_engine_timeout_seconds: float = 60.0,
    trocr_enabled: bool = False,
    trocr_interpreter: Path | None = None,
    trocr_model_directory: Path | None = None,
    trocr_timeout_seconds: float = 20.0,
    max_process_tree_rss_bytes: int = 2 * 1024 * 1024 * 1024,
) -> AdaptiveEasyPaddleOCREngine:
    """Explicit factory used by the isolated processing child."""

    return AdaptiveEasyPaddleOCREngine(
        easyocr_model_directory=easyocr_model_directory,
        paddle_detection_model_directory=paddle_detection_model_directory,
        paddle_recognition_model_directory=paddle_recognition_model_directory,
        per_engine_timeout_seconds=per_engine_timeout_seconds,
        trocr_enabled=trocr_enabled,
        trocr_interpreter=trocr_interpreter,
        trocr_model_directory=trocr_model_directory,
        trocr_timeout_seconds=trocr_timeout_seconds,
        max_process_tree_rss_bytes=max_process_tree_rss_bytes,
    )
