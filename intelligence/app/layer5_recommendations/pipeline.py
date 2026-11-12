from __future__ import annotations

from typing import Optional

from app.layer4_medicine_intelligence.runtime.schemas import RuntimeMatchStatus
from .schemas import (
    CriterionScore,
    Layer4CandidateData,
    Layer4RecommendationInput,
    RankedMedicine,
    RecommendationResult,
    RecommendationStatus,
    RankingWeights,
)
from .scoring import (
    _latest_comparable,
    aggregate_weighted_score,
    score_brand_generic,
    score_ingredients,
    score_manufacturer_quality,
    score_price,
    score_safety,
)


class RecommendationPipeline:
    """
    Pure in-memory Layer 5 ranking engine.

    No Supabase client, repository, SQL, HTTP request or other retrieval
    operation is used here. All inputs must be supplied by Layer 4.
    """

    def __init__(self, weights: Optional[RankingWeights] = None):
        self.weights = weights or RankingWeights()

    def rank(self, layer4_data: Layer4RecommendationInput) -> RecommendationResult:
        source_data = layer4_data.selected_medicine
        if (
            layer4_data.match_status != RuntimeMatchStatus.MATCHED
            or source_data is None
        ):
            return RecommendationResult(
                status=RecommendationStatus.NOT_ELIGIBLE,
                source_medicine_id=None,
                source_medicine_name=None,
                ranking_weights=self.weights,
                explanation="Layer 5 requires a confirmed Layer 4 MATCHED result.",
                warnings=list(layer4_data.warnings) + [
                    "No alternatives were ranked because medicine identity is not confirmed."
                ],
            )

        source = source_data.medicine
        if not source.ingredients:
            return RecommendationResult(
                status=RecommendationStatus.REVIEW_REQUIRED,
                source_medicine_id=source.medicine_id,
                source_medicine_name=source.canonical_name,
                ranking_weights=self.weights,
                explanation="Layer 4 did not supply active ingredient details for the selected medicine.",
                warnings=["Layer 4 must supply complete ingredient details before ranking."],
            )

        if not layer4_data.alternative_candidates:
            return RecommendationResult(
                status=RecommendationStatus.NO_CANDIDATES,
                source_medicine_id=source.medicine_id,
                source_medicine_name=source.canonical_name,
                ranking_weights=self.weights,
                explanation="Layer 4 supplied no alternative candidates.",
                warnings=list(layer4_data.warnings),
            )

        source_price = _latest_comparable(source_data.prices)
        ranked: list[RankedMedicine] = []
        excluded: list[dict] = []

        for data in layer4_data.alternative_candidates:
            candidate = data.medicine
            ingredient_score, ingredient_text, ingredient_evidence = score_ingredients(source, candidate)
            if ingredient_score is None:
                excluded.append({
                    "medicine_id": str(candidate.medicine_id),
                    "medicine_name": candidate.canonical_name,
                    "reason": ingredient_text,
                })
                continue

            source_form = (source.dosage_form or "").strip().casefold()
            candidate_form = (candidate.dosage_form or "").strip().casefold()
            if not source_form or not candidate_form or source_form != candidate_form:
                excluded.append({
                    "medicine_id": str(candidate.medicine_id),
                    "medicine_name": candidate.canonical_name,
                    "reason": "Dosage form is missing or differs from the selected medicine.",
                })
                continue

            candidate_price = _latest_comparable(data.prices, source_price)
            price_score, price_text, price_evidence = score_price(candidate_price, source_price)
            safety_score, safety_text, safety_evidence, safety_warnings = score_safety(data)
            brand_score, brand_text, brand_evidence = score_brand_generic(data)
            quality_score, quality_text, quality_evidence = score_manufacturer_quality(data)

            criteria = {
                "ingredient_compatibility": CriterionScore(
                    ingredient_score, self.weights.ingredient_compatibility,
                    ingredient_score * self.weights.ingredient_compatibility,
                    ingredient_text, ingredient_evidence,
                ),
                "price_competitiveness": CriterionScore(
                    price_score, self.weights.price_competitiveness,
                    price_score * self.weights.price_competitiveness if price_score is not None else None,
                    price_text, price_evidence,
                ),
                "safety_evidence": CriterionScore(
                    safety_score, self.weights.safety_evidence,
                    safety_score * self.weights.safety_evidence if safety_score is not None else None,
                    safety_text, safety_evidence,
                ),
                "brand_generic": CriterionScore(
                    brand_score, self.weights.brand_generic,
                    brand_score * self.weights.brand_generic if brand_score is not None else None,
                    brand_text, brand_evidence,
                ),
                "manufacturer_quality": CriterionScore(
                    quality_score, self.weights.manufacturer_quality,
                    quality_score * self.weights.manufacturer_quality if quality_score is not None else None,
                    quality_text, quality_evidence,
                ),
            }
            overall = aggregate_weighted_score(criteria)
            reasons = [ingredient_text]
            if price_score is not None:
                reasons.append(price_text)
            warnings = list(safety_warnings)
            if price_score is None:
                warnings.append("Comparable price unavailable; remaining available criterion weights were normalized.")
            if safety_score is None:
                warnings.append("Safety evidence unavailable; missing information must not be interpreted as safe.")
            warnings.append("Ranking score is not a clinical suitability probability.")

            ranked.append(RankedMedicine(
                medicine_id=candidate.medicine_id,
                medicine_name=candidate.canonical_name,
                brand_name=candidate.brand_name,
                generic_name=candidate.generic_name,
                dosage_form=candidate.dosage_form,
                strength_value=candidate.strength_value,
                strength_unit=candidate.strength_unit,
                rank=0,
                overall_score=overall,
                criteria_scores=criteria,
                reasons=reasons,
                warnings=warnings,
                review_required=True,
            ))

        ranked.sort(key=lambda item: (-item.overall_score, item.medicine_name.casefold(), str(item.medicine_id)))
        for index, item in enumerate(ranked, start=1):
            item.rank = index

        status = RecommendationStatus.RANKED if ranked else RecommendationStatus.NO_CANDIDATES
        return RecommendationResult(
            status=status,
            source_medicine_id=source.medicine_id,
            source_medicine_name=source.canonical_name,
            ranking_weights=self.weights,
            ranked_medicines=ranked,
            excluded_candidates=excluded,
            explanation=f"Layer 5 ranked {len(ranked)} candidate(s) from the data supplied by Layer 4.",
            warnings=list(layer4_data.warnings) + [
                "Layer 5 performs no database queries or external data retrieval.",
                "Ingredient and dosage-form checks are catalogue matching gates, not proof of clinical interchangeability.",
                "Safety score measures evidence coverage, not patient-specific clinical safety.",
            ],
        )


def rank_layer4_data(
    layer4_data: Layer4RecommendationInput,
) -> RecommendationResult:
    return RecommendationPipeline().rank(layer4_data)
