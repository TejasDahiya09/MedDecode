from app.layer3_medicine_understanding.dosage_parser import (
    parse_dosage_schedule,
)


def test_parses_standard_three_part_dosage():
    result = parse_dosage_schedule(
        "1-0-1 after food"
    )

    assert result.raw_pattern == "1-0-1"

    assert result.morning_units == 1

    assert result.afternoon_units == 0

    assert result.night_units == 1

    assert result.units_per_day == 2


def test_parses_three_doses_per_day():
    result = parse_dosage_schedule(
        "1-1-1"
    )

    assert result.raw_pattern == "1-1-1"

    assert result.morning_units == 1

    assert result.afternoon_units == 1

    assert result.night_units == 1

    assert result.units_per_day == 3


def test_parses_fractional_decimal_dosage():
    result = parse_dosage_schedule(
        "0.5-0-1"
    )

    assert result.raw_pattern == "0.5-0-1"

    assert result.morning_units == 0.5

    assert result.afternoon_units == 0

    assert result.night_units == 1

    assert result.units_per_day == 1.5


def test_parses_fraction_notation():
    result = parse_dosage_schedule(
        "1/2-0-1"
    )

    assert result.raw_pattern == "1/2-0-1"

    assert result.morning_units == 0.5

    assert result.afternoon_units == 0

    assert result.night_units == 1

    assert result.units_per_day == 1.5


def test_missing_dosage_pattern_remains_empty():
    result = parse_dosage_schedule(
        "Take after food"
    )

    assert result.raw_pattern is None

    assert result.morning_units is None

    assert result.afternoon_units is None

    assert result.night_units is None

    assert result.units_per_day is None


def test_dosage_pattern_can_be_embedded_in_instruction():
    result = parse_dosage_schedule(
        "Take 1-0-1 after meals"
    )

    assert result.raw_pattern == "1-0-1"

    assert result.morning_units == 1

    assert result.afternoon_units == 0

    assert result.night_units == 1

    assert result.units_per_day == 2