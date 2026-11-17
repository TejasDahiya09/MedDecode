from uuid import UUID

from app.integration.contract_v1_mapper import map_contract_v1
from app.integration.offline_pipeline import (
    InMemoryMedicineRepository,
    run_offline_pipeline,
    synthetic_ocr_pages,
)
from app.layer4_medicine_intelligence.runtime.schemas import RuntimeMatchStatus
from app.layer4_medicine_intelligence.runtime.schemas import CandidateIngredient, MedicineCandidate
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


def test_multiple_medicines_preserve_matched_ambiguous_and_unmatched_outcomes_in_contract_output() -> None:
    def candidate(identifier: str, name: str, strength: float, ingredients: list[tuple[str, float]], dosage_form: str = "tablet") -> MedicineCandidate:
        return MedicineCandidate(
            medicine_id=UUID(identifier), canonical_name=name, normalized_name=name.casefold(),
            dosage_form=dosage_form, strength_value=strength, strength_unit="mg",
            ingredients=[
                CandidateIngredient(
                    UUID(f"30000000-0000-4000-8000-{index:012d}"), ingredient, ingredient.casefold(), value, "mg"
                )
                for index, (ingredient, value) in enumerate(ingredients, start=1)
            ],
        )

    paracetamol = candidate("10000000-0000-4000-8000-000000000101", "paracetamol", 500, [("Paracetamol", 500)])
    amoxicillin = candidate("10000000-0000-4000-8000-000000000102", "amoxicillin", 500, [("Amoxicillin", 500)], "capsule")
    fdc_a = candidate("10000000-0000-4000-8000-000000000103", "amoxicillin + clavulanic acid", 500, [("Amoxicillin", 500), ("Clavulanic acid", 125)])
    fdc_b = candidate("10000000-0000-4000-8000-000000000104", "amoxicillin + clavulanic acid", 500, [("Amoxicillin", 500), ("Clavulanic acid", 125)])

    class EvidenceRepository(InMemoryMedicineRepository):
        alternative = None
        candidates = {
            "paracetamol": [paracetamol],
            "amoxicillin": [amoxicillin],
            "amoxicillin + clavulanic acid": [fdc_a, fdc_b],
        }

        def _exact(self, value: str):
            return self.candidates.get(value.strip().casefold(), [])

    lines = [
        "Rx", "Tab Paracetamol 500 mg", "1-0-1 after food",
        "Cap Amoxicillin 500 mg", "1-1-1 for 5 days",
        "Tab Amoxicillin 500 mg + Clavulanic acid 125 mg", "1-0-1 for 5 days",
        "Tab Unknownium 10 mg", "Take as needed",
    ]
    page = OCRPageResult(
        full_text="\n".join(lines),
        blocks=[OCRBlock(text=line, confidence=0.99, bounding_box=[[0, index * 20], [100, index * 20], [100, index * 20 + 10], [0, index * 20 + 10]]) for index, line in enumerate(lines)],
    )
    result = run_offline_pipeline([page], EvidenceRepository())

    assert [match.match_status for match in result.matches] == [
        RuntimeMatchStatus.MATCHED, RuntimeMatchStatus.MATCHED,
        RuntimeMatchStatus.AMBIGUOUS, RuntimeMatchStatus.UNMATCHED,
    ]
    assert [(item.name, item.value) for item in result.medicines[2].ingredient_strengths] == [
        ("Amoxicillin", 500.0), ("Clavulanic acid", 125.0),
    ]
    mapped = map_contract_v1(
        {"job_id": "11111111-1111-4111-8111-111111111111", "prescription_id": "22222222-2222-4222-8222-222222222222"},
        result,
        source_mode="local_pdf_official_catalogue",
    )
    assert mapped["status"] == "completed_with_warnings"
    assert [item["medicine_match"]["status"] for item in mapped["medicines"]] == ["matched", "matched", "ambiguous", "unmatched"]
    assert mapped["medicines"][2]["alternatives"] == []
    assert mapped["medicines"][3]["medicine_match"]["ingredients"] == []
    assert mapped["warnings"][0]["code"] == "LOCAL_PDF_OFFICIAL_CATALOGUE"
