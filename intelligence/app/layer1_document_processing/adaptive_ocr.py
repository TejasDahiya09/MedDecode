from __future__ import annotations

from dataclasses import dataclass
from math import atan2, degrees
from typing import Sequence

import numpy as np
from PIL import Image

from app.layer1_document_processing.hybrid_ocr import OCRPrediction, OCRRegion

CONTRAST_STDDEV_THRESHOLD = 18.0
SHARPNESS_VARIANCE_THRESHOLD = 35.0
MIN_TEXT_DENSITY = 0.005
LOW_CONFIDENCE_THRESHOLD = 0.55
SKEW_THRESHOLD_DEGREES = 4.0
LAYOUT_IRREGULARITY_THRESHOLD = 0.35


@dataclass(frozen=True)
class DocumentQualityAssessment:
    contrast: float
    blur_score: float
    rotation_estimate_degrees: float
    resolution: int
    text_density: float
    layout_irregularity: float
    low_confidence_region_count: int
    handwritten_likelihood: float
    needs_secondary_ocr: bool
    reasons: tuple[str, ...] = ()
    unrecognized_region_count: int = 0
    handwriting_classification: str = "unknown"


@dataclass(frozen=True)
class AdaptiveRoutingResult:
    primary_predictions: tuple[OCRPrediction, ...]
    secondary_predictions: tuple[OCRPrediction, ...]
    quality: DocumentQualityAssessment
    warnings: tuple[str, ...] = ()
    fallback_regions: tuple[OCRRegion, ...] = ()


class AdaptiveOCRRouter:
    """Local routing policy that keeps EasyOCR as the primary baseline."""

    def __init__(
        self,
        *,
        primary_provider: object | None = None,
        secondary_provider: object | None = None,
        handwritten_provider: object | None = None,
        max_fallback_regions: int = 12,
        max_fallback_pixels: int = 20_000_000,
        crop_padding_pixels: int = 8,
    ) -> None:
        if not 1 <= max_fallback_regions <= 100 or not 1 <= max_fallback_pixels <= 100_000_000 or not 0 <= crop_padding_pixels <= 128:
            raise ValueError("Fallback region limits are invalid.")
        self.primary_provider = primary_provider
        self.secondary_provider = secondary_provider
        self.handwritten_provider = handwritten_provider
        self.max_fallback_regions = max_fallback_regions
        self.max_fallback_pixels = max_fallback_pixels
        self.crop_padding_pixels = crop_padding_pixels

    def route(
        self,
        image: Image.Image,
        page_number: int,
        *,
        timeout_seconds: float = 15.0,
    ) -> AdaptiveRoutingResult:
        if self.primary_provider is None:
            return AdaptiveRoutingResult(
                (),
                (),
                DocumentQualityAssessment(0.0, 0.0, 0.0, image.width * image.height, 0.0, 0.0, 0, 0.0, False, unrecognized_region_count=1),
                ("No primary OCR provider configured.",),
            )

        primary_predictions = self.primary_provider.recognize(image, page_number, timeout_seconds)
        quality = analyze_document_quality(image, primary_predictions)
        crop_regions = build_fallback_regions(
            image, primary_predictions, confidence_threshold=LOW_CONFIDENCE_THRESHOLD,
            padding=self.crop_padding_pixels, max_regions=self.max_fallback_regions,
            max_total_pixels=self.max_fallback_pixels,
        )
        secondary_predictions: list[OCRPrediction] = []
        warnings: list[str] = []

        if quality.needs_secondary_ocr and self.secondary_provider is not None:
            try:
                recognize_regions = getattr(self.secondary_provider, "recognize_regions", None)
                if crop_regions and callable(recognize_regions):
                    secondary_predictions = list(recognize_regions(crop_regions, page_number, timeout_seconds))
                elif not primary_predictions or _whole_page_fallback_required(quality):
                    secondary_predictions = list(self.secondary_provider.recognize(image, page_number, timeout_seconds))
                elif crop_regions:
                    warnings.append("Secondary OCR does not support bounded region recognition; full-page fallback was withheld.")
            except Exception:
                warnings.append("Secondary local OCR provider was unavailable.")

        if quality.handwriting_classification == "possible" and self.handwritten_provider is not None:
            try:
                if crop_regions:
                    handwritten = self.handwritten_provider.recognize_regions(crop_regions, page_number, timeout_seconds)
                    secondary_predictions.extend(handwritten)
            except Exception:
                warnings.append("Handwritten line OCR provider was unavailable.")

        return AdaptiveRoutingResult(
            primary_predictions=tuple(primary_predictions),
            secondary_predictions=tuple(secondary_predictions),
            quality=quality,
            warnings=tuple(warnings),
            fallback_regions=tuple(crop_regions),
        )


