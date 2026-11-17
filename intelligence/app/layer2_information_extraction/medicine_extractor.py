import re

from app.layer2_information_extraction.document_context import (
    OCRLine,
    PrescriptionDocumentContext,
)
from app.schemas.prescription import (
    ExtractionWarning,
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
        re.compile(
        r"^\s*(?:synthetic|sample|test)\s+(?:test\s+)?(?:document|prescription|data)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*not\s+a\s+real\s+(?:patient|prescription)\b",
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
    re.compile(
        r"^\s*take\s+as\s+directed\b",
        re.IGNORECASE,
    ),
]

INLINE_INSTRUCTION_PATTERNS = [
    re.compile(
        r"""
        \b
        \d+(?:\.\d+)?\s*[-/xX]\s*
        \d+(?:\.\d+)?\s*[-/xX]\s*
        \d+(?:\.\d+)?
        \b
        """,
        re.IGNORECASE | re.VERBOSE,
    ),
    re.compile(
        r"""
        \b
        (?:
            take\s+(?=\d|one\b|two\b|half\b)
            | once|twice|thrice|daily|morning|evening|night
            | after\s+(?:food|meals?)
            | before\s+(?:food|meals?)
            | AC|PC|OD|BD|BID|TID|TDS|QID|SOS|PRN|HS|STAT
            | khane\s+ke\s+baad|khane\s+se\s+pehle
            | (?:for|x)\s+\d+(?:\.\d+)?\s+(?:day|days|week|weeks|month|months)
        )
        \b
        """,
        re.IGNORECASE | re.VERBOSE,
    ),
]

NUMBERED_ENTRY_PREFIX = re.compile(
    r"^\s*[\[(]?\d{1,2}\s*[.)\]:]\s*(?=[A-Za-z])"
)
STRUCTURED_MEDICINE_ATTRIBUTE_PATTERN = re.compile(
    r"^\s*(?:strength|dosage\s*form)\s*:\s*",
    re.IGNORECASE,
)
STRENGTH_ONLY_PATTERN = re.compile(
    r"^\s*\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|units?|%)\s*$",
    re.IGNORECASE,
)
EXPLICIT_REFERENCE_PATTERN = re.compile(
    r"""
    ^\s*
    (?:for\s+)?
    (?P<reference>[A-Za-z][A-Za-z0-9 .+'/-]{1,60}?)
    \s*:\s*
    (?P<instruction>.+?)
    \s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)


def extract_raw_medicines(
    context: PrescriptionDocumentContext,
    association_warnings: list[ExtractionWarning] | None = None,
) -> list[RawMedicineEntry]:
    """
    Extract raw medicine entries and attach nearby instruction lines.

    This function preserves prescription structure without attempting
    to interpret dosage semantics or identify canonical medicines.
    """

    medicines: list[RawMedicineEntry] = []

    current_medicine: RawMedicineEntry | None = None
    current_medicine_line: OCRLine | None = None
    association_open = False
    unresolved: list[OCRLine] = []
    inside_rx_section = False

    for line in context.lines:

        text = _normalize_text(
            line.text
        )
        has_numbered_prefix = NUMBERED_ENTRY_PREFIX.match(text) is not None
        candidate_text = _strip_numbered_prefix(text)

        if not text:
            continue

        if RX_MARKER_PATTERN.match(
            candidate_text
        ):
            inside_rx_section = True
            association_open = False
            continue

        if _is_non_medicine_line(
            candidate_text
        ):
            association_open = False
            continue

        if _is_general_instruction_line(candidate_text):
            association_open = False
            continue

        medicine_text, inline_instruction = _split_inline_instruction(
            candidate_text
        )

        # Structured templates commonly place a numbered medicine name on one
        # line and its labelled strength/form fields on the next.  Keep those
        # fields with the preceding identity instead of promoting labels such
        # as "Strength: ... Dosage form: Tablet" to a medicine name.
        if (
            current_medicine is not None
            and current_medicine_line is not None
            and association_open
            and _is_structured_medicine_attribute_line(candidate_text)
            and _is_clear_adjacent_line(current_medicine_line, line)
        ):
            current_medicine.raw_text = _normalize_text(
                f"{current_medicine.raw_text} {candidate_text}"
            )
            _append_source_evidence(current_medicine, line)
            current_medicine_line = line
            continue

        if _is_probable_medicine_line(
            text=medicine_text,
            inside_rx_section=inside_rx_section,
        ) or (
            has_numbered_prefix
            and _looks_like_name(medicine_text)
            and not _is_structured_medicine_attribute_line(medicine_text)
            and not _looks_like_instruction(medicine_text)
        ):
            current_medicine = (
                _create_raw_medicine_entry(
                    line,
                    raw_text=medicine_text,
                )
            )

            medicines.append(
                current_medicine
            )
            current_medicine_line = line
            association_open = True
            if inline_instruction:
                _attach_instruction(
                    medicine=current_medicine,
                    line=line,
                    instruction_text=inline_instruction,
                )

            continue

        if (
            current_medicine is not None
            and current_medicine_line is not None
            and association_open
            and _is_strength_continuation(candidate_text)
            and _is_clear_adjacent_line(current_medicine_line, line)
        ):
            current_medicine.raw_text = _normalize_text(
                f"{current_medicine.raw_text} {candidate_text}"
            )
            _append_source_evidence(
                current_medicine,
                line,
            )
            current_medicine_line = line
            continue

        reference_match = EXPLICIT_REFERENCE_PATTERN.fullmatch(candidate_text)
        explicit_target = _find_explicit_reference_target(
            candidate_text,
            medicines,
        )
        if explicit_target is not None:
            explicit_instruction = _explicit_reference_instruction(
                candidate_text
            )
            if explicit_instruction and _looks_like_instruction(explicit_instruction):
                _attach_instruction(
                    explicit_target,
                    line,
                    instruction_text=explicit_instruction,
                )
                continue
        elif reference_match is not None and _looks_like_instruction(
            reference_match.group("instruction")
        ):
            unresolved.append(line)
            association_open = False
            continue

        if (
            current_medicine is not None
            and _looks_like_instruction(candidate_text)
        ):
            if (
                current_medicine_line is not None
                and association_open
                and _is_clear_adjacent_line(current_medicine_line, line)
            ):
                _attach_instruction(
                    medicine=current_medicine,
                    line=line,
                    instruction_text=candidate_text,
                )
                current_medicine_line = line
            else:
                unresolved.append(line)
                association_open = False
        elif _looks_like_instruction(candidate_text):
            unresolved.append(line)
            association_open = False
        else:
            association_open = False

    unresolved_after_references: list[OCRLine] = []
    for line in unresolved:
        candidate_text = _strip_numbered_prefix(
            _normalize_text(line.text)
        )
        target = _find_explicit_reference_target(
            candidate_text,
            medicines,
        )
        instruction = _explicit_reference_instruction(candidate_text)
        if (
            target is not None
            and instruction
            and _looks_like_instruction(instruction)
        ):
            _attach_instruction(
                target,
                line,
                instruction_text=instruction,
            )
        else:
            unresolved_after_references.append(line)

    if association_warnings is not None:
        for line in unresolved_after_references:
            association_warnings.append(
                ExtractionWarning(
                    field_name="medicine_instruction_association",
                    message=(
                        f"Instruction was not assigned because its medicine association "
                        f"was ambiguous or not spatially adjacent (page {line.page_number}, "
                        f"blocks {line.block_indexes}): {line.text}"
                    ),
                )
            )

    return medicines


def _strip_numbered_prefix(text: str) -> str:
    return NUMBERED_ENTRY_PREFIX.sub("", text, count=1).strip()


def _split_inline_instruction(text: str) -> tuple[str, str | None]:
    matches = [
        match
        for pattern in INLINE_INSTRUCTION_PATTERNS
        for match in pattern.finditer(text)
    ]
    if not matches:
        return text, None
    start = min(match.start() for match in matches)
    if start == 0:
        return text, None
    medicine_text = text[:start].rstrip(" ,;:-")
    instruction_text = text[start:].strip(" ,;:-")
    if not medicine_text or not instruction_text:
        return text, None
    return medicine_text, instruction_text


def _is_strength_continuation(text: str) -> bool:
    return bool(STRENGTH_ONLY_PATTERN.fullmatch(text))


def _is_structured_medicine_attribute_line(text: str) -> bool:
    return bool(STRUCTURED_MEDICINE_ATTRIBUTE_PATTERN.match(text))


def _is_clear_adjacent_line(previous: OCRLine, current: OCRLine) -> bool:
    if previous.page_number != current.page_number:
        return False
    previous_height = max(previous.bottom - previous.top, 1.0)
    current_height = max(current.bottom - current.top, 1.0)
    vertical_gap = current.top - previous.bottom
    if vertical_gap < -max(previous_height, current_height) * 0.5:
        return False
    if vertical_gap > max(40.0, max(previous_height, current_height) * 2.5):
        return False
    horizontal_tolerance = max(45.0, max(previous_height, current_height) * 2.5)
    return abs(current.left - previous.left) <= horizontal_tolerance


def _explicit_reference_instruction(text: str) -> str | None:
    match = EXPLICIT_REFERENCE_PATTERN.fullmatch(text)
    if match is None:
        return None
    return match.group("instruction").strip()


def _find_explicit_reference_target(
    text: str,
    medicines: list[RawMedicineEntry],
) -> RawMedicineEntry | None:
    match = EXPLICIT_REFERENCE_PATTERN.fullmatch(text)
    if match is None or not _looks_like_instruction(
        match.group("instruction")
    ):
        return None
    reference = _normalize_text(match.group("reference")).casefold()
    candidates = [
        medicine
        for medicine in medicines
        if reference in medicine.raw_text.casefold()
    ]
    return candidates[0] if len(candidates) == 1 else None


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

    text_without_strength = STRENGTH_PATTERN.sub("", text)
    has_letters = bool(re.search(r"[A-Za-z]", text_without_strength))

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

    if any(
        pattern.search(text)
        for pattern in INLINE_INSTRUCTION_PATTERNS
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
        "khane ke baad",
        "khane se pehle",
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
    instruction_text: str | None = None,
) -> None:
    """
    Attach a raw prescription instruction to the current medicine.

    The instruction remains unparsed at Layer 2.
    """

    instruction = instruction_text or line.text
    medicine.instructions.append(instruction)

    _append_source_evidence(
        medicine,
        line,
    )


def _append_source_evidence(
    medicine: RawMedicineEntry,
    line: OCRLine,
) -> None:
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
    raw_text: str | None = None,
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
        raw_text=raw_text or line.text,
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
    association_warnings: list[ExtractionWarning] | None = None,
) -> list[RawMedicineEntry]:
    """
    Extract raw medicine entries from the prescription.
    """

    return extract_raw_medicines(
        context,
        association_warnings=association_warnings,
    )
