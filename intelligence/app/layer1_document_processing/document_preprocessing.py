from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageStat


MAX_PREPROCESS_DIMENSION = 2200


@dataclass
class DocumentQualityMetrics:
    blur_score: float
    contrast_ratio: float
    brightness: float
    rotation_estimate_degrees: float
    skew_estimate_degrees: float
    resolution: int
    shadow_score: float
    clipped_to_edge: bool
    low_resolution: bool
    unreadable_small_text: bool
    reasons: list[str] = field(default_factory=list)


@dataclass
class PreprocessingResult:
    image: Image.Image
    quality: DocumentQualityMetrics
    applied_steps: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    original_size: tuple[int, int] | None = None
    output_size: tuple[int, int] | None = None


def _safe_open_image(file_path: str | Path) -> Image.Image:
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Image file not found: {file_path}")
    with Image.open(path) as image:
        return ImageOps.exif_transpose(image).convert("RGB").copy()


def _luminance_stats(image: Image.Image) -> tuple[float, float]:
    gray = ImageOps.grayscale(image)
    stats = ImageStat.Stat(gray)
    return float(stats.mean[0]), float(stats.stddev[0])


def _compute_blur_score(gray: Image.Image) -> float:
    edges = gray.filter(ImageFilter.FIND_EDGES)
    array = np.asarray(edges, dtype=np.float32)
    edge_spread = float(array.std())
    return 100.0 / (edge_spread + 1.0)


def _estimate_skew_deg(gray: Image.Image) -> float:
    working = gray.convert("L").copy()
    working.thumbnail((512, 512), Image.Resampling.BILINEAR)
    source = np.asarray(working, dtype=np.uint8)
    threshold = min(220.0, float(source.mean()) * 0.9)
    baseline = float(np.var(np.count_nonzero(source < threshold, axis=1)))
    best_angle = 0.0
    best_score = baseline

    for angle in range(-8, 9):
        if angle == 0:
            continue
        rotated = working.rotate(angle, expand=True, fillcolor=255)
        array = np.asarray(rotated, dtype=np.uint8)
        score = float(np.var(np.count_nonzero(array < threshold, axis=1)))
        if score > best_score:
            best_score = score
            best_angle = float(angle)

    if best_angle and best_score < baseline * 1.05:
        return 0.0
    # Return the rotation to apply, not the observed slant direction.
    return best_angle


