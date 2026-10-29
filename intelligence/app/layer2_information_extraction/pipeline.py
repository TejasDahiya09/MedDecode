from app.layer2_information_extraction.document_context import (
    PrescriptionDocumentContext,
)
from app.layer2_information_extraction.field_extractors import (
    extract_prescription_date,
    extract_doctor_info,
    extract_facility_info,
    extract_patient_info,
)
from app.layer2_information_extraction.medicine_extractor import (
    extract_medicine_entries,
)
from app.layer2_information_extraction.instruction_extractor import (
    extract_general_instructions,
)
from app.schemas.ocr import OCRPageResult
from app.schemas.prescription import (
    PrescriptionRecord,
)


def extract_prescription_information(
    pages: list[OCRPageResult],
) -> PrescriptionRecord:
    """
    Convert Layer 1 OCR output into a structured prescription record.

    Layer 2 extracts only information supported by the source
    document. It does not determine canonical medicine identity,
    perform medicine substitution, or make recommendations.
    """

    context = PrescriptionDocumentContext.from_ocr_pages(
        pages
    )

    prescription_date = extract_prescription_date(
        context
    )

    doctor = extract_doctor_info(
        context
    )

    facility = extract_facility_info(
        context
    )

    patient = extract_patient_info(
        context
    )

    medicines = extract_medicine_entries(
        context
    )

    general_instructions = (
        extract_general_instructions(
            context
        )
    )

    return PrescriptionRecord(
        prescription_date=prescription_date,
        doctor=doctor,
        facility=facility,
        patient=patient,
        medicines=medicines,
        general_instructions=general_instructions,
    )