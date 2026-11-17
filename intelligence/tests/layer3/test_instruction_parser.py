from app.layer3_medicine_understanding.instruction_parser import (
    parse_medicine_instructions,
)


def test_extracts_after_food_timing():
    result = parse_medicine_instructions(
        [
            "1-0-1 after food",
        ]
    )

    assert result.timing == "after_food"


def test_extracts_before_food_timing():
    result = parse_medicine_instructions(
        [
            "Take 1-0-0 before food",
        ]
    )

    assert result.timing == "before_food"


def test_extracts_duration_in_days():
    result = parse_medicine_instructions(
        [
            "1-1-1 for 5 days",
        ]
    )

    assert result.duration.value == 5

    assert result.duration.unit == "days"


def test_extracts_duration_in_weeks():
    result = parse_medicine_instructions(
        [
            "Take once daily for 2 weeks",
        ]
    )

    assert result.duration.value == 2

    assert result.duration.unit == "weeks"


def test_extracts_duration_in_months():
    result = parse_medicine_instructions(
        [
            "Take 1 tablet once daily for 2 months",
        ]
    )

    assert result.duration.value == 2
    assert result.duration.unit == "months"


def test_extracts_multiple_instruction_fields():
    result = parse_medicine_instructions(
        [
            "1-0-1 after food for 7 days",
        ]
    )

    assert result.timing == "after_food"

    assert result.duration.value == 7

    assert result.duration.unit == "days"


def test_extracts_twice_daily_frequency():
    result = parse_medicine_instructions(
        [
            "1 tablet twice daily after food for 3 days",
        ]
    )

    assert result.dosage_schedule.raw_pattern == "twice daily"

    assert result.dosage_schedule.units_per_day == 2

    assert result.frequency_times_per_day == 2

    assert result.additional_instructions == []


def test_extracts_once_per_day_frequency():
    result = parse_medicine_instructions(
        [
            "1 tablet once per day",
        ]
    )

    assert result.dosage_schedule.units_per_day == 1
    assert result.frequency_times_per_day == 1


def test_does_not_infer_dose_units_from_frequency_alone():
    result = parse_medicine_instructions(
        [
            "Take twice daily",
        ]
    )

    assert result.frequency_times_per_day == 2
    assert result.dosage_schedule.units_per_day is None


def test_extracts_numeric_frequency_explicit_dose_and_meal_timing():
    result = parse_medicine_instructions(
        [
            "Take 2 tablets 3 times a day before breakfast for 2 months",
        ]
    )

    assert result.frequency_times_per_day == 3
    assert result.dosage_schedule.units_per_day == 6
    assert result.timing == "before_food"
    assert result.duration.value == 2
    assert result.duration.unit == "months"
    assert result.additional_instructions == []


def test_extracts_frequency_without_inventing_daily_units():
    result = parse_medicine_instructions(
        [
            "Take 3 times daily after meals",
        ]
    )

    assert result.frequency_times_per_day == 3
    assert result.dosage_schedule.units_per_day is None
    assert result.timing == "after_food"


def test_extracts_indian_abbreviation_frequency_and_duration():
    result = parse_medicine_instructions(
        [
            "Take 1 tablet OD x 3 days",
        ]
    )

    assert result.frequency_times_per_day == 1
    assert result.dosage_schedule.raw_pattern == "OD"
    assert result.duration.value == 3
    assert result.duration.unit == "days"


def test_extracts_food_timing_from_ac_pc_abbreviation():
    result = parse_medicine_instructions(
        [
            "Take 1 tablet AC",
        ]
    )

    assert result.timing == "before_food"
    assert result.additional_instructions == []


def test_does_not_treat_ambiguous_abbreviations_as_daily_dosage():
    result = parse_medicine_instructions(
        [
            "Take 1 tablet SOS",
            "Take 1 tablet PRN",
            "Take 1 tablet HS",
            "Take 1 tablet STAT",
        ]
    )

    assert result.frequency_times_per_day is None
    assert result.dosage_schedule.units_per_day is None
    assert result.additional_instructions == [
        "Take 1 tablet SOS",
        "Take 1 tablet PRN",
        "Take 1 tablet HS",
        "Take 1 tablet STAT",
    ]


def test_extracts_hindi_before_food_timing_phrase():
    result = parse_medicine_instructions(
        [
            "Take 1 tablet khane se pehle",
        ]
    )

    assert result.timing == "before_food"


def test_extracts_hindi_after_food_timing_phrase():
    result = parse_medicine_instructions(
        [
            "Take 1 tablet khane ke baad",
        ]
    )

    assert result.timing == "after_food"


def test_fictional_indian_prescription_fixture_set():
    fixtures = [
        ("Tab Metformin 500 mg 1-0-1 after food for 5 days", 5, "days", "after_food"),
        ("Cap Amlodipine 5 mg OD x 7 days", 7, "days", None),
        ("Tab Atorvastatin 20 mg AC", None, None, "before_food"),
        ("Take 1 tablet khane ke baad", None, None, "after_food"),
        ("Take 1 tablet SOS", None, None, None),
    ]

    for instruction, expected_days, expected_unit, expected_timing in fixtures:
        result = parse_medicine_instructions([instruction])
        if expected_days is not None:
            assert result.duration.value == expected_days
            assert result.duration.unit == expected_unit
        if expected_timing is not None:
            assert result.timing == expected_timing


def test_preserves_unstructured_instruction():
    result = parse_medicine_instructions(
        [
            "Take as directed",
        ]
    )

    assert result.additional_instructions == [
        "Take as directed",
    ]


def test_missing_instructions_remain_empty():
    result = parse_medicine_instructions(
        []
    )

    assert result.timing is None

    assert result.duration.value is None

    assert result.duration.unit is None

    assert result.additional_instructions == []


def test_fractional_schedule_is_not_misread_as_slash_separated_doses():
    result = parse_medicine_instructions(
        ["1/2-0-1"]
    )

    assert result.dosage_schedule.raw_pattern == "1/2-0-1"
    assert result.dosage_schedule.morning_units == 0.5
    assert result.dosage_schedule.afternoon_units == 0
    assert result.dosage_schedule.night_units == 1
    assert result.dosage_schedule.units_per_day == 1.5
    assert result.frequency_times_per_day == 2
    assert result.additional_instructions == []
    assert result.warnings == []


def test_zero_denominator_schedule_abstains_and_preserves_source_instruction():
    raw_instruction = "1/0-0-1"
    result = parse_medicine_instructions(
        [raw_instruction]
    )

    assert result.dosage_schedule.raw_pattern is None
    assert result.dosage_schedule.units_per_day is None
    assert result.frequency_times_per_day is None
    assert result.additional_instructions == [raw_instruction]
    assert [warning.field_name for warning in result.warnings] == [
        "dosage_schedule"
    ]


def test_slash_separated_dosage_schedule_remains_supported():
    result = parse_medicine_instructions(
        ["1/0/1"]
    )

    assert result.dosage_schedule.raw_pattern == "1/0/1"
    assert result.dosage_schedule.morning_units == 1
    assert result.dosage_schedule.afternoon_units == 0
    assert result.dosage_schedule.night_units == 1
