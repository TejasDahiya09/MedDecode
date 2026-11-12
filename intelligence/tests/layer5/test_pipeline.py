from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from app.layer4_medicine_intelligence.runtime.schemas import (
    CandidateIngredient,
    MedicineCandidate,
    RuntimeMatchStatus,
)
from app.layer5_recommendations.pipeline import RecommendationPipeline
from app.layer5_recommendations.schemas import (
    Layer4CandidateData,
    Layer4RecommendationInput,
    ManufacturerEvidence,
    PriceObservation,
    SafetyEvidence,
    RecommendationStatus,
)


def candidate(name, ingredient_id, price):
    med = MedicineCandidate(
        medicine_id=uuid4(),
        canonical_name=name,
        normalized_name=name.casefold(),
        brand_name=name if "Brand" in name else None,
        generic_name="Example ingredient",
        dosage_form="tablet",
        strength_value=500,
        strength_unit="mg",
        ingredients=[
            CandidateIngredient(
                ingredient_id=ingredient_id,
                ingredient_name="Example ingredient",
                normalized_name="example ingredient",
                strength_value=500,
                strength_unit="mg",
            )
        ],
    )
    prices = []
    if price is not None:
        prices = [PriceObservation(
            medicine_id=med.medicine_id,
            price=Decimal(str(price)),
            currency="INR",
            country="India",
            region="Haryana",
            quantity=Decimal("10"),
            package_description="10 tablets",
            source="verified test source",
            recorded_at=datetime.now(timezone.utc),
        )]
    return Layer4CandidateData(
        medicine=med,
        prices=prices,
        safety=SafetyEvidence(precautions=["Use as directed"]),
        manufacturer=ManufacturerEvidence(
            manufacturer_name="Test manufacturer",
            evidence_sources=["Test registry"]
        ),
    )


def test_pipeline_ranks_candidates_from_layer4_input_only():
    ingredient_id = uuid4()
    source = candidate("Reference Brand", ingredient_id, 100)
    cheaper = candidate("Generic Option", ingredient_id, 50)
    data = Layer4RecommendationInput(
        match_status=RuntimeMatchStatus.MATCHED,
        selected_medicine=source,
        alternative_candidates=[cheaper],
    )
    result = RecommendationPipeline().rank(data)
    assert result.status == RecommendationStatus.RANKED
    assert len(result.ranked_medicines) == 1
    assert result.ranked_medicines[0].medicine_id == cheaper.medicine.medicine_id
    assert result.ranked_medicines[0].criteria_scores["price_competitiveness"].score == 100.0


def test_non_matched_layer4_result_is_rejected():
    result = RecommendationPipeline().rank(Layer4RecommendationInput(
        match_status=RuntimeMatchStatus.PROBABLE_MATCH,
        selected_medicine=None,
    ))
    assert result.status == RecommendationStatus.NOT_ELIGIBLE


def test_different_ingredient_is_excluded():
    source = candidate("Source", uuid4(), 100)
    other = candidate("Other", uuid4(), 50)
    result = RecommendationPipeline().rank(Layer4RecommendationInput(
        match_status=RuntimeMatchStatus.MATCHED,
        selected_medicine=source,
        alternative_candidates=[other],
    ))
    assert result.status == RecommendationStatus.NO_CANDIDATES
    assert len(result.excluded_candidates) == 1


def test_missing_price_does_not_exclude_candidate():
    ingredient_id = uuid4()
    source = candidate("Source", ingredient_id, None)
    other = candidate("Other", ingredient_id, None)
    result = RecommendationPipeline().rank(Layer4RecommendationInput(
        match_status=RuntimeMatchStatus.MATCHED,
        selected_medicine=source,
        alternative_candidates=[other],
    ))
    assert result.status == RecommendationStatus.RANKED
    assert result.ranked_medicines[0].criteria_scores["price_competitiveness"].score is None
