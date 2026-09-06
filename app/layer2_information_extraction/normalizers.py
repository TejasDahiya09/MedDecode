import re


def normalize_whitespace(
    value: str,
) -> str:
    """
    Normalize repeated whitespace into single spaces.
    """

    return re.sub(
        r"\s+",
        " ",
        value,
    ).strip()


def clean_extracted_value(
    value: str,
) -> str:
    """
    Clean common OCR and formatting artifacts from an extracted value.

    This function intentionally performs conservative cleaning.
    It must not invent or infer missing information.
    """

    value = normalize_whitespace(
        value
    )

    value = value.strip(
        ":-|,"
    )

    return value.strip()


def normalize_gender(
    value: str,
) -> str | None:
    """
    Normalize explicitly present gender values.

    No gender is inferred from a person's name.
    """

    normalized = (
        value.strip()
        .lower()
        .replace(".", "")
    )

    mapping = {
        "m": "male",
        "male": "male",
        "f": "female",
        "female": "female",
        "other": "other",
    }

    return mapping.get(
        normalized
    )