from app.layer2_information_extraction.document_context import (
    PrescriptionDocumentContext,
)
from app.schemas.ocr import (
    OCRBlock,
    OCRPageResult,
)


def create_block(
    text: str,
    left: float,
    top: float,
    right: float,
    bottom: float,
) -> OCRBlock:

    return OCRBlock(
        text=text,
        confidence=0.99,
        bounding_box=[
            [left, top],
            [right, top],
            [right, bottom],
            [left, bottom],
        ],
    )


def test_blocks_on_same_visual_line_are_combined():

    blocks = [
        create_block(
            "Tab Augmentin",
            10,
            10,
            100,
            30,
        ),
        create_block(
            "625 mg",
            120,
            11,
            180,
            31,
        ),
    ]

    page = OCRPageResult(
        full_text="",
        blocks=blocks,
    )

    context = (
        PrescriptionDocumentContext
        .from_ocr_pages(
            [page]
        )
    )

    assert len(
        context.lines
    ) == 1

    assert (
        context.lines[0].text
        == "Tab Augmentin 625 mg"
    )


def test_blocks_on_different_lines_remain_separate():

    blocks = [
        create_block(
            "Tab Augmentin",
            10,
            10,
            100,
            30,
        ),
        create_block(
            "625 mg",
            120,
            11,
            180,
            31,
        ),
        create_block(
            "1-0-1 x 5 days",
            10,
            60,
            150,
            80,
        ),
    ]

    page = OCRPageResult(
        full_text="",
        blocks=blocks,
    )

    context = (
        PrescriptionDocumentContext
        .from_ocr_pages(
            [page]
        )
    )

    assert len(
        context.lines
    ) == 2

    assert (
        context.lines[0].text
        == "Tab Augmentin 625 mg"
    )

    assert (
        context.lines[1].text
        == "1-0-1 x 5 days"
    )


def test_blocks_are_ordered_left_to_right():

    blocks = [
        create_block(
            "500 mg",
            150,
            10,
            220,
            30,
        ),
        create_block(
            "Amoxicillin",
            20,
            10,
            130,
            30,
        ),
    ]

    page = OCRPageResult(
        full_text="",
        blocks=blocks,
    )

    context = (
        PrescriptionDocumentContext
        .from_ocr_pages(
            [page]
        )
    )

    assert (
        context.lines[0].text
        == "Amoxicillin 500 mg"
    )


def test_page_numbers_are_preserved():

    page_one = OCRPageResult(
        full_text="",
        blocks=[
            create_block(
                "Page One",
                10,
                10,
                100,
                30,
            )
        ],
    )

    page_two = OCRPageResult(
        full_text="",
        blocks=[
            create_block(
                "Page Two",
                10,
                10,
                100,
                30,
            )
        ],
    )

    context = (
        PrescriptionDocumentContext
        .from_ocr_pages(
            [
                page_one,
                page_two,
            ]
        )
    )

    assert (
        context.lines[0].page_number
        == 1
    )

    assert (
        context.lines[1].page_number
        == 2
    )


def test_block_indexes_are_preserved():

    blocks = [
        create_block(
            "Amoxicillin",
            10,
            10,
            100,
            30,
        ),
        create_block(
            "500 mg",
            120,
            10,
            180,
            30,
        ),
    ]

    page = OCRPageResult(
        full_text="",
        blocks=blocks,
    )

    context = (
        PrescriptionDocumentContext
        .from_ocr_pages(
            [page]
        )
    )

    assert (
        context.lines[0].block_indexes
        == [0, 1]
    )