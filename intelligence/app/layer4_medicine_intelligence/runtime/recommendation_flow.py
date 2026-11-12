from __future__ import annotations

from app.layer4_medicine_intelligence.runtime.pipeline import MedicineIntelligencePipeline
from app.layer4_medicine_intelligence.runtime.recommendation_data_provider import (
    Layer4RecommendationDataProvider,
)
from app.layer5_recommendations.pipeline import RecommendationPipeline
from app.schemas.medicine import MedicineUsageRecord


def run_medicine_intelligence(
    medicine: MedicineUsageRecord,
):
    """
    Run Layer 4 identity matching, Layer 4 recommendation-data enrichment,
    then pure Layer 5 ranking.

    All database access is performed inside Layer 4.
    """
    match_result = MedicineIntelligencePipeline().match_medicine(medicine)
    layer4_input = Layer4RecommendationDataProvider().build_input(match_result)
    recommendation_result = RecommendationPipeline().rank(layer4_input)
    return match_result, recommendation_result
