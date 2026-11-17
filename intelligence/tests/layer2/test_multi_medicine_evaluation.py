from __future__ import annotations

import collections

from app.layer2_information_extraction.document_context import (
    PrescriptionDocumentContext,
)
from app.layer2_information_extraction.pipeline import (
    extract_prescription_information,
)
from app.layer2_information_extraction.medicine_extractor import (
    extract_raw_medicines,
)
from app.layer3_medicine_understanding.pipeline import (
    understand_medicine_entries,
)
from .multi_medicine_fixtures import build_fictional_prescriptions


FIXTURES = build_fictional_prescriptions()


def test_fictional_benchmark_has_required_coverage():
    assert len(FIXTURES) == 30
    counts = [len(fixture.medicines) for fixture in FIXTURES]
    assert sum(counts) == 100
    assert {2, 3, 5}.issubset(set(counts))
    assert sum(fixture.adversarial for fixture in FIXTURES) >= 10


def test_entry_instruction_and_strength_metrics_on_fictional_benchmark():
    expected_count = predicted_count = entry_matches = 0
    instruction_matches = leakage_count = 0
    strength_matches = duration_matches = frequency_matches = 0
    unsafe_numeric_substitutions = 0
    association_expectations = 0
    ambiguity_count = ambiguity_preserved = 0

    for fixture in FIXTURES:
        context = PrescriptionDocumentContext.from_ocr_pages([fixture.page])
        warnings = []
        actual = extract_raw_medicines(
            context,
            association_warnings=warnings,
        )
        expected = list(fixture.medicines)
        expected_count += len(expected)
        predicted_count += len(actual)
        expected_raw = collections.Counter(item.raw_text for item in expected)
        actual_raw = collections.Counter(item.raw_text for item in actual)
        entry_matches += sum((expected_raw & actual_raw).values())

        by_raw = {medicine.raw_text: medicine for medicine in actual}
        understood = {
            medicine.raw_medicine_text: medicine
            for medicine in understand_medicine_entries(actual)
        }

        for expected_medicine in expected:
            medicine = by_raw.get(expected_medicine.raw_text)
            structured = understood.get(expected_medicine.raw_text)
            if medicine is None or structured is None:
                continue
            if expected_medicine.instructions:
                association_expectations += len(expected_medicine.instructions)
                instruction_matches += sum(
                    instruction in medicine.instructions
                    for instruction in expected_medicine.instructions
                )
            leakage_count += sum(
                instruction not in expected_medicine.instructions
                for instruction in medicine.instructions
            )
            if (
                structured.strength.value == expected_medicine.strength_value
                and structured.strength.unit == expected_medicine.strength_unit
            ):
                strength_matches += 1
            elif structured.strength.value is not None:
                unsafe_numeric_substitutions += 1
            if expected_medicine.duration_days is None:
                duration_matches += int(structured.duration.value is None)
            else:
                duration_matches += int(
                    structured.duration.value == expected_medicine.duration_days
                    and structured.duration.unit == "days"
                )
            if expected_medicine.schedule is None:
                frequency_matches += int(
                    structured.dosage_schedule.raw_pattern is None
                )
            else:
                frequency_matches += int(
                    structured.dosage_schedule.raw_pattern == expected_medicine.schedule
                )
            if expected_medicine.ambiguous_instruction is not None:
                ambiguity_count += 1
                ambiguity_preserved += int(
                    expected_medicine.ambiguous_instruction not in medicine.instructions
                    and any(
                        expected_medicine.ambiguous_instruction in warning.message
                        for warning in warnings
                    )
                )

    precision = entry_matches / predicted_count
    recall = entry_matches / expected_count
    f1 = 2 * precision * recall / (precision + recall)
    assert (entry_matches, predicted_count, expected_count) == (100, 100, 100)
    assert (precision, recall, f1) == (1.0, 1.0, 1.0)
    assert instruction_matches == association_expectations
    assert leakage_count == 0
    assert strength_matches == 100
    assert unsafe_numeric_substitutions == 0
    assert duration_matches == 100
    assert frequency_matches == 100
    assert ambiguity_preserved == ambiguity_count > 0


def test_inline_multiline_numbered_and_explicit_reference_association():
    prescriptions = [
        ["Tab Fictional A 500 mg 1-0-1 after food for 5 days"],
        [
            "Tab Fictional B",
            "2.5 mg",
            "0-0-1 x 7 days",
        ],
        [
            "1. Cap Fictional C 250 mcg",
            "1-1-1 before food for 3 days",
        ],
        [
            "Tab Fictional D 10 mg",
            "Fictional D: 0.5-0-0.5 for 2 days",
        ],
        ["Tab Fictional E 250 mcg 1x0x1"],
    ]
    expected = [
        ("Tab Fictional A 500 mg", ["1-0-1 after food for 5 days"]),
        ("Tab Fictional B 2.5 mg", ["0-0-1 x 7 days"]),
        ("Cap Fictional C 250 mcg", ["1-1-1 before food for 3 days"]),
        ("Tab Fictional D 10 mg", ["0.5-0-0.5 for 2 days"]),
        ("Tab Fictional E 250 mcg", ["1x0x1"]),
    ]
    for lines, (raw_text, instructions) in zip(prescriptions, expected, strict=True):
        context = PrescriptionDocumentContext.from_ocr_pages(
            [build_page(lines)]
        )
        medicines = extract_raw_medicines(context)
        assert len(medicines) == 1
        assert medicines[0].raw_text == raw_text
        assert medicines[0].instructions == instructions


