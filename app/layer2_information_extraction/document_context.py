from dataclasses import dataclass

from app.schemas.ocr import (
    OCRBlock,
    OCRPageResult,
)


@dataclass
class OCRLine:
    """
    A layout-aware text line reconstructed from one or more OCR blocks.

    OCR blocks remain preserved so extraction results can be traced
    back to the original Layer 1 output.
    """

    text: str

    confidence: float

    page_number: int

    blocks: list[OCRBlock]

    block_indexes: list[int]

    top: float

    bottom: float

    left: float

    right: float


@dataclass
class PrescriptionDocumentContext:
    """
    Structured representation of Layer 1 OCR output.

    Provides:
    - original OCR pages
    - original OCR blocks
    - layout-aware reconstructed lines
    """

    pages: list[OCRPageResult]

    lines: list[OCRLine]

    @classmethod
    def from_ocr_pages(
        cls,
        pages: list[OCRPageResult],
    ) -> "PrescriptionDocumentContext":
        """
        Build a layout-aware document context.

        OCR blocks on each page are grouped into approximate visual
        lines using their vertical coordinates. Blocks inside a line
        are ordered from left to right.
        """

        lines: list[OCRLine] = []

        for page_number, page in enumerate(
            pages,
            start=1,
        ):
            page_lines = cls._build_page_lines(
                page=page,
                page_number=page_number,
            )

            lines.extend(
                page_lines
            )

        return cls(
            pages=pages,
            lines=lines,
        )

    @staticmethod
    def _build_page_lines(
        page: OCRPageResult,
        page_number: int,
    ) -> list[OCRLine]:
        """
        Reconstruct visual lines from OCR blocks on one page.
        """

        indexed_blocks = []

        for index, block in enumerate(
            page.blocks
        ):
            text = block.text.strip()

            if not text:
                continue

            top, bottom, left, right = (
                _get_block_bounds(
                    block
                )
            )

            indexed_blocks.append(
                {
                    "index": index,
                    "block": block,
                    "top": top,
                    "bottom": bottom,
                    "left": left,
                    "right": right,
                    "center_y": (
                        top + bottom
                    ) / 2,
                    "height": max(
                        bottom - top,
                        1.0,
                    ),
                }
            )

        if not indexed_blocks:
            return []

        indexed_blocks.sort(
            key=lambda item: (
                item["center_y"],
                item["left"],
            )
        )

        grouped_lines: list[
            list[dict]
        ] = []

        for item in indexed_blocks:

            if not grouped_lines:

                grouped_lines.append(
                    [item]
                )

                continue

            current_line = (
                grouped_lines[-1]
            )

            if _belongs_to_same_line(
                item,
                current_line,
            ):
                current_line.append(
                    item
                )

            else:
                grouped_lines.append(
                    [item]
                )

        reconstructed_lines = []

        for group in grouped_lines:

            group.sort(
                key=lambda item: (
                    item["left"],
                    item["top"],
                )
            )

            blocks = [
                item["block"]
                for item in group
            ]

            block_indexes = [
                item["index"]
                for item in group
            ]

            text = " ".join(
                block.text.strip()
                for block in blocks
                if block.text.strip()
            )

            confidence = sum(
                block.confidence
                for block in blocks
            ) / len(blocks)

            top = min(
                item["top"]
                for item in group
            )

            bottom = max(
                item["bottom"]
                for item in group
            )

            left = min(
                item["left"]
                for item in group
            )

            right = max(
                item["right"]
                for item in group
            )

            reconstructed_lines.append(
                OCRLine(
                    text=text,
                    confidence=confidence,
                    page_number=page_number,
                    blocks=blocks,
                    block_indexes=block_indexes,
                    top=top,
                    bottom=bottom,
                    left=left,
                    right=right,
                )
            )

        reconstructed_lines.sort(
            key=lambda line: (
                line.top,
                line.left,
            )
        )

        return reconstructed_lines


def _get_block_bounds(
    block: OCRBlock,
) -> tuple[
    float,
    float,
    float,
    float,
]:
    """
    Return:
        top,
        bottom,
        left,
        right

    from an OCR bounding polygon.
    """

    xs = [
        point[0]
        for point in block.bounding_box
    ]

    ys = [
        point[1]
        for point in block.bounding_box
    ]

    return (
        min(ys),
        max(ys),
        min(xs),
        max(xs),
    )


def _belongs_to_same_line(
    candidate: dict,
    current_line: list[dict],
) -> bool:
    """
    Determine whether an OCR block belongs to an existing visual line.

    The decision is based on vertical center alignment and the typical
    height of blocks already in that line.
    """

    line_center_y = sum(
        item["center_y"]
        for item in current_line
    ) / len(current_line)

    average_height = sum(
        item["height"]
        for item in current_line
    ) / len(current_line)

    candidate_height = (
        candidate["height"]
    )

    vertical_threshold = max(
        average_height,
        candidate_height,
    ) * 0.60

    vertical_distance = abs(
        candidate["center_y"]
        - line_center_y
    )

    return (
        vertical_distance
        <= vertical_threshold
    )