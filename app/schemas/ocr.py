from dataclasses import dataclass
from typing import List


@dataclass
class OCRBlock:
    """
    A single text region detected on a document page.
    """

    text: str
    confidence: float
    bounding_box: list[list[float]]


@dataclass
class OCRPageResult:
    """
    OCR result for one document page.
    """

    full_text: str
    blocks: list[OCRBlock]