def analyze_document_quality(image: Image.Image, predictions: Sequence[OCRPrediction]) -> DocumentQualityAssessment:
    """Return deterministic signals with explicit units and bounded ranges.

    Contrast is grayscale standard deviation in intensity levels [0, 127.5].
    ``blur_score`` is discrete-Laplacian variance in intensity squared (larger
    is sharper). Resolution is source pixels. Density and irregularity are
    fractions in [0, 1]. Rotation is median OCR top-edge angle in degrees.
    The handwriting value is an uncertainty-routing heuristic, not a diagnosis.
    """
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    contrast = float(np.std(gray)) if gray.size else 0.0
    if gray.shape[0] >= 3 and gray.shape[1] >= 3:
        laplacian = (-4.0 * gray[1:-1, 1:-1] + gray[:-2, 1:-1] + gray[2:, 1:-1]
                     + gray[1:-1, :-2] + gray[1:-1, 2:])
        blur_score = float(np.var(laplacian))
    else:
        blur_score = 0.0

    valid = [item for item in predictions if item.text.strip()]
    low_confidence = [item for item in valid if item.raw_confidence is not None
                      and item.raw_confidence < LOW_CONFIDENCE_THRESHOLD]
    covered_area = 0.0
    centers: list[float] = []
    angles: list[float] = []
    for prediction in valid:
        if not prediction.polygon:
            continue
        xs = [point[0] for point in prediction.polygon]
        ys = [point[1] for point in prediction.polygon]
        left, top, right, bottom = min(xs), min(ys), max(xs), max(ys)
        centers.append((top + bottom) / 2.0)
        covered_area += max(0.0, (right - left) * (bottom - top))
        if len(prediction.polygon) >= 2:
            dx = prediction.polygon[1][0] - prediction.polygon[0][0]
            dy = prediction.polygon[1][1] - prediction.polygon[0][1]
            if dx or dy:
                angle = degrees(atan2(dy, dx))
                while angle > 90:
                    angle -= 180
                while angle < -90:
                    angle += 180
                if -45 <= angle <= 45:
                    angles.append(angle)

    text_density = min(1.0, covered_area / max(1, image.width * image.height))
    rotation_estimate_degrees = float(np.median(angles)) if angles else 0.0

    layout_irregularity = 0.0
    if len(centers) >= 3:
        gaps = np.diff(sorted(centers))
        median_gap = float(np.median(gaps))
        if median_gap > 0:
            layout_irregularity = min(1.0, float(np.median(np.abs(gaps - median_gap))) / median_gap)

    unrecognized_region_count = 1 if not valid else 0
    handwritten_likelihood = min(1.0, 0.20 * len(low_confidence)
        + (0.25 if text_density < MIN_TEXT_DENSITY else 0.0)
        + (0.20 if layout_irregularity > LAYOUT_IRREGULARITY_THRESHOLD else 0.0))
    handwriting_classification = "possible" if handwritten_likelihood >= 0.5 else "unknown"
    reasons: list[str] = []
    if contrast < CONTRAST_STDDEV_THRESHOLD:
        reasons.append("low contrast")
    if blur_score < SHARPNESS_VARIANCE_THRESHOLD:
        reasons.append("low sharpness")
    if abs(rotation_estimate_degrees) > SKEW_THRESHOLD_DEGREES:
        reasons.append("page text skew")
    if text_density < MIN_TEXT_DENSITY:
        reasons.append("low detected text density")
    if len(low_confidence) > 0:
        reasons.append("low confidence OCR regions")
    if layout_irregularity > LAYOUT_IRREGULARITY_THRESHOLD:
        reasons.append("layout irregularity")
    if unrecognized_region_count:
        reasons.append("no recognized text regions")
    if handwriting_classification == "possible":
        reasons.append("possible handwriting; unverified heuristic")

    return DocumentQualityAssessment(
        contrast=float(contrast),
        blur_score=float(blur_score),
        rotation_estimate_degrees=float(rotation_estimate_degrees),
        resolution=int(image.width * image.height),
        text_density=float(text_density),
        layout_irregularity=float(layout_irregularity),
        low_confidence_region_count=len(low_confidence),
        handwritten_likelihood=float(handwritten_likelihood),
        needs_secondary_ocr=bool(reasons),
        reasons=tuple(reasons),
        unrecognized_region_count=unrecognized_region_count,
        handwriting_classification=handwriting_classification,
    )


def build_fallback_regions(image: Image.Image, predictions: Sequence[OCRPrediction], *,
    confidence_threshold: float = LOW_CONFIDENCE_THRESHOLD, padding: int = 8,
    max_regions: int = 12, max_total_pixels: int = 20_000_000) -> list[OCRRegion]:
    """Return deduplicated, bounded line crops in original-page coordinates."""
    boxes: list[tuple[int, int, int, int]] = []
    for item in predictions:
        if not item.polygon or (item.raw_confidence is not None and item.raw_confidence >= confidence_threshold):
            continue
        xs, ys = zip(*item.polygon, strict=True)
        box = (max(0, int(min(xs)) - padding), max(0, int(min(ys)) - padding),
               min(image.width, int(np.ceil(max(xs))) + padding),
               min(image.height, int(np.ceil(max(ys))) + padding))
        if box[2] > box[0] and box[3] > box[1]:
            boxes.append(box)
    merged: list[tuple[int, int, int, int]] = []
    for box in sorted(boxes, key=lambda value: (value[1], value[0])):
        for index, current in enumerate(merged):
            overlap = max(0, min(box[3], current[3]) - max(box[1], current[1]))
            min_height = max(1, min(box[3] - box[1], current[3] - current[1]))
            gap = max(0, max(box[0], current[0]) - min(box[2], current[2]))
            if overlap / min_height >= 0.5 and gap <= max(24, padding * 4):
                merged[index] = (min(box[0], current[0]), min(box[1], current[1]),
                                 max(box[2], current[2]), max(box[3], current[3]))
                break
        else:
            merged.append(box)
    regions: list[OCRRegion] = []
    total = 0
    for left, top, right, bottom in merged:
        pixels = (right - left) * (bottom - top)
        if pixels <= 0 or total + pixels > max_total_pixels or len(regions) >= max_regions:
            continue
        total += pixels
        polygon = ((float(left), float(top)), (float(right), float(top)),
                   (float(right), float(bottom)), (float(left), float(bottom)))
        regions.append(OCRRegion(polygon, image.crop((left, top, right, bottom))))
    return regions


def _whole_page_fallback_required(quality: DocumentQualityAssessment) -> bool:
    return quality.unrecognized_region_count > 0 or abs(quality.rotation_estimate_degrees) > SKEW_THRESHOLD_DEGREES
