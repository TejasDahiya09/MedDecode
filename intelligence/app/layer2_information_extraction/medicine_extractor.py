import re

from app.layer2_information_extraction.document_context import (
    OCRLine,
    PrescriptionDocumentContext,
)
from app.schemas.prescription import (
    RawMedicineEntry,
    SourceEvidence,
)


MEDICINE_FORM_PATTERN = re.compile(
    r"""
    ^
    \s*
    (?:
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
    \b
    \d+(?:\.\d+)?
    \s*
    (?:
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


DOSAGE_PATTERN = re.compile(
    r"""
    \b
    \d+
    \s*[-/xX]\s*
    \d+
    \s*[-/xX]\s*
    \d+
    \b
    """,
    re.VERBOSE,
)


NON_MEDICINE_PATTERNS = [
    re.compile(
        r"^\s*dr\.?\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*patient\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*patient\s+name\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*name\s*:",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*age\s*:",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*gender\s*:",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*date\s*:",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*reg(?:istration)?\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*(hospital|clinic|medical\s+centre|medical\s+center)\b",
        re.IGNORECASE,
    ),
]


RX_MARKER_PATTERN = re.compile(
    r"""
    ^
    \s*
    (?:rx|r\s*x)
    \s*[:\-]?
    \s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)

GENERAL_INSTRUCTION_PATTERNS = [
    re.compile(
        r"^\s*drink\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*avoid\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*follow\s*up\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*rest\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*complete\b.*\bcourse\b",
        re.IGNORECASE,
    ),
]


def extract_raw_medicines(
    context: PrescriptionDocumentContext,
) -> list[RawMedicineEntry]:
    """
    Extract raw medicine entries and attach nearby instruction lines.

    This function preserves prescription structure without attempting
    to interpret dosage semantics or identify canonical medicines.
    """

    medicines: list[RawMedicineEntry] = []

    current_medicine: RawMedicineEntry | None = None

    inside_rx_section = False

    for line in context.lines:

        text = _normalize_text(
            line.text
        )

        if not text:
            continue

        if RX_MARKER_PATTERN.match(
            text
        ):
            inside_rx_section = True
            continue

        if _is_non_medicine_line(
            text
        ):
            continue

        if _is_probable_medicine_line(
            text=text,
            inside_rx_section=inside_rx_section,
        ):
            current_medicine = (
                _create_raw_medicine_entry(
                    line
                )
            )

            medicines.append(
                current_medicine
            )

            continue

        if (
            current_medicine is not None
            and _looks_like_instruction(
                text
            )
            and not _is_general_instruction_line(
                text
            )
        ):
            _attach_instruction(
                medicine=current_medicine,
                line=line,
            )

    return medicines

def _is_general_instruction_line(
    text: str,
) -> bool:
    """
    Determine whether a line is a general prescription instruction.

    General instructions must not be interpreted as medicine entries,
    even when they appear inside or after an Rx section.
    """

    return any(
        pattern.search(
            text
        )
        for pattern in GENERAL_INSTRUCTION_PATTERNS
    )


def _is_probable_medicine_line(
    text: str,
    inside_rx_section: bool,
) -> bool:
    """
    Determine whether a reconstructed OCR line is likely to contain
    a medicine entry.

    Detection uses several independent signals:

    - pharmaceutical form
    - medicine-strength structure
    - Rx prescription section context

    General prescription instructions are explicitly excluded before
    applying Rx-section permissive matching.

    Canonical medicine verification happens later against the
    medicine database.
    """

    if _is_general_instruction_line(
        text
    ):
        return False

    if _has_medicine_form(
        text
    ):
        return True

    if _has_strength_and_name(
        text
    ):
        return True

    if (
        inside_rx_section
        and _looks_like_name(
            text
        )
        and not _looks_like_instruction(
            text
        )
    ):
        return True

    return False


def _has_medicine_form(
    text: str,
) -> bool:
    """
    Check whether the line begins with a common pharmaceutical form.
    """

    return bool(
        MEDICINE_FORM_PATTERN.search(
            text
        )
    )


def _has_strength_and_name(
    text: str,
) -> bool:
    """
    Detect medicine-like lines containing both alphabetic text and a
    pharmaceutical strength.

    Example:
        Metformin 500 mg
        Augmentin 625 mg
    """

    has_strength = bool(
        STRENGTH_PATTERN.search(
            text
        )
    )

    has_letters = bool(
        re.search(
            r"[A-Za-z]",
            text,
        )
    )

    return (
        has_strength
        and has_letters
        and not _looks_like_instruction(
            text
        )
    )


def _looks_like_name(
    text: str,
) -> bool:
    """
    Determine whether text has a plausible medicine-name structure.

    This is intentionally permissive because canonical verification
    happens later against the medicine database.
    """

    return bool(
        re.fullmatch(
            r"""
            [A-Za-z]
            [A-Za-z0-9\-/().]*
            (?:
                \s+
                [A-Za-z0-9\-/().]+
            )*
            """,
            text,
            re.VERBOSE,
        )
    )


def _looks_like_instruction(
    text: str,
) -> bool:
    """
    Identify common dosage/instruction patterns.

    Instruction lines should not be treated as independent medicines.
    """

    lower_text = text.lower()

    if DOSAGE_PATTERN.search(
        text
    ):
        return True

    instruction_keywords = (
        "daily",
        "days",
        "week",
        "weeks",
        "after food",
        "before food",
        "after meals",
        "before meals",
        "morning",
        "night",
        "bedtime",
        "take ",
        "once",
        "twice",
        "thrice",
    )

    return any(
        keyword in lower_text
        for keyword in instruction_keywords
    )


def _is_non_medicine_line(
    text: str,
) -> bool:
    """
    Reject common prescription metadata lines before medicine detection.
    """

    return any(
        pattern.search(
            text
        )
        for pattern in NON_MEDICINE_PATTERNS
    )

def _attach_instruction(
    medicine: RawMedicineEntry,
    line: OCRLine,
) -> None:
    """
    Attach a raw prescription instruction to the current medicine.

    The instruction remains unparsed at Layer 2.
    """

    medicine.instructions.append(
        line.text
    )

    medicine.evidence.append(
        SourceEvidence(
            page_number=line.page_number,
            source_text=line.text,
            source_block_indexes=(
                line.block_indexes.copy()
            ),
        )
    )

def _create_raw_medicine_entry(
    line: OCRLine,
) -> RawMedicineEntry:
    """
    Convert an OCRLine into a traceable RawMedicineEntry.
    """

    evidence = SourceEvidence(
        page_number=line.page_number,
        source_text=line.text,
        source_block_indexes=(
            line.block_indexes.copy()
        ),
    )

    return RawMedicineEntry(
        raw_text=line.text,
        page_number=line.page_number,
        confidence=line.confidence,
        evidence=[evidence],
    )


def _normalize_text(
    text: str,
) -> str:
    """
    Normalize OCR whitespace without changing the original meaning.
    """

    return " ".join(
        text.split()
    )

def extract_medicine_entries(
    context: PrescriptionDocumentContext,
) -> list[RawMedicineEntry]:
    """
    Extract raw medicine entries from the prescription.
    """

    return extract_raw_medicines(
        context
    )