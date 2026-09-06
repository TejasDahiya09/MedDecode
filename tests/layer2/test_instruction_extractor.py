from app.layer2_information_extraction.document_context import (
    PrescriptionDocumentContext,
)
from app.layer2_information_extraction.instruction_extractor import (
    extract_general_instructions,
)
from app.schemas.ocr import (
    OCRBlock,
    OCRPageResult,
)


def create_context(
    lines: list[str],
) -> PrescriptionDocumentContext:

    blocks = [
        OCRBlock(
            text=line,
            confidence=0.99,
            bounding_box=[
                [0.0, float(index * 20)],
                [100.0, float(index * 20)],
                [100.0, float(index * 20 + 10)],
                [0.0, float(index * 20 + 10)],
            ],
        )
        for index, line in enumerate(
            lines
        )
    ]

    page = OCRPageResult(
        full_text="\n".join(
            lines
        ),
        blocks=blocks,
    )

    return PrescriptionDocumentContext.from_ocr_pages(
        [page]
    )


def test_extracts_general_instruction():

    context = create_context(
        [
            "Drink plenty of water",
        ]
    )

    result = extract_general_instructions(
        context
    )

    assert result == [
        "Drink plenty of water",
    ]


def test_extracts_multiple_general_instructions():

    context = create_context(
        [
            "Avoid spicy food",
            "Follow up after 7 days",
        ]
    )

    result = extract_general_instructions(
        context
    )

    assert result == [
        "Avoid spicy food",
        "Follow up after 7 days",
    ]


def test_non_instruction_lines_are_ignored():

    context = create_context(
        [
            "Dr. Rajesh Sharma",
            "Patient Name: Lucky Jaglan",
            "Tab Paracetamol 500 mg",
        ]
    )

    result = extract_general_instructions(
        context
    )

    assert result == []