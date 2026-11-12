from app.layer3_medicine_understanding.pipeline import (
    understand_medicine_entries,
)
from app.schemas.prescription import (
    RawMedicineEntry,
    SourceEvidence,
)


def create_raw_medicine(
    raw_text: str,
    instructions: list[str] | None = None,
) -> RawMedicineEntry:

    return RawMedicineEntry(
        raw_text=raw_text,
        page_number=1,
        confidence=0.99,
        evidence=[
            SourceEvidence(
                page_number=1,
                source_text=raw_text,
                source_block_indexes=[0],
            )
        ],
        instructions=instructions or [],
    )


def test_pipeline_understands_complete_medicine():

    entry = create_raw_medicine(
        raw_text="Tab Paracetamol 500 mg",
        instructions=[
            "1-0-1 after food for 5 days",
        ],
    )

    result = understand_medicine_entries(
        [entry]
    )

    assert len(result) == 1

    medicine = result[0]

    assert medicine.raw_medicine_text == (
        "Tab Paracetamol 500 mg"
    )

    assert medicine.raw_medicine_name == (
        "Paracetamol"
    )

    assert medicine.normalized_medicine_name == (
        "paracetamol"
    )

    assert medicine.dosage_form == (
        "tablet"
    )

    assert medicine.strength.value == 500

    assert medicine.strength.unit == "mg"

    assert medicine.dosage_schedule.raw_pattern == (
        "1-0-1"
    )

    assert medicine.dosage_schedule.morning_units == 1

    assert medicine.dosage_schedule.afternoon_units == 0

    assert medicine.dosage_schedule.night_units == 1

    assert medicine.dosage_schedule.units_per_day == 2

    assert medicine.timing == "after_food"

    assert medicine.duration.value == 5

    assert medicine.duration.unit == "days"


def test_pipeline_preserves_additional_instruction():

    entry = create_raw_medicine(
        raw_text="Cap Amoxicillin 500 mg",
        instructions=[
            "1-1-1",
            "Take as directed",
        ],
    )

    result = understand_medicine_entries(
        [entry]
    )

    medicine = result[0]

    assert medicine.additional_instructions == [
        "Take as directed",
    ]


def test_pipeline_processes_multiple_medicines():

    first = create_raw_medicine(
        raw_text="Tab Paracetamol 500 mg",
        instructions=[
            "1-0-1 after food",
        ],
    )

    second = create_raw_medicine(
        raw_text="Cap Amoxicillin 500 mg",
        instructions=[
            "1-1-1 for 5 days",
        ],
    )

    result = understand_medicine_entries(
        [
            first,
            second,
        ]
    )

    assert len(result) == 2

    assert (
        result[0].raw_medicine_name
        == "Paracetamol"
    )

    assert (
        result[0].normalized_medicine_name
        == "paracetamol"
    )

    assert (
        result[1].raw_medicine_name
        == "Amoxicillin"
    )

    assert (
        result[1].normalized_medicine_name
        == "amoxicillin"
    )

    assert (
        result[0].dosage_schedule.raw_pattern
        == "1-0-1"
    )

    assert (
        result[1].dosage_schedule.raw_pattern
        == "1-1-1"
    )

    assert result[0].timing == (
        "after_food"
    )

    assert result[1].duration.value == 5


def test_pipeline_handles_medicine_without_instructions():

    entry = create_raw_medicine(
        raw_text="Tab Paracetamol 500 mg",
    )

    result = understand_medicine_entries(
        [entry]
    )

    medicine = result[0]

    assert medicine.dosage_schedule.raw_pattern is None

    assert medicine.timing is None

    assert medicine.duration.value is None

    assert medicine.additional_instructions == []


def test_pipeline_preserves_source_information():

    evidence = SourceEvidence(
        page_number=2,
        source_text="Tab Paracetamol 500 mg",
        source_block_indexes=[
            3,
            4,
        ],
    )

    entry = RawMedicineEntry(
        raw_text="Tab Paracetamol 500 mg",
        page_number=2,
        confidence=0.95,
        evidence=[
            evidence,
        ],
        instructions=[
            "1-0-1 after food",
        ],
    )

    result = understand_medicine_entries(
        [entry]
    )

    medicine = result[0]

    assert medicine.source_instructions == [
        "1-0-1 after food",
    ]

    assert len(
        medicine.evidence
    ) == 1

    assert (
        medicine.evidence[0].page_number
        == 2
    )

    assert (
        medicine.evidence[0]
        .source_block_indexes
        == [3, 4]
    )


def test_pipeline_handles_empty_input():

    result = understand_medicine_entries(
        []
    )

    assert result == []