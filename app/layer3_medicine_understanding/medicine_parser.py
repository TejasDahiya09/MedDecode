import re

from app.schemas.medicine import (
    MedicineUsageRecord,
    Strength,
)
from app.schemas.prescription import (
    RawMedicineEntry,
)


DOSAGE_FORM_ALIASES = {
    "tab": "tablet",
    "tablet": "tablet",

    "cap": "capsule",
    "capsule": "capsule",

    "syp": "syrup",
    "syrup": "syrup",

    "inj": "injection",
    "injection": "injection",

    "drop": "drops",
    "drops": "drops",

    "oint": "ointment",
    "ointment": "ointment",

    "cream": "cream",
    "gel": "gel",
    "lotion": "lotion",

    "susp": "suspension",
    "suspension": "suspension",

    "neb": "nebulizer",
    "nebuliser": "nebulizer",
    "nebulizer": "nebulizer",
}


DOSAGE_FORM_PATTERN = re.compile(
    r"""
    ^
    \s*
    (?P<form>
        tab(?:let)?\.?
        |
        cap(?:sule)?\.?
        |
        syp(?:rup)?\.?
        |
        inj(?:ection)?\.?
        |
        drop(?:s)?\.?
        |
        oint(?:ment)?\.?
        |
        cream
        |
        gel
        |
        lotion
        |
        susp(?:ension)?\.?
        |
        neb(?:uliser|ulizer)?\.?
    )
    \b
    """,
    re.IGNORECASE | re.VERBOSE,
)


STRENGTH_PATTERN = re.compile(
    r"""
    (?P<value>
        \d+(?:\.\d+)?
    )
    \s*
    (?P<unit>
        mg
        |
        mcg
        |
        g
        |
        ml
        |
        iu
        |
        units?
        |
        %
    )
    \b
    """,
    re.IGNORECASE | re.VERBOSE,
)


def parse_medicine_entry(
    entry: RawMedicineEntry,
) -> MedicineUsageRecord:
    """
    Parse structural medicine information from a Layer 2
    RawMedicineEntry.

    Layer 3 does not determine canonical medicine identity.
    It only separates information explicitly present in the
    prescription text.
    """

    raw_text = _normalize_text(
        entry.raw_text
    )

    dosage_form, text_without_form = (
        _extract_dosage_form(
            raw_text
        )
    )

    strength, text_without_strength = (
        _extract_strength(
            text_without_form
        )
    )

    raw_medicine_name = (
        _extract_raw_medicine_name(
            text_without_strength
        )
    )

    return MedicineUsageRecord(
        raw_medicine_text=entry.raw_text,
        raw_medicine_name=raw_medicine_name,
        dosage_form=dosage_form,
        strength=strength,
        source_instructions=(
            entry.instructions.copy()
        ),
        evidence=entry.evidence.copy(),
    )


def _normalize_text(
    text: str,
) -> str:
    """
    Normalize whitespace while preserving the original source text
    separately in the output record.
    """

    return " ".join(
        text.split()
    )


def _extract_dosage_form(
    text: str,
) -> tuple[str | None, str]:
    """
    Extract a dosage form when explicitly present at the beginning
    of the medicine entry.
    """

    match = DOSAGE_FORM_PATTERN.match(
        text
    )

    if match is None:
        return None, text

    raw_form = (
        match.group("form")
        .lower()
        .rstrip(".")
    )

    canonical_form = (
        DOSAGE_FORM_ALIASES.get(
            raw_form
        )
    )

    remaining_text = (
        text[match.end():].strip()
    )

    return (
        canonical_form,
        remaining_text,
    )


def _extract_strength(
    text: str,
) -> tuple[Strength, str]:
    """
    Extract the first explicit medicine strength from the text.

    If no valid strength is present, Strength remains empty.
    """

    match = STRENGTH_PATTERN.search(
        text
    )

    if match is None:
        return Strength(), text

    raw_value = match.group(
        "value"
    )

    raw_unit = match.group(
        "unit"
    )

    value = float(
        raw_value
    )

    unit = raw_unit.lower()

    remaining_text = (
        text[:match.start()]
        + text[match.end():]
    )

    remaining_text = (
        " ".join(
            remaining_text.split()
        )
    )

    return (
        Strength(
            value=value,
            unit=unit,
        ),
        remaining_text,
    )


def _extract_raw_medicine_name(
    text: str,
) -> str | None:
    """
    Return the remaining medicine-name text after explicitly
    recognized structural components are removed.

    No canonical medicine identity is inferred.
    """

    normalized = _normalize_text(
        text
    )

    if not normalized:
        return None

    return normalized