from __future__ import annotations

import argparse
import collections
import json
import subprocess
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
sys.path.insert(0, str(Path(__file__).parent))

from app.layer2_information_extraction.document_context import (
    PrescriptionDocumentContext,
)
from app.layer2_information_extraction.medicine_extractor import (
    extract_raw_medicines,
)
from app.layer3_medicine_understanding.pipeline import (
    understand_medicine_entries,
)
from multi_medicine_fixtures import build_fictional_prescriptions


def _load_git_module(
    module_name: str,
    revision: str,
    repository_path: str,
) -> types.ModuleType:
    source = subprocess.check_output(
        ["git", "show", f"{revision}:{repository_path}"],
        text=True,
    )
    module = types.ModuleType(module_name)
    module.__file__ = module_name
    sys.modules[module_name] = module
    exec(compile(source, module_name, "exec"), module.__dict__)
    return module


def _evaluate(
    *,
    extractor,
    context_factory,
    association_warnings_supported: bool,
) -> dict[str, int | float]:
    fixtures = build_fictional_prescriptions()
    expected_entries = predicted_entries = entry_matches = 0
    expected_instructions = matched_instructions = leakage = 0
    strength_matches = duration_matches = frequency_matches = 0
    unsafe_numeric_substitutions = 0
    expected_field_count = 0
    ambiguity_cases = ambiguity_preserved = 0

    for fixture in fixtures:
        expected = list(fixture.medicines)
        context = context_factory(fixture.page)
        warnings = []
        if association_warnings_supported:
            actual = extractor(context, association_warnings=warnings)
        else:
            actual = extractor(context)
        expected_entries += len(expected)
        predicted_entries += len(actual)
        expected_counts = collections.Counter(item.raw_text for item in expected)
        actual_counts = collections.Counter(item.raw_text for item in actual)
        entry_matches += sum((expected_counts & actual_counts).values())
        actual_by_text: dict[str, list] = collections.defaultdict(list)
        for item in actual:
            actual_by_text[item.raw_text].append(item)
        understood = {
            item.raw_medicine_text: item
            for item in understand_medicine_entries(actual)
        }

        for item in expected:
            candidates = actual_by_text.get(item.raw_text, [])
            structured = understood.get(item.raw_text)
            expected_field_count += 1
            strength_matches += int(
                structured is not None
                and structured.strength.value == item.strength_value
                and structured.strength.unit == item.strength_unit
            )
            unsafe_numeric_substitutions += int(
                structured is not None
                and structured.strength.value is not None
                and (
                    structured.strength.value != item.strength_value
                    or structured.strength.unit != item.strength_unit
                )
            )
            duration_matches += int(
                structured is not None
                and (
                    (
                        structured.duration.value == item.duration_days
                        and structured.duration.unit == "days"
                    )
                    if item.duration_days is not None
                    else structured.duration.value is None
                )
            )
            frequency_matches += int(
                structured is not None
                and structured.dosage_schedule.raw_pattern == item.schedule
            )
            if item.instructions:
                expected_instructions += len(item.instructions)
                matched_instructions += sum(
                    all(instruction in candidate.instructions for instruction in item.instructions)
                    for candidate in candidates
                ) * len(item.instructions)
            leakage += sum(
                instruction not in item.instructions
                for candidate in candidates
                for instruction in candidate.instructions
            )
            if item.ambiguous_instruction is not None:
                ambiguity_cases += 1
                ambiguity_preserved += int(
                    all(
                        item.ambiguous_instruction not in candidate.instructions
                        for candidate in candidates
                    )
                    and any(
                        item.ambiguous_instruction in warning.message
                        for warning in warnings
                    )
                )

    precision = entry_matches / predicted_entries if predicted_entries else 0.0
    recall = entry_matches / expected_entries if expected_entries else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "prescription_count": len(fixtures),
        "expected_entry_count": expected_entries,
        "predicted_entry_count": predicted_entries,
        "entry_matches": entry_matches,
        "entry_precision": precision,
        "entry_recall": recall,
        "entry_f1": f1,
        "expected_instruction_count": expected_instructions,
        "correct_instruction_associations": matched_instructions,
        "instruction_association_accuracy": (
            matched_instructions / expected_instructions if expected_instructions else 0.0
        ),
        "cross_medicine_leakage_count": leakage,
        "strength_matches": strength_matches,
        "strength_association_accuracy": strength_matches / expected_field_count,
        "unsafe_numeric_substitutions": unsafe_numeric_substitutions,
        "duration_matches": duration_matches,
        "duration_association_accuracy": duration_matches / expected_field_count,
        "frequency_matches": frequency_matches,
        "frequency_association_accuracy": frequency_matches / expected_field_count,
        "ambiguity_cases": ambiguity_cases,
        "ambiguity_preserved": ambiguity_preserved,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--baseline",
        help="Evaluate a prior git revision instead of the current implementation.",
    )
    args = parser.parse_args()

    if args.baseline:
        context_module = _load_git_module(
            "app.layer2_information_extraction.benchmark_baseline_context",
            args.baseline,
            "intelligence/app/layer2_information_extraction/document_context.py",
        )
        extractor_module = _load_git_module(
            "app.layer2_information_extraction.benchmark_baseline_extractor",
            args.baseline,
            "intelligence/app/layer2_information_extraction/medicine_extractor.py",
        )
        result = _evaluate(
            extractor=extractor_module.extract_raw_medicines,
            context_factory=lambda page: context_module.PrescriptionDocumentContext.from_ocr_pages(
                [page]
            ),
            association_warnings_supported=False,
        )
    else:
        result = _evaluate(
            extractor=extract_raw_medicines,
            context_factory=lambda page: PrescriptionDocumentContext.from_ocr_pages([page]),
            association_warnings_supported=True,
        )
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
