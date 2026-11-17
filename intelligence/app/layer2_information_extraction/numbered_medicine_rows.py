from __future__ import annotations

import re
import statistics

from app.layer2_information_extraction.document_context import (
    PrescriptionDocumentContext,
)
from app.schemas.ocr import OCRBlock, OCRPageResult, UnverifiedNumberedRow


_NUMBER_TOKEN_PATTERN = re.compile(r"^\s*[\[(|]?\s*(\d{1,2})\s*[.)\]:|']?\s*$")


def infer_numbered_list_region(
    blocks: list[OCRBlock],
    page_size: tuple[int, int],
) -> tuple[int, int, int, int] | None:
    """Find a bounded region from repeated, left-aligned OCR number tokens."""
    page_width, page_height = page_size
    anchors = _number_anchors(blocks, page_size)
    cluster = _best_anchor_cluster(anchors, page_size)
    if cluster is None:
        return None

    x_positions = [anchor[0] for anchor in cluster]
    y_positions = sorted(anchor[1] for anchor in cluster)
    anchor_heights = [anchor[2] for anchor in cluster]
    median_x = statistics.median(x_positions)
    median_height = statistics.median(anchor_heights)
    vertical_gap = _median_anchor_gap(y_positions, median_height)
    margin = min(
        max(vertical_gap * 0.9, median_height * 2.5),
        page_height * 0.2,
    )
    left_margin = max(page_width * 0.045, median_height * 3)

    box = (
        max(0, int(median_x - left_margin)),
        max(0, int(y_positions[0] - margin)),
        min(page_width, int(median_x + page_width * 0.5)),
        min(page_height, int(y_positions[-1] + margin)),
    )
    return box if box[2] > box[0] and box[3] > box[1] else None


def detect_unverified_numbered_rows(
    page: OCRPageResult,
    *,
    page_number: int,
    page_size: tuple[int, int] | None = None,
) -> list[UnverifiedNumberedRow]:
    """Preserve list-aligned OCR rows without asserting medicine identity."""
    if not page.blocks:
        return []

    if page_size is None:
        page_size = (
            int(max((point[0] for block in page.blocks for point in block.bounding_box), default=0)) + 1,
            int(max((point[1] for block in page.blocks for point in block.bounding_box), default=0)) + 1,
        )

    anchors = _number_anchors(page.blocks, page_size)
    cluster = _best_anchor_cluster(anchors, page_size)
    if cluster is None:
        return []

    anchor_x = statistics.median(anchor[0] for anchor in cluster)
    anchor_heights = [anchor[2] for anchor in cluster]
    anchor_y = sorted(anchor[1] for anchor in cluster)
    median_height = statistics.median(anchor_heights)
    tolerance = max(page_size[0] * 0.06, median_height * 2.5)
    vertical_margin = _median_anchor_gap(anchor_y, median_height) * 0.45
    minimum_y = anchor_y[0] - vertical_margin
    maximum_y = anchor_y[-1] + vertical_margin

    context = PrescriptionDocumentContext.from_ocr_pages([page])
    lines = [
        line
        for line in context.lines
        if minimum_y <= (line.top + line.bottom) / 2 <= maximum_y
        and abs(line.left - anchor_x) <= tolerance
    ]
    lines.sort(key=lambda line: (line.top, line.left))

    rows: list[UnverifiedNumberedRow] = []
    for sequence, line in enumerate(lines, start=1):
        evidence = tuple(line.blocks)
        if not evidence or not line.text.strip():
            continue
        observed_number = _observed_number(evidence, anchor_x, tolerance)
        xs = [point[0] for block in evidence for point in block.bounding_box]
        ys = [point[1] for block in evidence for point in block.bounding_box]
        left, right = min(xs), max(xs)
        top, bottom = min(ys), max(ys)
        rows.append(
            UnverifiedNumberedRow(
                candidate_sequence_number=sequence,
                observed_number=observed_number,
                raw_text=line.text,
                page_number=page_number,
                confidence=line.confidence,
                bounding_box=[
                    [left, top],
                    [right, top],
                    [right, bottom],
                    [left, bottom],
                ],
                evidence=evidence,
            )
        )
    return rows


def _number_anchors(
    blocks: list[OCRBlock],
    page_size: tuple[int, int],
) -> list[tuple[float, float, float, int]]:
    page_width, _ = page_size
    anchors: list[tuple[float, float, float, int]] = []
    for index, block in enumerate(blocks):
        match = _NUMBER_TOKEN_PATTERN.fullmatch(block.text)
        if match is None or not 1 <= int(match.group(1)) <= 99 or not block.bounding_box:
            continue
        xs = [point[0] for point in block.bounding_box]
        ys = [point[1] for point in block.bounding_box]
        center_x = (min(xs) + max(xs)) / 2
        center_y = (min(ys) + max(ys)) / 2
        height = max(max(ys) - min(ys), 1.0)
        if center_x <= page_width * 0.45:
            anchors.append((center_x, center_y, height, index))
    return anchors


def _best_anchor_cluster(
    anchors: list[tuple[float, float, float, int]],
    page_size: tuple[int, int],
) -> list[tuple[float, float, float, int]] | None:
    page_width, page_height = page_size
    if len(anchors) < 3:
        return None

    median_height = statistics.median(anchor[2] for anchor in anchors)
    tolerance = max(page_width * 0.025, median_height * 1.5)
    clusters: list[list[tuple[float, float, float, int]]] = []
    for anchor in sorted(anchors, key=lambda item: item[0]):
        cluster = next(
            (
                group
                for group in clusters
                if abs(anchor[0] - statistics.median(item[0] for item in group)) <= tolerance
            ),
            None,
        )
        if cluster is None:
            clusters.append([anchor])
        else:
            cluster.append(anchor)

    eligible = [
        cluster
        for cluster in clusters
        if len(cluster) >= 3
        and max(item[1] for item in cluster) - min(item[1] for item in cluster) >= page_height * 0.2
    ]
    return max(eligible, key=len) if eligible else None


def _median_anchor_gap(
    y_positions: list[float],
    median_height: float,
) -> float:
    gaps = [
        second - first
        for first, second in zip(y_positions, y_positions[1:])
        if second - first > median_height
    ]
    return statistics.median(gaps) if gaps else median_height * 3


def _observed_number(
    evidence: tuple[OCRBlock, ...],
    anchor_x: float,
    tolerance: float,
) -> int | None:
    candidates: list[tuple[float, int]] = []
    for block in evidence:
        match = _NUMBER_TOKEN_PATTERN.fullmatch(block.text)
        if match is None:
            continue
        center_x = sum(point[0] for point in block.bounding_box) / len(block.bounding_box)
        if abs(center_x - anchor_x) <= tolerance:
            candidates.append((center_x, int(match.group(1))))
    return min(candidates)[1] if candidates else None
