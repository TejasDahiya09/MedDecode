from app.layer2_information_extraction.pipeline import (
    extract_prescription_information,
)
from app.schemas.ocr import (
    OCRBlock,
    OCRPageResult,
)


def create_page(
    lines: list[str],
    page_number_offset: int = 0,
) -> OCRPageResult:
    """
    Create a realistic OCR page for Layer 2 integration tests.

    Each OCR block is placed on a separate visual line.
    """

    blocks = [
        OCRBlock(
            text=line,
            confidence=0.99,
            bounding_box=[
                [0.0, float((index + page_number_offset) * 20)],
                [500.0, float((index + page_number_offset) * 20)],
                [
                    500.0,
                    float((index + page_number_offset) * 20 + 10),
                ],
                [
                    0.0,
                    float((index + page_number_offset) * 20 + 10),
                ],
            ],
        )
        for index, line in enumerate(
            lines
        )
    ]

    return OCRPageResult(
        full_text="\n".join(
            lines
        ),
        blocks=blocks,
    )


def test_pipeline_extracts_complete_prescription():

    page = create_page(
        [
            "Dr. Rajesh Sharma",
            "Reg No: DMC/12345",
            "Sunrise Multispeciality Hospital",
            "Date: 06/09/2026",
            "Patient Name: Lucky Jaglan",
            "Age: 21",
            "Gender: Male",
            "Rx",
            "Tab Paracetamol 500 mg",
            "1-0-1 after food",
            "Cap Amoxicillin 500 mg",
            "1-1-1 for 5 days",
            "Drink plenty of water",
            "Avoid spicy food",
            "Follow up after 7 days",
        ]
    )

    result = extract_prescription_information(
        [page]
    )

    assert result.prescription_date is not None

    assert (
        result.prescription_date.value
        == "2026-09-06"
    )

    assert (
        result.doctor.name
        == "Rajesh Sharma"
    )

    assert (
        result.doctor.registration_number
        == "DMC/12345"
    )

    assert (
        result.facility.name
        == "Sunrise Multispeciality Hospital"
    )

    assert (
        result.patient.name
        == "Lucky Jaglan"
    )

    assert result.patient.age == "21"

    assert result.patient.gender == "male"

    assert len(
        result.medicines
    ) == 2

    assert (
        result.medicines[0].raw_text
        == "Tab Paracetamol 500 mg"
    )

    assert (
        result.medicines[0].instructions
        == [
            "1-0-1 after food",
        ]
    )

    assert (
        result.medicines[1].raw_text
        == "Cap Amoxicillin 500 mg"
    )

    assert (
        result.medicines[1].instructions
        == [
            "1-1-1 for 5 days",
        ]
    )

    assert result.general_instructions == [
        "Drink plenty of water",
        "Avoid spicy food",
        "Follow up after 7 days",
    ]


def test_pipeline_preserves_missing_information():

    page = create_page(
        [
            "Dr. Rajesh Sharma",
            "Rx",
            "Tab Paracetamol 500 mg",
            "1-0-1 after food",
        ]
    )

    result = extract_prescription_information(
        [page]
    )

    assert (
        result.doctor.name
        == "Rajesh Sharma"
    )

    assert result.prescription_date is None

    assert result.facility.name is None

    assert result.patient.name is None
    assert result.patient.age is None
    assert result.patient.gender is None

    assert len(
        result.medicines
    ) == 1

    assert result.general_instructions == []


def test_pipeline_processes_multiple_pages():

    page_one = create_page(
        [
            "Dr. Rajesh Sharma",
            "Rx",
            "Tab Paracetamol 500 mg",
            "1-0-1 after food",
        ]
    )

    page_two = create_page(
        [
            "Cap Amoxicillin 500 mg",
            "1-1-1 for 5 days",
            "Drink plenty of water",
        ],
        page_number_offset=100,
    )

    result = extract_prescription_information(
        [
            page_one,
            page_two,
        ]
    )

    assert len(
        result.medicines
    ) == 2

    assert (
        result.medicines[0].raw_text
        == "Tab Paracetamol 500 mg"
    )

    assert (
        result.medicines[1].raw_text
        == "Cap Amoxicillin 500 mg"
    )

    assert result.general_instructions == [
        "Drink plenty of water",
    ]