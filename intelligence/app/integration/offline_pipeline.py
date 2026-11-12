from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.layer2_information_extraction.pipeline import extract_prescription_information
from app.layer3_medicine_understanding.pipeline import understand_medicine_entries
from app.layer4_medicine_intelligence.runtime.pipeline import MedicineIntelligencePipeline
from app.layer4_medicine_intelligence.runtime.schemas import CandidateIngredient, MedicineCandidate, MedicineMatchResult
from app.layer5_recommendations.pipeline import RecommendationPipeline
from app.layer5_recommendations.schemas import (
    Layer4CandidateData,
    Layer4RecommendationInput,
    RecommendationResult,
)
from app.schemas.medicine import MedicineUsageRecord
from app.schemas.ocr import OCRBlock, OCRPageResult
from app.schemas.prescription import PrescriptionRecord


PARACETAMOL_ID = UUID("10000000-0000-4000-8000-000000000001")
PARACETAMOL_ALT_ID = UUID("10000000-0000-4000-8000-000000000002")
PARACETAMOL_INGREDIENT_ID = UUID("20000000-0000-4000-8000-000000000001")


def _candidate(identifier: UUID, name: str, brand: str) -> MedicineCandidate:
    return MedicineCandidate(
        medicine_id=identifier,
        canonical_name=name,
        normalized_name="paracetamol",
        brand_name=brand,
        generic_name="Paracetamol",
        dosage_form="tablet",
        strength_value=500,
        strength_unit="mg",
        medicine_type="synthetic",
        prescription_required=None,
        ingredients=[
            CandidateIngredient(
                ingredient_id=PARACETAMOL_INGREDIENT_ID,
                ingredient_name="Paracetamol",
                normalized_name="paracetamol",
                strength_value=500,
                strength_unit="mg",
            )
        ],
    )


class InMemoryMedicineRepository:
    """Minimal deterministic catalogue implementing Layer 4's repository API."""

    def __init__(self) -> None:
        self.primary = _candidate(PARACETAMOL_ID, "Synthetic Paracetamol 500", "Synthetic Alpha")
        self.alternative = _candidate(PARACETAMOL_ALT_ID, "Synthetic Paracetamol Alternative", "Synthetic Beta")

    def _exact(self, value: str) -> list[MedicineCandidate]:
        return [self.primary] if value.strip().casefold() == "paracetamol" else []

    def find_by_normalized_name(self, value: str) -> list[MedicineCandidate]:
        return self._exact(value)

    def find_by_alias(self, value: str) -> list[MedicineCandidate]:
        return []

    def find_by_brand_name(self, value: str) -> list[MedicineCandidate]:
        return []

    def find_by_generic_name(self, value: str) -> list[MedicineCandidate]:
        return self._exact(value)

    def search_name_prefix(self, value: str) -> list[MedicineCandidate]:
        return self._exact(value)

    def enrich_with_ingredients(self, candidates: list[MedicineCandidate]) -> list[MedicineCandidate]:
        return candidates


@dataclass(frozen=True)
class OfflinePipelineResult:
    prescription: PrescriptionRecord
    medicines: list[MedicineUsageRecord]
    matches: list[MedicineMatchResult]
    recommendations: list[RecommendationResult]


def synthetic_ocr_pages() -> list[OCRPageResult]:
    lines = [
        "Dr. Synthetic Example",
        "Demo Health Centre Hospital",
        "Date: 06/09/2026",
        "Patient Name: Fictional Test",
        "Age: 30",
        "Gender: Other",
        "Rx",
        "Tab Paracetamol 500 mg",
        "1-0-1 after food for 3 days",
        "Tab Unknownium 10 mg",
        "Take as needed",
    ]
    blocks = [
        OCRBlock(
            text=line,
            confidence=0.99,
            bounding_box=[[0.0, index * 20.0], [500.0, index * 20.0], [500.0, index * 20.0 + 10.0], [0.0, index * 20.0 + 10.0]],
        )
        for index, line in enumerate(lines)
    ]
    return [OCRPageResult(full_text="\n".join(lines), blocks=blocks)]


def run_offline_pipeline(
    pages: list[OCRPageResult],
    repository: InMemoryMedicineRepository,
) -> OfflinePipelineResult:
    prescription = extract_prescription_information(pages)
    medicines = understand_medicine_entries(prescription.medicines)
    matcher = MedicineIntelligencePipeline(repository=repository)
    matches = matcher.match_medicines(medicines)

    recommendations: list[RecommendationResult] = []
    ranker = RecommendationPipeline()
    for match in matches:
        selected = match.selected_candidate
        if selected is None:
            layer5_input = Layer4RecommendationInput(
                match_status=match.match_status,
                selected_medicine=None,
                warnings=list(match.warnings),
            )
        else:
            layer5_input = Layer4RecommendationInput(
                match_status=match.match_status,
                selected_medicine=Layer4CandidateData(medicine=selected),
                alternative_candidates=[Layer4CandidateData(medicine=repository.alternative)],
                warnings=list(match.warnings),
            )
        recommendations.append(ranker.rank(layer5_input))

    return OfflinePipelineResult(prescription, medicines, matches, recommendations)
