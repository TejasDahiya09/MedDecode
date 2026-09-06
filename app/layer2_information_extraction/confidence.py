def combine_confidence(
    ocr_confidence: float | None,
    extraction_confidence: float,
) -> float:
    """
    Combine OCR confidence with confidence in the extraction rule.

    The result is always constrained to the range 0.0 to 1.0.
    """

    if ocr_confidence is None:
        return max(
            0.0,
            min(1.0, extraction_confidence),
        )

    combined = (
        0.7 * float(ocr_confidence)
        + 0.3 * extraction_confidence
    )

    return max(
        0.0,
        min(1.0, combined),
    )