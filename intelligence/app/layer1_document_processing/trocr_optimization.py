"""TrOCR-specific memory and preprocessing helpers.

This module is intentionally independent of the shared hybrid OCR pipeline. It
contains only local, fail-closed utilities for benchmarking, preprocessing, and
experimental low-memory checks for the approved handwritten checkpoint.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from time import perf_counter
from typing import Any, Sequence

import numpy as np
from PIL import Image, ImageEnhance, ImageOps

try:  # pragma: no cover - optional dependency, available in isolated TrOCR env.
    import psutil
except ImportError:  # pragma: no cover
    psutil = None


@dataclass(frozen=True)
class TrOCROptimizationConfig:
    min_short_edge: int = 8
    max_aspect_ratio: float = 14.0
    max_pixels: int = 2_000_000
    padding_ratio: float = 0.08
    background_threshold: float = 6.0
    max_new_tokens: int = 64
    torch_num_threads: int = 1
    torch_num_interop_threads: int = 1
    allow_quantization: bool = False


@dataclass
class TrOCRMemorySnapshot:
    process_rss_bytes: int = 0
    process_private_bytes: int = 0
    tree_rss_bytes: int = 0
    tree_private_bytes: int = 0
    timestamp_ms: float = 0.0


@dataclass
class TrOCRMemoryProfile:
    baseline: TrOCRMemorySnapshot = field(default_factory=TrOCRMemorySnapshot)
    after_model_load: TrOCRMemorySnapshot = field(default_factory=TrOCRMemorySnapshot)
    after_inference: TrOCRMemorySnapshot = field(default_factory=TrOCRMemorySnapshot)
    after_release: TrOCRMemorySnapshot = field(default_factory=TrOCRMemorySnapshot)
    inference_seconds: float = 0.0
    outputs: tuple[str, ...] = ()
    quantization_status: str = "not_attempted"


def _memory_snapshot() -> TrOCRMemorySnapshot:
    if psutil is None:
        return TrOCRMemorySnapshot()
    process = psutil.Process()
    info = process.memory_info()
    full = process.memory_full_info() if hasattr(process, "memory_full_info") else info
    rss = int(getattr(info, "rss", 0))
    private = int(getattr(full, "uss", rss))
    children = process.children(recursive=True)
    tree_rss = rss + sum(int(child.memory_info().rss) for child in children)
    child_private_values = [
        int(child.memory_full_info().uss)
        for child in children
        if hasattr(child, "memory_full_info")
    ]
    tree_private = private + sum(child_private_values)
    return TrOCRMemorySnapshot(
        process_rss_bytes=rss,
        process_private_bytes=private,
        tree_rss_bytes=tree_rss,
        tree_private_bytes=tree_private,
        timestamp_ms=perf_counter() * 1000.0,
    )


def prepare_handwriting_line_image(
    image: Image.Image,
    *,
    max_pixels: int = 2_000_000,
    min_short_edge: int = 8,
    max_aspect_ratio: float = 14.0,
    padding_ratio: float = 0.08,
    background_threshold: float = 6.0,
) -> Image.Image | None:
    """Prepare a single-line crop for TrOCR while preserving medication text details."""
    rgb = image.convert("RGB")
    width, height = rgb.size
    if width <= 0 or height <= 0:
        return None
    if width * height > max_pixels:
        scale = (max_pixels / float(width * height)) ** 0.5
        width = max(1, int(width * scale))
        height = max(1, int(height * scale))
        rgb = rgb.resize((width, height), Image.Resampling.BILINEAR)
    if min(width, height) < min_short_edge:
        raise ValueError("TrOCR crop is too small for handwriting recognition.")
    if max(width, height) / max(1, min(width, height)) > max_aspect_ratio:
        raise ValueError("TrOCR crop aspect ratio exceeds the supported handwriting range.")
    gray = np.asarray(rgb.convert("L"), dtype=np.float32)
    if gray.size == 0 or float(gray.std()) < background_threshold:
        return None
    contrasted = ImageEnhance.Contrast(ImageOps.autocontrast(rgb)).enhance(1.25)
    padding = max(8, int(min(contrasted.size) * padding_ratio))
    padded = ImageOps.expand(contrasted, border=padding, fill="white")
    return padded


def maybe_apply_dynamic_int8_quantization(model: Any, *, quantizer: Any | None = None) -> tuple[Any, dict[str, Any]]:
    """Attempt dynamic INT8 quantization in a fail-closed way.

    On the approved CPU-only TrOCR stack, this is an experimental path. It is
    only used when explicitly requested by a TrOCR-specific benchmark and never
    as a silent default.
    """
    if quantizer is None:
        try:
            import torch
        except ImportError as error:  # pragma: no cover
            return model, {"status": "unsupported", "reason": f"torch-not-installed:{type(error).__name__}"}
        try:
            quantizer = torch.quantization.quantize_dynamic
        except AttributeError as error:  # pragma: no cover
            return model, {"status": "unsupported", "reason": f"quantize_dynamic-unavailable:{type(error).__name__}"}
    try:
        quantized = quantizer(model, {__import__("torch").nn.Linear}, dtype=__import__("torch").qint8)
        return quantized, {"status": "ok", "reason": "dynamic-int8"}
    except Exception as error:  # pragma: no cover - still valid test behavior.
        return model, {"status": "unsupported", "reason": type(error).__name__}


def profile_trocr_model(
    *,
    model_directory: Path,
    sample_images: Sequence[Image.Image],
    max_new_tokens: int = 64,
    quantize: bool = False,
) -> TrOCRMemoryProfile:
    """Measure a local TrOCR model configuration without touching shared OCR code."""
    if not model_directory.is_dir():
        raise FileNotFoundError(model_directory)
    baseline = _memory_snapshot()
    try:
        import torch
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel
    except ImportError as error:  # pragma: no cover
        raise RuntimeError("TrOCR optimization is unavailable without torch/transformers.") from error

    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    processor = TrOCRProcessor.from_pretrained(str(model_directory), local_files_only=True)
    model = VisionEncoderDecoderModel.from_pretrained(str(model_directory), local_files_only=True)
    model.to("cpu")
    model.eval()
    after_model_load = _memory_snapshot()

    quantization_status = "not_attempted"
    if quantize:
        model, status = maybe_apply_dynamic_int8_quantization(model)
        quantization_status = status.get("status", "not_attempted")

    input_batch = processor(images=list(sample_images), return_tensors="pt")
    inference_started = perf_counter()
    with torch.inference_mode():
        generated = model.generate(input_batch.pixel_values, max_new_tokens=max_new_tokens)
    inference_seconds = perf_counter() - inference_started
    outputs = tuple(str(item).strip() for item in processor.batch_decode(generated, skip_special_tokens=True))
    after_inference = _memory_snapshot()

    del generated, input_batch, model, processor
    import gc
    gc.collect()
    after_release = _memory_snapshot()

    return TrOCRMemoryProfile(
        baseline=baseline,
        after_model_load=after_model_load,
        after_inference=after_inference,
        after_release=after_release,
        inference_seconds=inference_seconds,
        outputs=outputs,
        quantization_status=quantization_status,
    )
