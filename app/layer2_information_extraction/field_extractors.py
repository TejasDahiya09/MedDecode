import re
from datetime import datetime
from typing import Optional

from app.layer2_information_extraction.confidence import (
    combine_confidence,
)
from app.layer2_information_extraction.document_context import (
    PrescriptionDocumentContext,
    OCRLine,
)
from app.layer2_information_extraction.normalizers import (
    clean_extracted_value,
    normalize_gender,
)
from app.schemas.prescription import (
    DoctorInfo,
    ExtractedValue,
    FacilityInfo,
    PatientInfo,
)


DATE_FORMATS = [
    "%d/%m/%Y",
    "%d/%m/%y",
    "%d-%m-%Y",
    "%d-%m-%y",
    "%Y-%m-%d",
    "%d %b %Y",
    "%d %b %y",
    "%d %B %Y",
    "%d %B %y",
]


def extract_prescription_date(
    context: PrescriptionDocumentContext,
) -> Optional[ExtractedValue]:
    """
    Extract a prescription date when explicitly supported by
    document text.

    The returned value is normalized to ISO format:
    YYYY-MM-DD.

    If a date-like value cannot be parsed reliably, it is ignored
    rather than guessed.
    """

    for line in context.lines:

        date_match = _find_date_in_text(
            line.text
        )

        if date_match is None:
            continue

        parsed_date = _parse_date(
            date_match
        )

        if parsed_date is None:
            continue

        return ExtractedValue(
            value=parsed_date.isoformat(),
            confidence=combine_confidence(
                line.confidence,
                extraction_confidence=0.98,
            ),
        )

    return None


def extract_doctor_info(
    context: PrescriptionDocumentContext,
) -> DoctorInfo:
    """
    Extract explicitly supported doctor information.

    This function extracts:
    - doctor name
    - registration number

    It does not infer doctor information from arbitrary text.
    """

    doctor_name = None
    registration_number = None

    for line in context.lines:

        text = line.text.strip()

        if doctor_name is None:

            doctor_match = re.search(
                r"\bDr\.?\s+"
                r"([A-Za-z][A-Za-z .'-]{1,80})",
                text,
                flags=re.IGNORECASE,
            )

            if doctor_match:

                candidate = clean_extracted_value(
                    doctor_match.group(1)
                )

                if candidate:
                    doctor_name = candidate

        if registration_number is None:

            registration_match = re.search(
                r"\b(?:"
                r"Reg(?:istration)?\.?\s*(?:No|Number)?"
                r"|Medical\s*Council\s*(?:No|Number)?"
                r"|MCI\s*(?:No|Number)?"
                r")"
                r"\s*[:#-]?\s*"
                r"([A-Za-z0-9/-]{3,50})",
                text,
                flags=re.IGNORECASE,
            )

            if registration_match:

                registration_number = (
                    clean_extracted_value(
                        registration_match.group(1)
                    )
                )

        if (
            doctor_name is not None
            and registration_number is not None
        ):
            break

    return DoctorInfo(
        name=doctor_name,
        registration_number=registration_number,
    )


def extract_facility_info(
    context: PrescriptionDocumentContext,
) -> FacilityInfo:
    """
    Extract explicitly supported hospital or clinic information.

    Priority:
    1. Explicit facility labels.
    2. Lines containing hospital/clinic keywords.
    """

    explicit_patterns = [
        r"\bHospital\s*[:\-]?\s*(.+)$",
        r"\bClinic\s*[:\-]?\s*(.+)$",
        r"\bFacility\s*[:\-]?\s*(.+)$",
        r"\bHospital\s+Name\s*[:\-]?\s*(.+)$",
        r"\bClinic\s+Name\s*[:\-]?\s*(.+)$",
    ]

    for line in context.lines:

        text = line.text.strip()

        for pattern in explicit_patterns:

            match = re.search(
                pattern,
                text,
                flags=re.IGNORECASE,
            )

            if match:

                name = clean_extracted_value(
                    match.group(1)
                )

                if name:
                    return FacilityInfo(
                        name=name
                    )

    keyword_pattern = re.compile(
        r"\b("
        r"hospital"
        r"|clinic"
        r"|medical centre"
        r"|medical center"
        r"|healthcare"
        r")\b",
        flags=re.IGNORECASE,
    )

    for line in context.lines:

        text = line.text.strip()

        if keyword_pattern.search(
            text
        ):
            return FacilityInfo(
                name=clean_extracted_value(
                    text
                )
            )

    return FacilityInfo()


def extract_patient_info(
    context: PrescriptionDocumentContext,
) -> PatientInfo:
    """
    Extract explicitly labelled patient information.

    Extracts:
    - name
    - age
    - gender

    Missing fields remain None.
    """

    name = None
    age = None
    gender = None

    for line in context.lines:

        text = line.text.strip()

        if name is None:

            name_match = re.search(
                r"\b(?:"
                r"Patient(?:\s*Name)?"
                r"|Name"
                r")"
                r"\s*[:\-]\s*"
                r"(.+)$",
                text,
                flags=re.IGNORECASE,
            )

            if name_match:

                candidate = clean_extracted_value(
                    name_match.group(1)
                )

                if candidate:
                    name = candidate

        if age is None:

            age_match = re.search(
                r"\bAge"
                r"\s*[:\-]?\s*"
                r"(\d{1,3})"
                r"\b",
                text,
                flags=re.IGNORECASE,
            )

            if age_match:

                candidate_age = int(
                    age_match.group(1)
                )

                if 0 < candidate_age <= 130:
                    age = str(
                        candidate_age
                    )

        if gender is None:

            gender_match = re.search(
                r"\b(?:"
                r"Gender"
                r"|Sex"
                r")"
                r"\s*[:\-]?\s*"
                r"("
                r"Male"
                r"|Female"
                r"|Other"
                r"|M"
                r"|F"
                r")\b",
                text,
                flags=re.IGNORECASE,
            )

            if gender_match:

                gender = normalize_gender(
                    gender_match.group(1)
                )

        if (
            name is not None
            and age is not None
            and gender is not None
        ):
            break

    return PatientInfo(
        name=name,
        age=age,
        gender=gender,
    )


def _find_date_in_text(
    text: str,
) -> Optional[str]:
    """
    Find a supported date-like string in text.
    """

    patterns = [
        (
            r"\b\d{1,2}/"
            r"\d{1,2}/"
            r"\d{2,4}\b"
        ),
        (
            r"\b\d{1,2}-"
            r"\d{1,2}-"
            r"\d{2,4}\b"
        ),
        (
            r"\b\d{4}-"
            r"\d{1,2}-"
            r"\d{1,2}\b"
        ),
        (
            r"\b\d{1,2}\s+"
            r"(?:Jan|Feb|Mar|Apr|May|Jun|"
            r"Jul|Aug|Sep|Sept|Oct|Nov|Dec)"
            r"[a-z]*\s+"
            r"\d{2,4}\b"
        ),
    ]

    for pattern in patterns:

        match = re.search(
            pattern,
            text,
            flags=re.IGNORECASE,
        )

        if match:
            return match.group(0)

    return None


def _parse_date(
    value: str,
) -> Optional[datetime.date]:
    """
    Parse a supported date value.

    Returns None when parsing fails.
    """

    value = value.strip()

    for date_format in DATE_FORMATS:

        try:
            return datetime.strptime(
                value,
                date_format,
            ).date()

        except ValueError:
            continue

    return None