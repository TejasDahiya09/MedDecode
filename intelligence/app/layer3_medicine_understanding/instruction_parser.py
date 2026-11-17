import re

from app.schemas.medicine import (
    DosageSchedule,
    Duration,
    InstructionParseResult,
)
from app.schemas.prescription import ExtractionWarning


AFTER_FOOD_PATTERN = re.compile(
    r"(?:\bafter\s+(?:food|meal|meals|breakfast|lunch|dinner)\b|\bkhane\s+ke\s+baad\b)",
    re.IGNORECASE,
)


BEFORE_FOOD_PATTERN = re.compile(
    r"(?:\bbefore\s+(?:food|meal|meals|breakfast|lunch|dinner)\b|\bkhane\s+se\s+pehle\b)",
    re.IGNORECASE,
)


INDIAN_TIME_PATTERN = re.compile(
    r"\b(?:subah|shaam|raat\s+ko|r\s*aat\s*ko|morning|evening|night)\b",
    re.IGNORECASE,
)


ABBREVIATION_SCHEDULE_PATTERN = re.compile(
    r"""
    \b(?:
        OD|O\.?D\.?|BID|B\.?I\.?D\.?|BD|TID|T\.?I\.?D\.?|TDS|QID|Q\.?I\.?D\.?
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

AMBIGUOUS_ABBREVIATION_PATTERN = re.compile(
    r"""
    \b(?:
        SOS|PRN|HS|STAT
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

ABBREVIATION_TIMING_PATTERN = re.compile(
    r"""
    \b(?:
        AC|A\.?C\.?|PC|P\.?C\.?|Before food|After food
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)


DOSAGE_PATTERN = re.compile(
    r"""
    \b
    (?P<morning>\d+/\d+|\d+(?:\.\d+)?)
    \s*[-/xX]\s*
    (?P<afternoon>\d+/\d+|\d+(?:\.\d+)?)
    \s*[-/xX]\s*
    (?P<night>\d+/\d+|\d+(?:\.\d+)?)
    \b
    """,
    re.VERBOSE,
)


VERBAL_DOSAGE_PATTERN = re.compile(
    r"""
    \b
    (?P<count>
        once|one|
        twice|two|
        thrice|three|
        [1-3]
    )
    \s+
    (?:times\s+)?
    (?:
        daily
        |
        (?:a|per)\s+day
    )
    \b
    """,
    re.IGNORECASE | re.VERBOSE,
)


DOSE_QUANTITY_PATTERN = re.compile(
    r"""
    \b
    (?P<value>\d+(?:\.\d+)?|one|two|half|a|an)
    \s+
    (?:tablets?|tabs?|capsules?|caps?|pills?)
    \b
    """,
    re.IGNORECASE | re.VERBOSE,
)


DURATION_PATTERN = re.compile(
    r"""
    \b
    (?:(?:for)|(?:x))
    \s+
    (?P<value>\d+(?:\.\d+)?)
    \s+
    (?P<unit>
        day|days|
        week|weeks|
        month|months
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

    dosage_schedule, frequency_times_per_day, dosage_warning = (
        _extract_dosage_schedule(
            instructions
        )
    )

    timing, timing_warning = _extract_timing(
        instructions
    )

    duration, duration_warning = _extract_duration(
        instructions
    )

    warnings = [
        warning
        for warning in (
            dosage_warning,
            timing_warning,
            duration_warning,
        )
        if warning is not None
    ]

    additional_instructions = (
        _extract_additional_instructions(
            instructions
        )
    )

    return InstructionParseResult(
        dosage_schedule=dosage_schedule,
        frequency_times_per_day=frequency_times_per_day,
        timing=timing,
        duration=duration,
        additional_instructions=(
            additional_instructions
        ),
        warnings=warnings,
    )


def _extract_dosage_schedule(
    instructions: list[str],
) -> tuple[
    DosageSchedule,
    float | None,
    ExtractionWarning | None,
]:
    """
    Extract an unambiguous explicit daily dosage schedule.

    Example:

        1-0-1

    becomes:

        morning_units = 1
        afternoon_units = 0
        night_units = 1
        units_per_day = 2
    """

    candidates: list[tuple[DosageSchedule, float]] = []
    invalid_fraction = False
    for instruction in instructions:
        for match in DOSAGE_PATTERN.finditer(instruction):
            morning = _parse_dosage_value(match.group("morning"))
            afternoon = _parse_dosage_value(match.group("afternoon"))
            night = _parse_dosage_value(match.group("night"))
            if morning is None or afternoon is None or night is None:
                invalid_fraction = True
                continue
            daily_units = (
                morning
                + afternoon
                + night
            )

            raw_pattern = match.group(
                0
            )

            candidates.append(
                (
                    DosageSchedule(
                        raw_pattern=raw_pattern,
                        morning_units=morning,
                        afternoon_units=afternoon,
                        night_units=night,
                        units_per_day=daily_units,
                    ),
                    float(
                        sum(
                            units > 0
                            for units in (
                                morning,
                                afternoon,
                                night,
                            )
                        )
                    ),
                ),
            )

        abbreviation_frequency = _extract_abbreviation_frequency(instruction)
        if abbreviation_frequency is not None:
            candidates.append(
                (
                    DosageSchedule(
                        raw_pattern=_normalize_abbreviation(instruction),
                        units_per_day=None,
                    ),
                    abbreviation_frequency,
                )
            )

        for verbal_match in VERBAL_DOSAGE_PATTERN.finditer(instruction):
            count = {
                "once": 1.0,
                "one": 1.0,
                "twice": 2.0,
                "two": 2.0,
                "thrice": 3.0,
                "three": 3.0,
                "1": 1.0,
                "2": 2.0,
                "3": 3.0,
            }[
                verbal_match.group("count").lower()
            ]

            dose_quantities = list(
                DOSE_QUANTITY_PATTERN.finditer(
                    instruction[: verbal_match.start()]
                )
            )
            daily_units: float | None = None
            if len(dose_quantities) == 1:
                dose_value = dose_quantities[0].group("value").lower()
                dose_units = {
                    "one": 1.0,
                    "two": 2.0,
                    "half": 0.5,
                    "a": 1.0,
                    "an": 1.0,
                }.get(dose_value)
                if dose_units is None:
                    dose_units = float(dose_value)
                daily_units = dose_units * count

            candidates.append(
                (
                    DosageSchedule(
                        raw_pattern=verbal_match.group(0),
                        units_per_day=daily_units,
                    ),
                    count,
                )
            )

    if invalid_fraction:
        return (
            DosageSchedule(),
            None,
            ExtractionWarning(
            field_name="dosage_schedule",
            message=(
                "A dosage fraction has an invalid zero denominator; "
                "structured dosage and frequency were left unknown."
            ),
            ),
        )

    if not candidates:
        return DosageSchedule(), None, None

    if _has_conflicting_schedules(candidates):
        return (
            DosageSchedule(),
            None,
            ExtractionWarning(
                field_name="dosage_schedule",
                message=(
                    "Conflicting explicit dosage schedules were found; "
                    "structured dosage and frequency were left unknown."
                ),
            ),
        )

    schedule, frequency = max(
        candidates,
        key=lambda item: (
            item[0].morning_units is not None,
            item[0].units_per_day is not None,
        ),
    )
    return schedule, frequency, None


def _parse_dosage_value(value: str) -> float | None:
    if "/" not in value:
        return float(value)

    numerator, denominator = value.split("/", maxsplit=1)
    denominator_value = float(denominator)
    if denominator_value == 0:
        return None
    return float(numerator) / denominator_value


def _extract_abbreviation_frequency(
    instruction: str,
) -> float | None:
    """Map explicit daily abbreviations to a safe frequency.

    Ambiguous or as-needed instructions such as SOS, PRN, HS, and STAT are
    intentionally not converted into a dosage frequency because they do not
    provide a deterministic daily dose count.
    """

    matches = list(ABBREVIATION_SCHEDULE_PATTERN.finditer(instruction))
    if not matches:
        return None

    if AMBIGUOUS_ABBREVIATION_PATTERN.search(instruction):
        return None

    dose_context = bool(
        re.search(
            r"""
            (?:(?:\d+(?:\.\d+)?)|one|two|three|half|a|an)
            \s+
            (?:tablet|tab|capsule|cap|drops?|syrup|ml|mg|mcg)
            """,
            instruction,
            re.IGNORECASE | re.VERBOSE,
        )
    )
    if not dose_context and not re.search(r"\b(?:once|twice|thrice)\b", instruction, re.IGNORECASE):
        return None

    frequencies: list[float] = []
    for match in matches:
        token = match.group(0).strip().upper().replace(".", "")
        normalized = token.replace("/", "")
        if normalized in {"OD"}:
            frequencies.append(1.0)
        elif normalized in {"BID", "BD"}:
            frequencies.append(2.0)
        elif normalized in {"TID", "TDS"}:
            frequencies.append(3.0)
        elif normalized in {"QID"}:
            frequencies.append(4.0)

    if not frequencies:
        return None

    frequency = frequencies[0]
    if any(value != frequency for value in frequencies[1:]):
        return None

    return frequency


def _normalize_abbreviation(
    instruction: str,
) -> str:
    """Return the normalized abbreviation from the instruction text."""

    match = ABBREVIATION_SCHEDULE_PATTERN.search(instruction)
    if match is None:
        return instruction.strip()
    return match.group(0).strip()


def _has_conflicting_schedules(
    candidates: list[tuple[DosageSchedule, float]],
) -> bool:
    for index, (left, left_frequency) in enumerate(candidates):
        for right, right_frequency in candidates[index + 1:]:
            if left_frequency != right_frequency:
                return True

            left_slots = (
                left.morning_units,
                left.afternoon_units,
                left.night_units,
            )
            right_slots = (
                right.morning_units,
                right.afternoon_units,
                right.night_units,
            )
            if (
                left.morning_units is not None
                and right.morning_units is not None
                and left_slots != right_slots
            ):
                return True

            if (
                left.units_per_day is not None
                and right.units_per_day is not None
                and left.units_per_day != right.units_per_day
            ):
                return True

    return False


def _extract_timing(
    instructions: list[str],
) -> tuple[str | None, ExtractionWarning | None]:
    """
    Extract timing relative to food.
    """

    timings: set[str] = set()
    for instruction in instructions:
        if AFTER_FOOD_PATTERN.search(instruction):
            timings.add("after_food")
        if BEFORE_FOOD_PATTERN.search(instruction):
            timings.add("before_food")

        abb_match = ABBREVIATION_TIMING_PATTERN.search(instruction)
        if abb_match is not None:
            normalized = abb_match.group(0).upper().replace(".", "")
            if normalized in {"AC"}:
                timings.add("before_food")
            elif normalized in {"PC"}:
                timings.add("after_food")

    if len(timings) > 1:
        return (
            None,
            ExtractionWarning(
                field_name="timing",
                message=(
                    "Conflicting explicit food-timing instructions were found; "
                    "timing was left unknown."
                ),
            ),
        )

    return next(iter(timings), None), None


def _extract_duration(
    instructions: list[str],
) -> tuple[Duration, ExtractionWarning | None]:
    """
    Extract explicitly stated treatment duration.
    """

    durations: set[tuple[float, str]] = set()
    for instruction in instructions:
        for match in DURATION_PATTERN.finditer(instruction):
            value = float(match.group("value"))
            unit = match.group("unit").lower()
            if not unit.endswith("s"):
                unit = unit + "s"
            durations.add((value, unit))

    if len(durations) > 1:
        return (
            Duration(),
            ExtractionWarning(
                field_name="duration",
                message=(
                    "Conflicting explicit treatment durations were found; "
                    "duration was left unknown."
                ),
            ),
        )

    if not durations:
        return Duration(), None

    value, unit = next(iter(durations))
    return Duration(value=value, unit=unit), None


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
        dosage_matches = list(DOSAGE_PATTERN.finditer(instruction))
        if any(
            _parse_dosage_value(match.group(slot)) is None
            for match in dosage_matches
            for slot in ("morning", "afternoon", "night")
        ):
            additional_instructions.append(instruction)
            continue

        has_dosage_schedule = (
            bool(dosage_matches)
            or VERBAL_DOSAGE_PATTERN.search(
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
            or ABBREVIATION_TIMING_PATTERN.search(
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

        has_abbreviation_frequency = (
            _extract_abbreviation_frequency(
                instruction
            )
            is not None
        )

        has_structured_information = (
            has_dosage_schedule
            or has_timing
            or has_duration
            or has_abbreviation_frequency
        )

        if not has_structured_information:

            additional_instructions.append(
                instruction
            )

    return additional_instructions