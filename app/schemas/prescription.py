from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ExtractionWarning:
    """
    Warning generated during prescription information extraction.
    """

    field_name: str
    message: str


@dataclass
class ExtractedValue:
    """
    A value extracted from the prescription together with
    extraction confidence.
    """

    value: Optional[str]
    confidence: Optional[float] = None


@dataclass
class DoctorInfo:
    """
    Doctor information extracted from a prescription.
    """

    name: Optional[str] = None
    registration_number: Optional[str] = None


@dataclass
class FacilityInfo:
    """
    Hospital, clinic, or healthcare facility information.
    """

    name: Optional[str] = None


@dataclass
class PatientInfo:
    """
    Patient information extracted from a prescription.
    """

    name: Optional[str] = None
    age: Optional[str] = None
    gender: Optional[str] = None

@dataclass
class SourceEvidence:
    """
    Source evidence supporting an extracted value.

    This preserves the relationship between Layer 2 output and
    the original OCR content produced by Layer 1.
    """

    page_number: int

    source_text: str

    source_block_indexes: list[int] = field(
        default_factory=list
    )

@dataclass
class RawMedicineEntry:
    """
    A raw medicine entry extracted directly from the prescription.

    Canonical medicine identity is intentionally not determined here.
    """

    raw_text: str
    page_number: int
    confidence: float
    evidence: list[SourceEvidence]

    instructions: list[str] = field(
        default_factory=list
    )


@dataclass
class PrescriptionRecord:
    """
    Structured prescription information extracted from OCR output.

    Only information supported by the source document should be
    populated.
    """

    prescription_date: Optional[ExtractedValue] = None

    doctor: DoctorInfo = field(
        default_factory=DoctorInfo
    )

    facility: FacilityInfo = field(
        default_factory=FacilityInfo
    )

    patient: PatientInfo = field(
        default_factory=PatientInfo
    )

    medicines: list[RawMedicineEntry] = field(
        default_factory=list
    )

    general_instructions: list[str] = field(
        default_factory=list
    )

    warnings: list[ExtractionWarning] = field(
        default_factory=list
    )