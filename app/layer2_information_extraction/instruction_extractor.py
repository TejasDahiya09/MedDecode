import re

from app.layer2_information_extraction.document_context import (
    PrescriptionDocumentContext,
)


GENERAL_INSTRUCTION_PATTERNS = (
    re.compile(
        r"\bdrink\b.*\bwater\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bavoid\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bfollow\s*up\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bcomplete\b.*\bcourse\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\brest\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bdiet\b",
        re.IGNORECASE,
    ),
)


def extract_general_instructions(
    context: PrescriptionDocumentContext,
) -> list[str]:
    """
    Extract general prescription instructions.

    These instructions apply to the prescription overall rather than
    to one specific medicine.

    Layer 2 preserves only source-supported text and does not infer
    medical meaning.
    """

    instructions: list[str] = []

    for line in context.lines:

        text = _normalize_text(
            line.text
        )

        if not text:
            continue

        if _is_general_instruction(
            text
        ):
            instructions.append(
                text
            )

    return instructions


def _is_general_instruction(
    text: str,
) -> bool:
    """
    Determine whether a line is likely to be a general prescription
    instruction.
    """

    return any(
        pattern.search(
            text
        )
        for pattern in GENERAL_INSTRUCTION_PATTERNS
    )


def _normalize_text(
    text: str,
) -> str:
    """
    Normalize OCR text without changing its meaning.
    """

    return re.sub(
        r"\s+",
        " ",
        text,
    ).strip()