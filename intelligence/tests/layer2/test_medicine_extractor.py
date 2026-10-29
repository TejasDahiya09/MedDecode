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
        full_text="\n".join(
            lines
        ),
        blocks=blocks,
    )

    return PrescriptionDocumentContext.from_ocr_pages(
        [page]
    )


def test_extract_medicine_with_tablet_form():

    context = create_context(
        [
            "Tab. Amoxicillin 500 mg",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    assert len(medicines) == 1

    assert (
        medicines[0].raw_text
        == "Tab. Amoxicillin 500 mg"
    )


def test_extract_medicine_with_capsule_form():

    context = create_context(
        [
            "Cap Omeprazole 20 mg",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    assert len(medicines) == 1

    assert (
        medicines[0].raw_text
        == "Cap Omeprazole 20 mg"
    )


def test_extract_medicine_with_strength_but_no_form():

    context = create_context(
        [
            "Metformin 500 mg",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    assert len(medicines) == 1

    assert (
        medicines[0].raw_text
        == "Metformin 500 mg"
    )


def test_extract_multiple_medicines():

    context = create_context(
        [
            "Tab. Amoxicillin 500 mg",
            "Cap Omeprazole 20 mg",
            "Tab. Paracetamol 650 mg",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    assert len(medicines) == 3

    assert (
        medicines[0].raw_text
        == "Tab. Amoxicillin 500 mg"
    )

    assert (
        medicines[1].raw_text
        == "Cap Omeprazole 20 mg"
    )

    assert (
        medicines[2].raw_text
        == "Tab. Paracetamol 650 mg"
    )


def test_doctor_line_is_not_detected_as_medicine():

    context = create_context(
        [
            "Dr. Rajesh Sharma",
            "Tab. Amoxicillin 500 mg",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    assert len(medicines) == 1

    assert (
        medicines[0].raw_text
        == "Tab. Amoxicillin 500 mg"
    )


def test_patient_line_is_not_detected_as_medicine():

    context = create_context(
        [
            "Patient Name: Lucky Jaglan",
            "Age: 21",
            "Tab. Amoxicillin 500 mg",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    assert len(medicines) == 1

    assert (
        medicines[0].raw_text
        == "Tab. Amoxicillin 500 mg"
    )


def test_medicine_preserves_source_evidence():

    context = create_context(
        [
            "Tab. Amoxicillin 500 mg",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    medicine = medicines[0]

    assert medicine.page_number == 1

    assert len(
        medicine.evidence
    ) == 1

    assert (
        medicine.evidence[0].source_text
        == "Tab. Amoxicillin 500 mg"
    )

    assert (
        medicine.evidence[0].source_block_indexes
        == [0]
    )

def test_general_instruction_is_not_extracted_as_medicine():

    context = create_context(
        [
            "Rx",
            "Tab Paracetamol 500 mg",
            "1-0-1 after food",
            "Drink plenty of water",
            "Avoid spicy food",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    assert len(
        medicines
    ) == 1

    assert (
        medicines[0].raw_text
        == "Tab Paracetamol 500 mg"
    )

def test_follow_up_instruction_is_not_attached_as_medicine_instruction():

    context = create_context(
        [
            "Rx",
            "Tab Paracetamol 500 mg",
            "1-0-1 after food",
            "Follow up after 7 days",
        ]
    )

    medicines = extract_raw_medicines(
        context
    )

    assert len(
        medicines
    ) == 1

    assert medicines[0].instructions == [
        "1-0-1 after food",
    ]