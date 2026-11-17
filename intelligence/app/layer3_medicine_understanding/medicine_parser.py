import re

from app.schemas.medicine import (
    IngredientStrength,
    MedicineUsageRecord,
    Strength,
)
from app.schemas.prescription import (
    ExtractionWarning,
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

    "oral liquid": "oral liquid",
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
        s(?:yp|yrup)\.?
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

DOSAGE_FORM_SUFFIX_PATTERN = re.compile(
    r"""
    \s+
    (?P<form>
        tab(?:let)?\.?
        |
        cap(?:sule)?\.?
        |
        s(?:yp|yrup)\.?
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
    \s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)

MEDICINE_LABEL_PATTERN = re.compile(
    r"^\s*medicine(?:\s+name)?\s*:\s*",
    re.IGNORECASE,
)

STRENGTH_LABEL_PATTERN = re.compile(
    r"\bstrength\s*:\s*",
    re.IGNORECASE,
)

LABELED_DOSAGE_FORM_PATTERN = re.compile(
    r"\bdosage\s*form\s*:\s*(?P<form>oral\s+liquid|tablet|capsule|syrup|injection|drops?|ointment|cream|gel|lotion|suspension|nebuliser|nebulizer)\b",
    re.IGNORECASE,
)

FIELD_LABEL_IDENTITY_PATTERN = re.compile(
    r"^(?:(?:medicine(?:\s+name)?|strength|dosage\s*form|dose|route|frequency)\s*:?\s*)+(?:(?:oral\s+liquid|tablet|capsule|syrup|injection|drops?|ointment|cream|gel|lotion|suspension|nebuliser|nebulizer)\s*)?$",
    re.IGNORECASE,
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

STRENGTH_RATIO_PATTERN = re.compile(
    r"""
    \b
    \d+(?:\.\d+)?
    \s*
    (?:mg|mcg|g)
    \s*(?:/|per)\s*
    (?:\d+(?:\.\d+)?\s*)?
    ml
    \b
    """,
    re.IGNORECASE | re.VERBOSE,
)

INSTRUCTION_TAIL_PATTERNS = [
    re.compile(
        r"""
        \b
        \d+\s*[-/xX]\s*\d+\s*[-/xX]\s*\d+
        \b
        """,
        re.IGNORECASE | re.VERBOSE,
    ),
    re.compile(
        r"""
        \b(?:
            once|twice|thrice|daily|per\s+day|a\s+day|morning|evening|night|before\s+food|after\s+food|before\s+meals|after\s+meals|subah|shaam|raat\s+ko|khane\s+se\s+pehle|khane\s+ke\s+baad
        )\b
        """,
        re.IGNORECASE | re.VERBOSE,
    ),
    re.compile(
        r"""
        \b(?:
            OD|O\.?D\.?|BID|B\.?I\.?D\.?|BD|TID|T\.?I\.?D\.?|TDS|QID|Q\.?I\.?D\.?|AC|A\.?C\.?|PC|P\.?C\.?|SOS|PRN|HS|STAT
        )\b
        """,
        re.IGNORECASE | re.VERBOSE,
    ),
    re.compile(
        r"""
        \b(?:for|x)\s+\d+(?:\.\d+)?\s+(?:day|days|week|weeks|month|months)\b
        """,
        re.IGNORECASE | re.VERBOSE,
    ),
]

# A component is retained only when its name and its immediately following
# strength are both present in the prescription text.  This deliberately does
# not assign one medicine-level strength to every component.
COMPONENT_STRENGTH_PATTERN = re.compile(
    r"(?P<name>[A-Za-z][A-Za-z0-9 .()'/-]*?)\s+"
    r"(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>mg|mcg|g|ml|iu|units?|%)\b",
    re.IGNORECASE,
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
    raw_text = MEDICINE_LABEL_PATTERN.sub(
        "",
        raw_text,
        count=1,
    )

    dosage_form, text_without_form = _extract_labeled_dosage_form(raw_text)
    if dosage_form is None:
        dosage_form, text_without_form = _extract_dosage_form(raw_text)

    text_without_form = STRENGTH_LABEL_PATTERN.sub(
        " ", text_without_form
    )

    strength_ratio = STRENGTH_RATIO_PATTERN.search(text_without_form)
    warnings: list[ExtractionWarning] = []
    if strength_ratio is not None:
        strength = Strength()
        text_without_strength = STRENGTH_RATIO_PATTERN.sub(
            "",
            text_without_form,
        )
        text_without_strength = STRENGTH_PATTERN.sub(
            "",
            text_without_strength,
        )
        text_without_strength = re.sub(
            r"\s*/\s*",
            " ",
            text_without_strength,
        )
        text_without_strength = _normalize_text(
            text_without_strength
        )
        text_without_strength = text_without_strength.strip(" +,;")
        ingredient_strengths = []
        warnings.append(
            ExtractionWarning(
                field_name="strength",
                message=(
                    "A concentration ratio was observed but cannot be represented "
                    "by the current structured strength fields; strength was left unknown."
                ),
            )
        )
    else:
        strength, text_without_strength = _extract_strength(text_without_form)
        ingredient_strengths = _extract_component_strengths(text_without_form)

    text_without_strength = _strip_instruction_fragments(text_without_strength)

    # For a fixed-dose combination the legacy scalar strength remains the
    # first written component, while the canonical text is reconstructed from
    # the explicit component names.  This prevents a trailing component
    # strength from being mistakenly absorbed into the medicine name.
    if len(ingredient_strengths) >= 2:
        raw_medicine_name = " + ".join(item.name for item in ingredient_strengths)
    else:
        raw_medicine_name = _extract_raw_medicine_name(text_without_strength)

    if raw_medicine_name is not None and FIELD_LABEL_IDENTITY_PATTERN.fullmatch(
        raw_medicine_name
    ):
        raw_medicine_name = None

    if raw_medicine_name is None:
        warnings.append(
            ExtractionWarning(
                field_name="medicine_name",
                message=(
                    "Medicine identity was not supported by source text; "
                    "manual review is required."
                ),
            )
        )

    return MedicineUsageRecord(
        raw_medicine_text=entry.raw_text,
        raw_medicine_name=raw_medicine_name,
        dosage_form=dosage_form,
        strength=strength,
        ingredient_strengths=ingredient_strengths,
        warnings=warnings,
        source_instructions=(
            entry.instructions.copy()
        ),
        evidence=entry.evidence.copy(),
        automatic_identity_eligible=entry.automatic_identity_eligible,
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

    # First, check whether dosage form appears at the beginning.
    match = DOSAGE_FORM_PATTERN.match(text)

    if match is not None:
        raw_form = (
            match.group("form")
            .lower()
            .rstrip(".")
        )

        canonical_form = DOSAGE_FORM_ALIASES.get(
            raw_form
        )

        remaining_text = text[match.end():].strip()

        return canonical_form, remaining_text

    # If not found at the beginning, check the end.
    match = DOSAGE_FORM_SUFFIX_PATTERN.search(text)

    if match is not None:
        raw_form = (
            match.group("form")
            .lower()
            .rstrip(".")
        )

        canonical_form = DOSAGE_FORM_ALIASES.get(
            raw_form
        )

        remaining_text = text[:match.start()].strip()

        return canonical_form, remaining_text

    return None, text


def _extract_labeled_dosage_form(text: str) -> tuple[str | None, str]:
    """Extract an explicitly labelled form without treating its label as identity."""

    match = LABELED_DOSAGE_FORM_PATTERN.search(text)
    if match is None:
        return None, text
    raw_form = " ".join(match.group("form").casefold().split())
    canonical_form = DOSAGE_FORM_ALIASES.get(raw_form, raw_form)
    remaining = _normalize_text(f"{text[:match.start()]} {text[match.end():]}")
    return canonical_form, remaining


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


def _strip_instruction_fragments(
    text: str,
) -> str:
    """Remove instruction-only fragments from a medicine-name candidate."""

    cleaned = text
    for pattern in INSTRUCTION_TAIL_PATTERNS:
        cleaned = pattern.sub(" ", cleaned)

    cleaned = re.sub(r"\s+/\s+", " ", cleaned)
    cleaned = re.sub(r"\s+[-,;]+\s+", " ", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip(" +,;/ ")


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


def _extract_component_strengths(text: str) -> list[IngredientStrength]:
    """Return only independently evidenced component strengths.

    A plain single-ingredient entry is represented too, which gives callers a
    uniform source-evidence surface without changing the legacy scalar field.
    """

    components: list[IngredientStrength] = []
    for match in COMPONENT_STRENGTH_PATTERN.finditer(text):
        name = " ".join(match.group("name").strip(" +,;/").split())
        if not name:
            continue
        components.append(
            IngredientStrength(
                name=name,
                value=float(match.group("value")),
                unit=match.group("unit").casefold(),
            )
        )
    return components
