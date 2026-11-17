from pathlib import Path

from tests.layer1.ocr_accuracy_fixtures import build_ocr_accuracy_fixtures
from tests.layer1.run_ocr_preprocessing_benchmark import (
    _critical_substitutions,
    _field_metrics,
)


def test_fictional_benchmark_fixtures_cover_formats_and_quality_cases(tmp_path: Path):
    fixtures = build_ocr_accuracy_fixtures(tmp_path)
    by_id = {fixture.identifier: fixture for fixture in fixtures}

    assert len(fixtures) == 14
    assert all(fixture.path.is_file() for fixture in fixtures)
    assert by_id["two_page_searchable_pdf"].document_type == "searchable_pdf"
    assert len(by_id["two_page_searchable_pdf"].expected_pages) == 2
    assert by_id["two_page_scanned_pdf"].document_type == "scanned_pdf"
    assert len(by_id["two_page_scanned_pdf"].expected_pages) == 2
    assert by_id["mixed_two_page_pdf"].document_type == "mixed_pdf"
    assert by_id["synthetic_handwriting_like"].writing_style == "synthetic_handwriting_like"
    assert by_id["exif_rotated_jpeg"].path.suffix == ".jpg"
    assert by_id["numeric_adversarial_sheet"].critical_pairs


def test_critical_substitution_count_uses_token_boundaries(tmp_path: Path):
    fixture = build_ocr_accuracy_fixtures(tmp_path)
    adversarial = next(item for item in fixture if item.identifier == "numeric_adversarial_sheet")
    observations = [{"text": "\n".join(adversarial.expected_pages)}]

    assert _critical_substitutions(adversarial, observations, [0]) == 0

    observations[0]["text"] = observations[0]["text"].replace(
        "FictionalK for 5 days",
        "FictionalK for 15 days",
    )
    assert _critical_substitutions(adversarial, observations, [0]) >= 1


def test_mixed_pdf_field_scoring_counts_only_expected_fields_on_ocr_pages(tmp_path: Path):
    fixtures = build_ocr_accuracy_fixtures(tmp_path)
    mixed = next(item for item in fixtures if item.document_type == "mixed_pdf")
    observations = [
        {"text": mixed.expected_pages[0]},
        {"text": mixed.expected_pages[1]},
    ]

    scores = _field_metrics(mixed, observations, [1])

    assert scores["medicine_names"] == {
        "correct": 1,
        "total": 1,
        "accuracy": 1.0,
    }
    assert scores["units"] == {
        "correct": 1,
        "total": 1,
        "accuracy": 1.0,
    }
