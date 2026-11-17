from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import fitz


@dataclass
class PDFTextEvidence:
    page_number: int
    text: str
    word_count: int
    block_count: int
    x0: float
    y0: float
    x1: float
    y1: float
    searchable: bool
    warnings: list[str] = field(default_factory=list)
    words: list[dict[str, Any]] = field(default_factory=list)


def extract_searchable_pdf_text(
    pdf_path: str | Path,
    *,
    max_pages: int | None = None,
    max_chars_per_page: int = 100_000,
    max_words_per_page: int = 20_000,
) -> dict[str, Any]:
    """Return structured native PDF text extraction evidence for searchable PDFs.

    This function uses the native PDF text layer when present. It does not modify
    the original document. It is intentionally fail-closed: if the text layer is
    missing or incomplete, the result surfaces that fact explicitly.
    """

    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")
    if path.suffix.lower() != ".pdf":
        raise ValueError(f"File is not a PDF: {pdf_path}")
    if max_pages is not None and max_pages < 1:
        raise ValueError("max_pages must be positive when provided.")
    if max_chars_per_page < 1 or max_words_per_page < 1:
        raise ValueError("PDF text extraction bounds must be positive.")

    pages: list[PDFTextEvidence] = []
    searchable_pages = 0
    suspicious_pages: list[int] = []

    with fitz.open(path) as document:
        total_pages = len(document)
        limit = total_pages if max_pages is None else min(total_pages, max_pages)

        for page_number in range(limit):
            page = document[page_number]
            blocks = page.get_text("blocks")
            full_text = page.get_text("text", sort=True).strip()
            text = full_text[:max_chars_per_page]
            all_words = page.get_text("words", sort=True)
            words = all_words[:max_words_per_page]
            block_count = len(blocks)
            if text:
                searchable_pages += 1
                page_bounds = []
                for block in blocks:
                    if block[4].strip():
                        page_bounds.append((float(block[0]), float(block[1]), float(block[2]), float(block[3])))
                if page_bounds:
                    x0 = min(item[0] for item in page_bounds)
                    y0 = min(item[1] for item in page_bounds)
                    x1 = max(item[2] for item in page_bounds)
                    y1 = max(item[3] for item in page_bounds)
                else:
                    x0 = y0 = x1 = y1 = 0.0
                warnings: list[str] = []
                if len(words) < 3:
                    warnings.append("suspiciously_short_text_layer")
                if len(text) < 20:
                    warnings.append("possibly_incomplete_text_layer")
                if len(full_text) > max_chars_per_page:
                    warnings.append("text_layer_truncated")
                if len(all_words) > max_words_per_page:
                    warnings.append("word_list_truncated")
                if "\ufffd" in text or _control_character_ratio(text) > 0.01:
                    warnings.append("suspicious_text_encoding")
                pages.append(
                    PDFTextEvidence(
                        page_number=page_number + 1,
                        text=text,
                        word_count=len(all_words),
                        block_count=block_count,
                        x0=x0,
                        y0=y0,
                        x1=x1,
                        y1=y1,
                        searchable=True,
                        warnings=warnings,
                        words=[
                            {
                                "text": str(word[4]),
                                "bounding_box": [
                                    float(word[0]),
                                    float(word[1]),
                                    float(word[2]),
                                    float(word[3]),
                                ],
                            }
                            for word in words
                        ],
                    )
                )
            else:
                suspicious_pages.append(page_number + 1)
                pages.append(
                    PDFTextEvidence(
                        page_number=page_number + 1,
                        text="",
                        word_count=0,
                        block_count=block_count,
                        x0=0.0,
                        y0=0.0,
                        x1=0.0,
                        y1=0.0,
                        searchable=False,
                        warnings=["no_native_text_layer_detected"],
                    )
                )

    return {
        "pdf_path": str(path),
        "page_count": total_pages,
        "processed_page_count": limit,
        "searchable_page_count": searchable_pages,
        "is_searchable": searchable_pages > 0,
        "pages": [
            {
                "page_number": page.page_number,
                "text": page.text,
                "word_count": page.word_count,
                "block_count": page.block_count,
                "bounding_box": [page.x0, page.y0, page.x1, page.y1],
                "searchable": page.searchable,
                "warnings": page.warnings,
                "words": page.words,
            }
            for page in pages
        ],
        "suspicious_pages": suspicious_pages,
        "warnings": [
            "page_text_layer_missing"
            for _ in suspicious_pages
        ],
    }


def _control_character_ratio(text: str) -> float:
    if not text:
        return 0.0
    controls = sum(ord(character) < 32 and character not in "\n\r\t" for character in text)
    return controls / len(text)


def inspect_pdf_text_layer(pdf_path: str | Path, *, max_pages: int | None = None) -> dict[str, Any]:
    """Alias for searchable PDF extraction used by tests and integration code."""

    return extract_searchable_pdf_text(pdf_path, max_pages=max_pages)
