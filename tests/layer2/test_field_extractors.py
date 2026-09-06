from app.layer2_information_extraction.document_context import (
    PrescriptionDocumentContext,
)
from app.layer2_information_extraction.field_extractors import (
    extract_doctor_info,
    extract_facility_info,
    extract_patient_info,
    extract_prescription_date,
)
from app.schemas.ocr import (
    OCRBlock,
    OCRPageResult,
)


def create_context(
    lines: list[str],
) -> PrescriptionDocumentContext:
    """
    Create a realistic OCR document context for tests.

    Each input string is placed on a separate visual line by giving
    it a different vertical bounding-box position.
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


def test_extract_prescription_date():

    context = create_context(
        [
            "Date: 06/09/2026",
        ]
    )

    result = extract_prescription_date(
        context
    )

    assert result is not None

    assert (
        result.value
        == "2026-09-06"
    )


def test_extract_doctor_name():

    context = create_context(
        [
            "Dr. Rajesh Sharma",
        ]
    )

    result = extract_doctor_info(
        context
    )

    assert (
        result.name
        == "Rajesh Sharma"
    )


def test_extract_doctor_registration_number():

    context = create_context(
        [
            "Dr. Rajesh Sharma",
            "Reg No: DMC/12345",
        ]
    )

    result = extract_doctor_info(
        context
    )

    assert (
        result.registration_number
        == "DMC/12345"
    )


def test_extract_facility_from_keyword():

    context = create_context(
        [
            "Sunrise Multispeciality Hospital",
        ]
    )

    result = extract_facility_info(
        context
    )

    assert (
        result.name
        == "Sunrise Multispeciality Hospital"
    )


def test_extract_patient_information():

    context = create_context(
        [
            "Patient Name: Lucky Jaglan",
            "Age: 21",
            "Gender: Male",
        ]
    )

    result = extract_patient_info(
        context
    )

    assert (
        result.name
        == "Lucky Jaglan"
    )

    assert result.age == "21"

    assert result.gender == "male"


def test_missing_patient_information_remains_none():

    context = create_context(
        [
            "Dr. Rajesh Sharma",
            "Sunrise Hospital",
        ]
    )

    result = extract_patient_info(
        context
    )

    assert result.name is None
    assert result.age is None
    assert result.gender is None


def test_invalid_date_is_not_invented():

    context = create_context(
        [
            "Date: 99/99/2026",
        ]
    )

    result = extract_prescription_date(
        context
    )

    assert result is None