from pathlib import Path

import pytest

from app.evaluation.ocr_benchmark import (character_error_rate, evaluate_observations,
    extraction_metrics, load_manifest, main, normalize_observation, wilson_interval, word_error_rate)


def test_normalization_preserves_clinically_important_decimal_unit_and_punctuation():
    assert normalize_observation("  TAB 0.5 mg, OD ") == "tab 0.5 mg, od"
    assert normalize_observation("0.5 mg") != normalize_observation("5 mg")
    assert normalize_observation("5 mg") != normalize_observation("5 mcg")


def test_cer_and_wer_are_reproducible():
    assert character_error_rate("abc", "adc") == pytest.approx(1 / 3)
    assert word_error_rate("one tablet daily", "one capsule daily") == pytest.approx(1 / 3)
    assert character_error_rate("", "x") == 1.0


def test_extraction_metrics_count_unsafe_substitution():
    result = extraction_metrics(["Examplemed"], ["Examplesed"])
    assert result == {"precision": 0.0, "recall": 0.0, "f1": 0.0,
                      "false_positive_count": 1, "unsafe_medicine_substitution_count": 1}


def test_manifest_excludes_missing_handwriting_assets_from_metrics():
    path = Path(__file__).resolve().parents[2] / "data" / "ocr_benchmark" / "phase2_1_manifest.json"
    samples = load_manifest(path)
    assert len(samples) == 12
    assert sum(sample.asset_status == "available" for sample in samples) == 1
    result = evaluate_observations(samples, {"fictional-clean-print": {
        "transcription": "Examplemed 10 mg once daily for 3 days", "medicine_names": ["Examplemed"],
        "strength": "10 mg", "dosage_form": None, "frequency": "once daily", "duration": "3 days", "latency_ms": 10}})
    assert result["sample_count"] == 1
    assert result["character_error_rate"] == 0
    assert result["unsafe_medicine_substitution_count"] == 0


def test_wilson_interval_is_bounded_and_absent_without_samples():
    assert wilson_interval(0, 0) is None
    low, high = wilson_interval(5, 10)
    assert 0 <= low < 0.5 < high <= 1


def test_machine_readable_cli_rejects_invalid_input(tmp_path, capsys):
    bad = tmp_path / "bad.json"
    bad.write_text("[]", encoding="utf-8")
    assert main(["--manifest", str(bad), "--observations", str(bad)]) == 1
    assert '"status":"invalid_benchmark_input"' in capsys.readouterr().out
