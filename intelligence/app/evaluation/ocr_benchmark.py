"""Reproducible OCR and medicine-field metrics without clinical claims."""
from __future__ import annotations

import json
import math
import re
import unicodedata
import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


def normalize_observation(value: str) -> str:
    """Normalize Unicode/case/whitespace only; preserve punctuation, decimals and units."""
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def _distance(expected: list[str], observed: list[str]) -> int:
    previous = list(range(len(observed) + 1))
    for row, left in enumerate(expected, start=1):
        current = [row]
        for column, right in enumerate(observed, start=1):
            current.append(min(current[-1] + 1, previous[column] + 1,
                               previous[column - 1] + (left != right)))
        previous = current
    return previous[-1]


def character_error_rate(expected: str, observed: str) -> float:
    left, right = list(normalize_observation(expected)), list(normalize_observation(observed))
    return _distance(left, right) / max(1, len(left))


def word_error_rate(expected: str, observed: str) -> float:
    left, right = normalize_observation(expected).split(), normalize_observation(observed).split()
    return _distance(left, right) / max(1, len(left))


def exact_accuracy(expected: Iterable[str | None], observed: Iterable[str | None]) -> float:
    pairs = list(zip(expected, observed, strict=True))
    return sum(normalize_observation(a or "") == normalize_observation(b or "") for a, b in pairs) / max(1, len(pairs))


def extraction_metrics(expected: Iterable[str], observed: Iterable[str]) -> dict[str, float | int]:
    left = {normalize_observation(value) for value in expected if value.strip()}
    right = {normalize_observation(value) for value in observed if value.strip()}
    true_positive, false_positive, false_negative = len(left & right), len(right - left), len(left - right)
    precision = true_positive / max(1, true_positive + false_positive)
    recall = true_positive / max(1, true_positive + false_negative)
    f1 = 2 * precision * recall / max(1e-12, precision + recall)
    return {"precision": precision, "recall": recall, "f1": f1,
            "false_positive_count": false_positive,
            "unsafe_medicine_substitution_count": false_positive if left else 0}


def wilson_interval(successes: int, total: int, z: float = 1.96) -> tuple[float, float] | None:
    if total <= 0:
        return None
    proportion = successes / total
    denominator = 1 + z * z / total
    center = (proportion + z * z / (2 * total)) / denominator
    margin = z * math.sqrt(proportion * (1 - proportion) / total + z * z / (4 * total * total)) / denominator
    return max(0.0, center - margin), min(1.0, center + margin)


@dataclass(frozen=True)
class BenchmarkSample:
    identifier: str
    transcription: str
    medicine_names: tuple[str, ...]
    strength: str | None
    dosage_form: str | None
    frequency: str | None
    duration: str | None
    page_number: int
    region: tuple[float, float, float, float] | None
    document_type: str
    writing_style: str
    quality_category: str
    asset_status: str


def load_manifest(path: Path) -> tuple[BenchmarkSample, ...]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("schema_version") != "1.0" or not isinstance(raw.get("samples"), list):
        raise ValueError("Benchmark manifest is invalid.")
    samples: list[BenchmarkSample] = []
    identifiers: set[str] = set()
    for value in raw["samples"]:
        identifier = value.get("id")
        if not isinstance(identifier, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,63}", identifier) or identifier in identifiers:
            raise ValueError("Benchmark sample identifier is invalid.")
        identifiers.add(identifier)
        region = value.get("region")
        if region is not None and (not isinstance(region, list) or len(region) != 4 or not all(isinstance(item, (int, float)) for item in region)):
            raise ValueError("Benchmark region is invalid.")
        transcription, medicines = value.get("ground_truth_transcription"), value.get("ground_truth_medicine_names")
        if not isinstance(transcription, str) or not isinstance(medicines, list) or not all(isinstance(item, str) for item in medicines):
            raise ValueError("Benchmark ground truth is invalid.")
        samples.append(BenchmarkSample(identifier, transcription, tuple(medicines), value.get("strength"),
            value.get("dosage_form"), value.get("frequency"), value.get("duration"), int(value.get("page_number", 1)),
            tuple(float(item) for item in region) if region is not None else None,
            str(value.get("document_type", "unknown")), str(value.get("writing_style", "unknown")),
            str(value.get("quality_category", "unknown")), str(value.get("asset_status", "missing"))))
    return tuple(samples)


def evaluate_observations(samples: Iterable[BenchmarkSample], observations: dict[str, dict[str, Any]]) -> dict[str, Any]:
    evaluated = [sample for sample in samples if sample.identifier in observations and sample.asset_status == "available"]
    if not evaluated:
        return {"sample_count": 0, "status": "no_evaluable_samples"}
    cer, wer, exact, latency = [], [], [], []
    medicine_expected: list[str] = []
    medicine_observed: list[str] = []
    fields = ("strength", "dosage_form", "frequency", "duration")
    field_expected: dict[str, list[str | None]] = {key: [] for key in fields}
    field_observed: dict[str, list[str | None]] = {key: [] for key in fields}
    for sample in evaluated:
        observation = observations[sample.identifier]
        transcription = str(observation.get("transcription", ""))
        cer.append(character_error_rate(sample.transcription, transcription))
        wer.append(word_error_rate(sample.transcription, transcription))
        exact.append(normalize_observation(sample.transcription) == normalize_observation(transcription))
        latency.append(float(observation.get("latency_ms", 0.0)))
        medicine_expected.extend(sample.medicine_names)
        medicine_observed.extend(str(value) for value in observation.get("medicine_names", []))
        for field in fields:
            field_expected[field].append(getattr(sample, field))
            field_observed[field].append(observation.get(field))
    successes = sum(exact)
    return {"status": "evaluated", "sample_count": len(evaluated),
        "character_error_rate": sum(cer) / len(cer), "word_error_rate": sum(wer) / len(wer),
        "raw_exact_match_accuracy": successes / len(exact),
        "raw_exact_match_wilson_95": wilson_interval(successes, len(exact)),
        "medicine_name_exact_match_accuracy": exact_accuracy(medicine_expected, medicine_observed)
            if len(medicine_expected) == len(medicine_observed) else 0.0,
        **{f"{field}_accuracy": exact_accuracy(field_expected[field], field_observed[field]) for field in fields},
        **extraction_metrics(medicine_expected, medicine_observed),
        "average_latency_ms": sum(latency) / len(latency)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--observations", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        observations = json.loads(args.observations.read_text(encoding="utf-8"))
        if not isinstance(observations, dict):
            raise ValueError("Observations must be an object.")
        result = evaluate_observations(load_manifest(args.manifest), observations)
    except (OSError, ValueError, json.JSONDecodeError):
        result = {"status": "invalid_benchmark_input"}
    print(json.dumps(result, separators=(",", ":"), allow_nan=False))
    return 0 if result.get("status") == "evaluated" else 1


if __name__ == "__main__":
    raise SystemExit(main())
