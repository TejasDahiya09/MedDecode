import re

from app.schemas.medicine import (
    DosageSchedule,
    Duration,
    InstructionParseResult,
)


AFTER_FOOD_PATTERN = re.compile(
    r"\bafter\s+(?:food|meal|meals)\b",
    re.IGNORECASE,
)


BEFORE_FOOD_PATTERN = re.compile(
    r"\bbefore\s+(?:food|meal|meals)\b",
    re.IGNORECASE,
)


DOSAGE_PATTERN = re.compile(
    r"""
    \b
    (?P<morning>\d+(?:\.\d+)?)
    \s*[-/xX]\s*
    (?P<afternoon>\d+(?:\.\d+)?)
    \s*[-/xX]\s*
    (?P<night>\d+(?:\.\d+)?)
    \b
    """,
    re.VERBOSE,
)


DURATION_PATTERN = re.compile(
    r"""
    \b
    for
    \s+
    (?P<value>\d+(?:\.\d+)?)
    \s+
    (?P<unit>
        day|days|
        week|weeks
    )
    \b
    """,
    re.IGNORECASE | re.VERBOSE,
)


def parse_medicine_instructions(
    instructions: list[str],
) -> InstructionParseResult:
    """
    Extract structured medicine instructions.

    Layer 3 extracts only information explicitly present
    in the prescription and preserves instructions that
    cannot be represented by a supported structured field.
    """

    dosage_schedule = (
        _extract_dosage_schedule(
            instructions
        )
    )

    timing = _extract_timing(
        instructions
    )

    duration = _extract_duration(
        instructions
    )

    additional_instructions = (
        _extract_additional_instructions(
            instructions
        )
    )

    return InstructionParseResult(
        dosage_schedule=dosage_schedule,
        timing=timing,
        duration=duration,
        additional_instructions=(
            additional_instructions
        ),
    )


def _extract_dosage_schedule(
    instructions: list[str],
) -> DosageSchedule:
    """
    Extract the first explicit three-part daily dosage
    schedule.

    Example:

        1-0-1

    becomes:

        morning_units = 1
        afternoon_units = 0
        night_units = 1
        units_per_day = 2
    """

    for instruction in instructions:

        match = DOSAGE_PATTERN.search(
            instruction
        )

        if match is None:
            continue

        morning = float(
            match.group("morning")
        )

        afternoon = float(
            match.group("afternoon")
        )

        night = float(
            match.group("night")
        )

        raw_pattern = match.group(
            0
        )

        return DosageSchedule(
            raw_pattern=raw_pattern,
            morning_units=morning,
            afternoon_units=afternoon,
            night_units=night,
            units_per_day=(
                morning
                + afternoon
                + night
            ),
        )

    return DosageSchedule()


def _extract_timing(
    instructions: list[str],
) -> str | None:
    """
    Extract timing relative to food.
    """

    for instruction in instructions:

        if AFTER_FOOD_PATTERN.search(
            instruction
        ):
            return "after_food"

        if BEFORE_FOOD_PATTERN.search(
            instruction
        ):
            return "before_food"

    return None


def _extract_duration(
    instructions: list[str],
) -> Duration:
    """
    Extract explicitly stated treatment duration.
    """

    for instruction in instructions:

        match = DURATION_PATTERN.search(
            instruction
        )

        if match is None:
            continue

        value = float(
            match.group("value")
        )

        unit = (
            match.group("unit")
            .lower()
        )

        if not unit.endswith(
            "s"
        ):
            unit = unit + "s"

        return Duration(
            value=value,
            unit=unit,
        )

    return Duration()


def _extract_additional_instructions(
    instructions: list[str],
) -> list[str]:
    """
    Preserve only instructions that contain no information
    recognized by the Layer 3 structured parsers.

    Instructions containing a dosage schedule, timing, or
    duration are considered structured and are therefore not
    duplicated in additional_instructions.
    """

    additional_instructions: list[str] = []

    for instruction in instructions:

        has_dosage_schedule = (
            DOSAGE_PATTERN.search(
                instruction
            )
            is not None
        )

        has_timing = (
            AFTER_FOOD_PATTERN.search(
                instruction
            )
            is not None
            or BEFORE_FOOD_PATTERN.search(
                instruction
            )
            is not None
        )

        has_duration = (
            DURATION_PATTERN.search(
                instruction
            )
            is not None
        )

        has_structured_information = (
            has_dosage_schedule
            or has_timing
            or has_duration
        )

        if not has_structured_information:

            additional_instructions.append(
                instruction
            )

    return additional_instructions