def analyze_document_quality(image: Image.Image) -> DocumentQualityMetrics:
    """Return conservative quality diagnostics for a prescription image.

    These values are intended for pipeline triage and transformation selection.
    They are not clinically meaningful confidences.
    """

    rgb = image.convert("RGB")
    gray = ImageOps.grayscale(rgb)
    mean_luminance, stddev_luminance = _luminance_stats(rgb)
    blur_score = _compute_blur_score(gray)
    shadow_score = 0.0
    clipped = False

    edges = np.asarray(gray)
    content_mask = edges < 245
    if content_mask.any():
        y0, x0 = np.where(content_mask)
        bbox = (x0.min(), y0.min(), x0.max(), y0.max())
        width = gray.width
        height = gray.height
        border_margin = min(width, height) * 0.05
        clipped = (
            bbox[0] < border_margin
            or bbox[1] < border_margin
            or bbox[2] > width - border_margin
            or bbox[3] > height - border_margin
        )

        corners = [
            edges[: max(2, height // 8), : max(2, width // 8)],
            edges[: max(2, height // 8), -max(2, width // 8) :],
            edges[-max(2, height // 8) :, : max(2, width // 8)],
            edges[-max(2, height // 8) :, -max(2, width // 8) :],
        ]
        corner_brightness = [
            float(np.mean(corner))
            for corner in corners
            if corner.size
        ]
        shadow_score = (
            max(corner_brightness) - min(corner_brightness)
        ) / 255.0

    contrast_ratio = float(stddev_luminance / max(1.0, mean_luminance + 1.0))
    resolution = max(image.size)
    low_resolution = resolution < 900
    unreadable_small_text = image.width < 600 or image.height < 400
    skew = _estimate_skew_deg(gray)

    reasons: list[str] = []
    if blur_score > 25:
        reasons.append("blur_or_low_edge_detail")
    if contrast_ratio < 0.08:
        reasons.append("low_contrast")
    if mean_luminance < 110:
        reasons.append("dark_background")
    if abs(skew) > 3.0:
        reasons.append("skew_detected")
    if shadow_score > 0.18:
        reasons.append("shadowing_detected")
    if clipped:
        reasons.append("content_near_edge")
    if low_resolution:
        reasons.append("low_resolution")
    if unreadable_small_text:
        reasons.append("small_text_risk")

    return DocumentQualityMetrics(
        blur_score=blur_score,
        contrast_ratio=contrast_ratio,
        brightness=mean_luminance,
        rotation_estimate_degrees=skew,
        skew_estimate_degrees=skew,
        resolution=resolution,
        shadow_score=shadow_score,
        clipped_to_edge=clipped,
        low_resolution=low_resolution,
        unreadable_small_text=unreadable_small_text,
        reasons=reasons,
    )


def _should_autocontrast(quality: DocumentQualityMetrics) -> bool:
    return quality.contrast_ratio < 0.12 or quality.brightness < 120


def _safe_resize_preserving_aspect(image: Image.Image, max_dimension: int = MAX_PREPROCESS_DIMENSION) -> Image.Image:
    width, height = image.size
    scale = min(max_dimension / max(width, height), 1.0)
    if scale < 1.0:
        new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
        return image.resize(new_size, Image.Resampling.LANCZOS)
    return image.copy()


def apply_safe_image_preprocessing(
    image: Image.Image,
    *,
    max_dimension: int = MAX_PREPROCESS_DIMENSION,
    deskew_limit_degrees: float = 15.0,
    allow_perspective: bool = False,
) -> PreprocessingResult:
    """Apply conservative preprocessing on a copy of the image.

    The implementation is intentionally fail-closed: it preserves the original
    pixels and only applies a small number of bounded transformations when there
    is evidence they are beneficial.
    """

    original = image.convert("RGB")
    quality = analyze_document_quality(original)
    working = original.copy()
    applied_steps: list[str] = []
    warnings: list[str] = []

    if max_dimension and max(original.size) > max_dimension:
        working = _safe_resize_preserving_aspect(working, max_dimension=max_dimension)
        applied_steps.append("resized")

    if (
        abs(quality.skew_estimate_degrees) > 0.5
        and abs(quality.skew_estimate_degrees) <= min(deskew_limit_degrees, 5.0)
        and not quality.clipped_to_edge
    ):
        working = working.rotate(
            quality.skew_estimate_degrees,
            expand=False,
            fillcolor=(255, 255, 255),
        )
        applied_steps.append("deskewed")
    elif abs(quality.skew_estimate_degrees) > 0.5:
        warnings.append("deskew_skipped_for_character_or_edge_safety")

    if _should_autocontrast(quality):
        working = ImageOps.autocontrast(working)
        applied_steps.append("autocontrast")

    if allow_perspective and quality.clipped_to_edge and abs(quality.skew_estimate_degrees) > 3:
        warnings.append("perspective_correction_not_applied")

    if quality.low_resolution:
        warnings.append("document_is_low_resolution")
    if quality.unreadable_small_text:
        warnings.append("small_text_risk")
    if quality.shadow_score > 0.18:
        warnings.append("shadowing_detected")
    if quality.blur_score > 25:
        warnings.append("blur_or_low_edge_detail")

    return PreprocessingResult(
        image=working,
        quality=quality,
        applied_steps=applied_steps,
        warnings=warnings,
        original_size=original.size,
        output_size=working.size,
    )


def normalize_document_image(
    file_path: str | Path,
    *,
    max_dimension: int = MAX_PREPROCESS_DIMENSION,
    deskew_limit_degrees: float = 15.0,
) -> PreprocessingResult:
    """Open an image file, normalize orientation, and return safe preprocessing output."""

    image = _safe_open_image(file_path)
    return apply_safe_image_preprocessing(
        image,
        max_dimension=max_dimension,
        deskew_limit_degrees=deskew_limit_degrees,
    )
