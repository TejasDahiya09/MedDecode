"""Provenance-aware safety boundary for review-only OCR evidence."""

from __future__ import annotations

from app.schemas.ocr import OCRBlock, OCRPageResult, UnverifiedNumberedRow
from app.schemas.prescription import RawMedicineEntry


def exclude_unverified_identity_candidates(
    pages: list[OCRPageResult],
    medicines: list[RawMedicineEntry],
) -> tuple[list[RawMedicineEntry], list[RawMedicineEntry]]:
    """Partition medicine candidates using their original page/block evidence.

    A candidate that shares source blocks or a source region with an explicitly
    unverified numbered row remains review evidence only.  If a candidate on a
    page containing unverified rows has missing or invalid block provenance, it
    fails closed instead of being promoted automatically.
    """

    rows_by_page: dict[int, list[UnverifiedNumberedRow]] = {
        page_number: list(page.unverified_numbered_rows)
        for page_number, page in enumerate(pages, start=1)
        if page.unverified_numbered_rows
    }
    if not rows_by_page:
        return medicines, []

    accepted: list[RawMedicineEntry] = []
    excluded: list[RawMedicineEntry] = []
    for medicine in medicines:
        if _overlaps_unverified_evidence(medicine, pages, rows_by_page):
            medicine.automatic_identity_eligible = False
            excluded.append(medicine)
        else:
            accepted.append(medicine)
    return accepted, excluded


def _overlaps_unverified_evidence(
    medicine: RawMedicineEntry,
    pages: list[OCRPageResult],
    rows_by_page: dict[int, list[UnverifiedNumberedRow]],
) -> bool:
    if medicine.page_number in rows_by_page and not medicine.evidence:
        return True

    observed_pages: set[int] = set()
    for evidence in medicine.evidence:
        observed_pages.add(evidence.page_number)
        rows = rows_by_page.get(evidence.page_number)
        if not rows:
            continue
        if not 1 <= evidence.page_number <= len(pages):
            return True

        page = pages[evidence.page_number - 1]
        indexes = evidence.source_block_indexes
        if not indexes or any(index < 0 or index >= len(page.blocks) for index in indexes):
            return True

        candidate_blocks = [page.blocks[index] for index in indexes]
        for row in rows:
            if _shares_block(candidate_blocks, row.evidence):
                return True
            if any(
                _intersection_over_smaller(_bounds(block), _bounds_from_points(row.bounding_box)) >= 0.5
                for block in candidate_blocks
                if block.bounding_box and row.bounding_box
            ):
                return True
    if medicine.page_number in rows_by_page and medicine.page_number not in observed_pages:
        return True
    return False


def _shares_block(
    candidate_blocks: list[OCRBlock],
    row_blocks: tuple[OCRBlock, ...],
) -> bool:
    return any(
        candidate is row_block or _block_fingerprint(candidate) == _block_fingerprint(row_block)
        for candidate in candidate_blocks
        for row_block in row_blocks
    )


def _block_fingerprint(block: OCRBlock) -> tuple[str, tuple[tuple[float, float], ...]]:
    return (
        " ".join(block.text.casefold().split()),
        tuple((round(float(x), 3), round(float(y), 3)) for x, y in block.bounding_box),
    )


def _bounds(block: OCRBlock) -> tuple[float, float, float, float]:
    return _bounds_from_points(block.bounding_box)


def _bounds_from_points(points: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def _intersection_over_smaller(
    first: tuple[float, float, float, float],
    second: tuple[float, float, float, float],
) -> float:
    left = max(first[0], second[0])
    top = max(first[1], second[1])
    right = min(first[2], second[2])
    bottom = min(first[3], second[3])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    smaller = min(first_area, second_area)
    return intersection / smaller if smaller else 0.0
