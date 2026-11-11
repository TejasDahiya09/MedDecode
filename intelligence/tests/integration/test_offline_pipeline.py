from app.integration.offline_pipeline import (
    InMemoryMedicineRepository,
    run_offline_pipeline,
    synthetic_ocr_pages,
)
from app.layer4_medicine_intelligence.runtime.schemas import RuntimeMatchStatus
from app.layer5_recommendations.schemas import RecommendationStatus
from app.schemas.ocr import OCRBlock, OCRPageResult


def test_real_layers_extract_understand_match_and_rank_synthetic_data() -> None:
    result = run_offline_pipeline(synthetic_ocr_pages(), InMemoryMedicineRepository())

    assert result.prescription.prescription_date is not None
    assert result.prescription.prescription_date.value == "2026-09-06"
    assert result.prescription.doctor.name == "Synthetic Example"
    assert result.prescription.facility.name == "Demo Health Centre Hospital"
    assert result.prescription.patient.name == "Fictional Test"
    assert len(result.medicines) == 2

    first, second = result.medicines
    assert first.normalized_medicine_name == "paracetamol"
    assert first.strength.value == 500
    assert first.dosage_form == "tablet"
    assert first.dosage_schedule.units_per_day == 2
    assert first.timing == "after_food"
    assert first.duration.value == 3
    assert second.normalized_medicine_name == "unknownium"

    assert result.matches[0].match_status is RuntimeMatchStatus.MATCHED
    assert result.matches[1].match_status is RuntimeMatchStatus.UNMATCHED
    assert result.recommendations[0].status is RecommendationStatus.RANKED
    assert len(result.recommendations[0].ranked_medicines) == 1
    assert result.recommendations[1].status is RecommendationStatus.NOT_ELIGIBLE


def test_repository_is_explicitly_injected() -> None:
    class EmptyRepository(InMemoryMedicineRepository):
        def _exact(self, value: str):
            return []

    result = run_offline_pipeline(synthetic_ocr_pages(), EmptyRepository())
    assert all(match.match_status is RuntimeMatchStatus.UNMATCHED for match in result.matches)


def test_missing_prescription_and_patient_fields_remain_missing() -> None:
    lines = ["Rx", "Tab Unknownium 10 mg", "Take as needed"]
    page = OCRPageResult(
        full_text="\n".join(lines),
        blocks=[
            OCRBlock(
                text=line,
                confidence=0.99,
                bounding_box=[[0.0, index * 20.0], [500.0, index * 20.0], [500.0, index * 20.0 + 10.0], [0.0, index * 20.0 + 10.0]],
            )
            for index, line in enumerate(lines)
        ],
    )

    result = run_offline_pipeline([page], InMemoryMedicineRepository())

    assert result.prescription.prescription_date is None
    assert result.prescription.doctor.name is None
    assert result.prescription.facility.name is None
    assert result.prescription.patient.name is None
    assert result.matches[0].match_status is RuntimeMatchStatus.UNMATCHED


def test_real_matcher_reports_ambiguous_equal_candidates() -> None:
    class AmbiguousRepository(InMemoryMedicineRepository):
        def _exact(self, value: str):
            if value.strip().casefold() != "paracetamol":
                return []
            return [self.primary, self.alternative]

    result = run_offline_pipeline(synthetic_ocr_pages(), AmbiguousRepository())

    assert result.matches[0].match_status is RuntimeMatchStatus.AMBIGUOUS
