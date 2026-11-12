from app.schemas.medicine import (
    DosageSchedule,
    Duration,
    MedicineUsageRecord,
    Strength,
)
from app.schemas.prescription import (
    SourceEvidence,
)


def test_medicine_usage_record_preserves_raw_text():

    record = MedicineUsageRecord(
        raw_medicine_text="Tab Paracetamol 500 mg",
    )

    assert (
        record.raw_medicine_text
        == "Tab Paracetamol 500 mg"
    )


def test_missing_information_remains_none():

    record = MedicineUsageRecord(
        raw_medicine_text="Unknown medicine",
    )

    assert record.raw_medicine_name is None
    assert record.dosage_form is None
    assert record.frequency_times_per_day is None
    assert record.timing is None

    assert record.strength.value is None
    assert record.strength.unit is None

    assert (
        record.dosage_schedule.raw_pattern
        is None
    )

    assert (
        record.dosage_schedule.morning_units
        is None
    )

    assert (
        record.dosage_schedule.afternoon_units
        is None
    )

    assert (
        record.dosage_schedule.night_units
        is None
    )

    assert (
        record.dosage_schedule.units_per_day
        is None
    )

    assert record.duration.value is None
    assert record.duration.unit is None


def test_strength_can_store_structured_value():

    strength = Strength(
        value=500,
        unit="mg",
    )

    assert strength.value == 500
    assert strength.unit == "mg"


def test_dosage_schedule_can_store_daily_pattern():

    schedule = DosageSchedule(
        raw_pattern="1-0-1",
        morning_units=1,
        afternoon_units=0,
        night_units=1,
        units_per_day=2,
    )

    assert (
        schedule.raw_pattern
        == "1-0-1"
    )

    assert (
        schedule.morning_units
        == 1
    )

    assert (
        schedule.afternoon_units
        == 0
    )

    assert (
        schedule.night_units
        == 1
    )

    assert (
        schedule.units_per_day
        == 2
    )


def test_fractional_dosage_is_supported():

    schedule = DosageSchedule(
        raw_pattern="1/2-0-1/2",
        morning_units=0.5,
        afternoon_units=0,
        night_units=0.5,
        units_per_day=1,
    )

    assert (
        schedule.morning_units
        == 0.5
    )

    assert (
        schedule.afternoon_units
        == 0
    )

    assert (
        schedule.night_units
        == 0.5
    )

    assert (
        schedule.units_per_day
        == 1
    )


def test_duration_can_store_value_and_unit():

    duration = Duration(
        value=5,
        unit="days",
    )

    assert duration.value == 5
    assert duration.unit == "days"


def test_source_evidence_is_preserved():

    evidence = SourceEvidence(
        page_number=1,
        source_text="Tab Paracetamol 500 mg",
        source_block_indexes=[4],
    )

    record = MedicineUsageRecord(
        raw_medicine_text="Tab Paracetamol 500 mg",
        evidence=[evidence],
    )

    assert len(
        record.evidence
    ) == 1

    assert (
        record.evidence[0].page_number
        == 1
    )

    assert (
        record.evidence[0].source_text
        == "Tab Paracetamol 500 mg"
    )

    assert (
        record.evidence[0].source_block_indexes
        == [4]
    )


def test_default_lists_are_not_shared_between_records():

    first = MedicineUsageRecord(
        raw_medicine_text="Medicine A",
    )

    second = MedicineUsageRecord(
        raw_medicine_text="Medicine B",
    )

    first.additional_instructions.append(
        "After food"
    )

    assert (
        second.additional_instructions
        == []
    )