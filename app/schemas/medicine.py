from dataclasses import dataclass, field
from typing import Optional

from app.schemas.prescription import (
    ExtractionWarning,
    SourceEvidence,
)


@dataclass
class Strength:
    """
    Structured medicine strength extracted from the prescription.

    Example:
        500 mg
        5 ml
        10 mcg
    """

    value: Optional[float] = None
    unit: Optional[str] = None


@dataclass
class DosageSchedule:
    """
    Structured daily dosage schedule.

    Example:
        1-0-1

    becomes:

        morning_units = 1
        afternoon_units = 0
        night_units = 1
        units_per_day = 2

    The original prescription pattern is preserved separately.
    """

    raw_pattern: Optional[str] = None

    morning_units: Optional[float] = None
    afternoon_units: Optional[float] = None
    night_units: Optional[float] = None

    units_per_day: Optional[float] = None


@dataclass
class Duration:
    """
    Structured treatment duration explicitly extracted
    from the prescription.

    Example:
        for 5 days

    becomes:

        value = 5
        unit = "days"
    """

    value: Optional[float] = None
    unit: Optional[str] = None

@dataclass
class InstructionParseResult:
    """
    Structured information extracted from medicine instructions.

    This represents only information found in instruction text.
    It does not modify medicine identity or other medicine fields.
    """
    dosage_schedule: DosageSchedule = field(
        default_factory=DosageSchedule
    )

    timing: Optional[str] = None

    duration: Duration = field(
        default_factory=Duration
    )

    additional_instructions: list[str] = field(
        default_factory=list
    )


@dataclass
class MedicineUsageRecord:
    """
    Structured understanding of one medicine entry.

    This is the output contract of Layer 3.

    Layer 3 understands prescription-level medicine information,
    but does not determine canonical medicine identity. Canonical
    medicine matching is handled by Layer 4.
    """

    # Original Layer 2 medicine text.
    raw_medicine_text: str

    # Medicine name as written in the prescription.
    raw_medicine_name: Optional[str] = None

    # Normalized representation of the medicine name.
    #
    # This standardizes formatting only. It does not determine
    # canonical medicine identity or perform database matching.
    normalized_medicine_name: Optional[str] = None

    # Prescription-level formulation.
    dosage_form: Optional[str] = None

    # Structured medicine strength.
    strength: Strength = field(
        default_factory=Strength
    )

    # Structured dosage schedule.
    dosage_schedule: DosageSchedule = field(
        default_factory=DosageSchedule
    )

    # Frequency explicitly extracted from instructions.
    frequency_times_per_day: Optional[float] = None

    # Timing relative to food or time of day.
    timing: Optional[str] = None

    # Structured treatment duration.
    duration: Duration = field(
        default_factory=Duration
    )

    # Instructions that Layer 3 could not safely convert into
    # a dedicated structured field.
    additional_instructions: list[str] = field(
        default_factory=list
    )

    # Original instruction text received from Layer 2.
    source_instructions: list[str] = field(
        default_factory=list
    )

    # Source evidence inherited from Layer 2.
    evidence: list[SourceEvidence] = field(
        default_factory=list
    )

    # Parsing or interpretation warnings.
    warnings: list[ExtractionWarning] = field(
        default_factory=list
    )