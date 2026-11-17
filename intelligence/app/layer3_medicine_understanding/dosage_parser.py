import re

from app.schemas.medicine import (
    DosageSchedule,
)


DOSAGE_PATTERN = re.compile(
    r"""
    (?P<morning>
        \d+(?:\.\d+)?
        |
        \d+/\d+
    )
    \s*-\s*
    (?P<afternoon>
        \d+(?:\.\d+)?
        |
        \d+/\d+
    )
    \s*-\s*
    (?P<night>
        \d+(?:\.\d+)?
        |
        \d+/\d+
    )
    """,
    re.VERBOSE,
)


def parse_dosage_schedule(
    text: str,
) -> DosageSchedule:
    """
    Extract a structured morning-afternoon-night dosage schedule.

    Supported examples:

        1-0-1
        1-1-1
        0.5-0-1
        1/2-0-1

    The parser only converts an explicitly present dosage pattern.
    It does not infer a schedule from natural-language instructions.
    """

    match = DOSAGE_PATTERN.search(
        text
    )

    if match is None:
        return DosageSchedule()

    morning = _parse_dosage_value(
        match.group("morning")
    )

    afternoon = _parse_dosage_value(
        match.group("afternoon")
    )

    night = _parse_dosage_value(
        match.group("night")
    )
    if morning is None or afternoon is None or night is None:
        return DosageSchedule()

    units_per_day = (
        morning
        + afternoon
        + night
    )

    raw_pattern = (
        match.group(0)
    )

    return DosageSchedule(
        raw_pattern=raw_pattern,
        morning_units=morning,
        afternoon_units=afternoon,
        night_units=night,
        units_per_day=units_per_day,
    )


def _parse_dosage_value(
    value: str,
) -> float | None:
    """
    Convert a dosage component into a float.

    Supports:

        1
        0
        0.5
        1/2
    """

    value = value.strip()

    if "/" in value:
        numerator, denominator = (
            value.split(
                "/",
                maxsplit=1,
            )
        )

        denominator_value = float(denominator)
        if denominator_value == 0:
            return None
        return float(numerator) / denominator_value

    return float(
        value
    )