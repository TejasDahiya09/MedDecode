from uuid import UUID

from app.layer3_medicine_understanding.pipeline import (
    understand_medicine_entries,
)
from app.layer4_medicine_intelligence.runtime.pipeline import MedicineIntelligencePipeline
from app.layer4_medicine_intelligence.runtime.schemas import (
    CandidateIngredient,
    MedicineCandidate,
    RuntimeMatchStatus,
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

    assert medicine.frequency_times_per_day == 2

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


def test_pipeline_preserves_individually_evidenced_combination_strengths():
    result = understand_medicine_entries([
        create_raw_medicine(
            raw_text="Tab Amoxicillin 500 mg + Clavulanic acid 125 mg",
        )
    ])

    medicine = result[0]
    assert medicine.raw_medicine_name == "Amoxicillin + Clavulanic acid"
    assert medicine.normalized_medicine_name == "amoxicillin + clavulanic acid"
    assert [(item.name, item.value, item.unit) for item in medicine.ingredient_strengths] == [
        ("Amoxicillin", 500.0, "mg"),
        ("Clavulanic acid", 125.0, "mg"),
    ]


def test_pipeline_separates_dose_units_from_daily_frequency():
    medicine = understand_medicine_entries(
        [
            create_raw_medicine(
                raw_text="Tab Paracetamol 500 mg",
                instructions=["2-0-2"],
            )
        ]
    )[0]

    assert medicine.frequency_times_per_day == 2
    assert medicine.dosage_schedule.units_per_day == 4


def test_pipeline_marks_conflicting_dosage_schedules_unknown():
    medicine = understand_medicine_entries(
        [
            create_raw_medicine(
                raw_text="Tab Paracetamol 500 mg",
                instructions=["1-0-1", "1-1-1"],
            )
        ]
    )[0]

    assert medicine.dosage_schedule.raw_pattern is None
    assert medicine.dosage_schedule.units_per_day is None
    assert medicine.frequency_times_per_day is None
    assert any(
        warning.field_name == "dosage_schedule"
        for warning in medicine.warnings
    )
    assert medicine.source_instructions == ["1-0-1", "1-1-1"]


def test_pipeline_abstains_on_invalid_fractional_schedule_and_keeps_evidence():
    instruction = "1/0-0-1"
    medicine = understand_medicine_entries(
        [
            create_raw_medicine(
                raw_text="Tab FictionalMedicine 5 mg",
                instructions=[instruction],
            )
        ]
    )[0]

    assert medicine.dosage_schedule.raw_pattern is None
    assert medicine.dosage_schedule.units_per_day is None
    assert medicine.frequency_times_per_day is None
    assert medicine.source_instructions == [instruction]
    assert medicine.additional_instructions == [instruction]
    assert any(
        warning.field_name == "dosage_schedule"
        for warning in medicine.warnings
    )


def test_pipeline_preserves_fractional_schedule_values_and_raw_evidence():
    instruction = "1/2-0-1"
    medicine = understand_medicine_entries(
        [
            create_raw_medicine(
                raw_text="Tab FictionalMedicine 5 mg",
                instructions=[instruction],
            )
        ]
    )[0]

    assert medicine.dosage_schedule.raw_pattern == instruction
    assert medicine.dosage_schedule.morning_units == 0.5
    assert medicine.dosage_schedule.afternoon_units == 0
    assert medicine.dosage_schedule.night_units == 1
    assert medicine.dosage_schedule.units_per_day == 1.5
    assert medicine.frequency_times_per_day == 2
    assert medicine.source_instructions == [instruction]
    assert medicine.warnings == []


def test_pipeline_marks_conflicting_timing_and_duration_unknown():
    medicine = understand_medicine_entries(
        [
            create_raw_medicine(
                raw_text="Tab Paracetamol 500 mg",
                instructions=[
                    "Take 1 tablet before food for 5 days",
                    "Take 1 tablet after food for 7 days",
                ],
            )
        ]
    )[0]

    assert medicine.timing is None
    assert medicine.duration.value is None
    assert medicine.duration.unit is None
    assert {warning.field_name for warning in medicine.warnings} >= {
        "timing",
        "duration",
    }


def test_combination_components_reach_layer4_without_copying_strengths():
    medicine = understand_medicine_entries([
        create_raw_medicine(
            raw_text="Tab Amoxicillin 500 mg + Clavulanic acid 125 mg",
        )
    ])[0]

    candidate = MedicineCandidate(
        medicine_id=UUID("10000000-0000-4000-8000-000000000111"),
        canonical_name="Amoxicillin + Clavulanic acid tablet",
        normalized_name="amoxicillin + clavulanic acid",
        dosage_form="tablet",
        ingredients=[
            CandidateIngredient(UUID("20000000-0000-4000-8000-000000000111"), "Amoxicillin", "amoxicillin", 500, "mg"),
            CandidateIngredient(UUID("20000000-0000-4000-8000-000000000112"), "Clavulanic acid", "clavulanic acid", 125, "mg"),
        ],
    )

    class CombinationRepository:
        def find_by_normalized_name(self, value): return [candidate] if value == candidate.normalized_name else []
        def find_by_alias(self, value): return []
        def find_by_brand_name(self, value): return []
        def find_by_generic_name(self, value): return []
        def search_name_prefix(self, value): return []
        def enrich_with_ingredients(self, candidates): return candidates

    match = MedicineIntelligencePipeline(repository=CombinationRepository()).match_medicine(medicine)
    assert match.match_status is RuntimeMatchStatus.MATCHED
    assert match.selected_candidate is candidate

    candidate.ingredients[1].strength_value = 250
    mismatch = MedicineIntelligencePipeline(repository=CombinationRepository()).match_medicine(medicine)
    assert mismatch.selected_candidate is None
    assert mismatch.match_status is RuntimeMatchStatus.UNMATCHED

    candidate.ingredients[1].strength_value = None
    missing = MedicineIntelligencePipeline(repository=CombinationRepository()).match_medicine(medicine)
    assert missing.selected_candidate is None


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
