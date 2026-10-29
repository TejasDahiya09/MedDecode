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


def test_extracts_multiple_instruction_fields():
    result = parse_medicine_instructions(
        [
            "1-0-1 after food for 7 days",
        ]
    )

    assert result.timing == "after_food"

    assert result.duration.value == 7

    assert result.duration.unit == "days"


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