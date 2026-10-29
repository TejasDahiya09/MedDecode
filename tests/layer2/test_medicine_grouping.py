from app.layer2_information_extraction.document_context import (
    PrescriptionDocumentContext,
)
from app.layer2_information_extraction.medicine_extractor import (
    extract_raw_medicines,
)
from app.schemas.ocr import (
    OCRBlock,
    OCRPageResult,
)


def create_context(
    lines: list[str],
) -> PrescriptionDocumentContext:
    """
    Create a realistic layout-aware OCR context.
    """

    blocks = []

    for index, line in enumerate(lines):

        top = float(index * 40)
        bottom = top + 20.0

        blocks.append(
            OCRBlock(
                text=line,
                confidence=0.99,
                bounding_box=[
                    [10.0, top],
                    [500.0, top],
                    [500.0, bottom],
                    [10.0, bottom],
                ],
            )
        )

    page = OCRPageResult(
        full_text="\n".join(lines),
        blocks=blocks,
    )

    return PrescriptionDocumentContext.from_ocr_pages(
        [page]
    )


def test_instruction_line_is_attached_to_medicine():

    context = create_context(
        [
            "Tab. Amoxicillin 500 mg",
            "1-0-1 for 5 days",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    assert len(medicines) == 1

    medicine = medicines[0]

    assert (
        medicine.raw_text
        == "Tab. Amoxicillin 500 mg"
    )

    assert (
        medicine.instructions
        == [
            "1-0-1 for 5 days",
        ]
    )


def test_multiple_medicines_receive_correct_instructions():

    context = create_context(
        [
            "Tab. Amoxicillin 500 mg",
            "1-0-1 for 5 days",
            "Cap Omeprazole 20 mg",
            "1-0-0 before breakfast",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    assert len(medicines) == 2

    assert (
        medicines[0].instructions
        == [
            "1-0-1 for 5 days",
        ]
    )

    assert (
        medicines[1].instructions
        == [
            "1-0-0 before breakfast",
        ]
    )


def test_instruction_is_not_returned_as_independent_medicine():

    context = create_context(
        [
            "Tab. Amoxicillin 500 mg",
            "Take twice daily",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    assert len(medicines) == 1

    assert (
        medicines[0].instructions
        == [
            "Take twice daily",
        ]
    )


def test_instruction_evidence_is_preserved():

    context = create_context(
        [
            "Tab. Amoxicillin 500 mg",
            "1-0-1 for 5 days",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    medicine = medicines[0]

    assert len(
        medicine.evidence
    ) == 2

    assert (
        medicine.evidence[1].source_text
        == "1-0-1 for 5 days"
    )

    assert (
        medicine.evidence[1].source_block_indexes
        == [1]
    )


def test_metadata_after_medicine_is_not_attached_as_instruction():

    context = create_context(
        [
            "Tab. Amoxicillin 500 mg",
            "Patient Name: Lucky Jaglan",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    assert len(medicines) == 1

    assert medicine_instructions(
        medicines[0]
    ) == []


def medicine_instructions(
    medicine,
):

    return medicine.instructions