def test_far_away_instruction_is_not_assigned_and_is_warned():
    page = build_page(
        [
            "Tab Fictional A 500 mg",
            "1-0-1 after food",
            "Tab Fictional B 10 mg",
        ],
        left_positions=[20, 350, 20],
    )
    result = extract_prescription_information([page])
    assert len(result.medicines) == 2
    assert all(not medicine.instructions for medicine in result.medicines)
    assert any(
        warning.field_name == "medicine_instruction_association"
        for warning in result.warnings
    )


def test_repeated_medicine_entries_are_not_deduplicated():
    page = build_page(
        [
            "Tab Fictional A 500 mg",
            "1-0-0",
            "Tab Fictional A 500 mg",
            "0-0-1",
        ]
    )
    medicines = extract_raw_medicines(
        PrescriptionDocumentContext.from_ocr_pages([page])
    )
    assert [medicine.raw_text for medicine in medicines] == [
        "Tab Fictional A 500 mg",
        "Tab Fictional A 500 mg",
    ]
    assert [medicine.instructions for medicine in medicines] == [
        ["1-0-0"],
        ["0-0-1"],
    ]

def test_duplicate_ocr_blocks_collapse_but_preserve_all_block_indexes():
    page = build_page(
        [
            "Tab Fictional A 500 mg",
            "Tab Fictional A 500 mg",
            "1-0-1",
        ]
    )
    page.blocks[1].bounding_box = [point.copy() for point in page.blocks[0].bounding_box]
    page.blocks[1].confidence = 0.2
    page.blocks[2].bounding_box = [
        [20, 40],
        [320, 40],
        [320, 60],
        [20, 60],
    ]
    context = PrescriptionDocumentContext.from_ocr_pages([page])
    medicines = extract_raw_medicines(context)
    assert len(medicines) == 1
    assert medicines[0].raw_text == "Tab Fictional A 500 mg"
    assert medicines[0].instructions == ["1-0-1"]
    assert medicines[0].confidence == 0.99
    assert medicines[0].evidence[0].source_block_indexes == [0, 1]


def test_similar_medicine_reference_is_not_guessed():
    page = build_page(
        [
            "Tab Fictionalmed 500 mg",
            "Tab Fictionalmed XR 500 mg",
            "Fictionalmed: 1-0-1",
        ]
    )
    result = extract_prescription_information([page])
    assert len(result.medicines) == 2
    assert all(not medicine.instructions for medicine in result.medicines)
    assert any(
        warning.field_name == "medicine_instruction_association"
        for warning in result.warnings
    )

def test_unique_explicit_reference_can_resolve_after_the_medicine_line():
    page = build_page(
        [
            "Fictional D: 1-0-1",
            "Tab Fictional D 10 mg",
        ]
    )
    result = extract_prescription_information([page])
    assert len(result.medicines) == 1
    assert result.medicines[0].instructions == ["1-0-1"]
    assert not any(
        warning.field_name == "medicine_instruction_association"
        for warning in result.warnings
    )

def test_instruction_is_not_carried_across_page_boundary():
    result = extract_prescription_information(
        [
            build_page(["Tab Fictional A 500 mg"]),
            build_page(["1-0-1 after food"]),
        ]
    )
    assert len(result.medicines) == 1
    assert result.medicines[0].instructions == []
    assert any(
        warning.field_name == "medicine_instruction_association"
        for warning in result.warnings
    )


def test_malformed_numeric_fragments_do_not_create_medicines_or_doses():
    result = extract_prescription_information(
        [
            build_page(
                [
                    "1--0",
                    "500 mg",
                    "Tab Fictional A 10 mg",
                    "0.5-0-0.5",
                ]
            )
        ]
    )
    assert len(result.medicines) == 1
    assert result.medicines[0].raw_text == "Tab Fictional A 10 mg"
    assert result.medicines[0].instructions == ["0.5-0-0.5"]


def build_page(
    lines: list[str],
    left_positions: list[float] | None = None,
):
    from app.schemas.ocr import OCRBlock, OCRPageResult

    blocks = []
    for index, text in enumerate(lines):
        top = float(index * 40)
        left = left_positions[index] if left_positions else 20.0
        blocks.append(
            OCRBlock(
                text=text,
                confidence=0.99,
                bounding_box=[
                    [left, top],
                    [left + 300, top],
                    [left + 300, top + 20],
                    [left, top + 20],
                ],
            )
        )
    return OCRPageResult(
        full_text="\n".join(lines),
        blocks=blocks,
    )
