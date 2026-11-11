from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from app.layer4_medicine_intelligence.runtime.schemas import MedicineCandidate
from .schemas import (
    CriterionScore,
    Layer4CandidateData,
    PriceObservation,
    RankingWeights,
)


def _normalise_unit(unit: Optional[str]) -> Optional[str]:
    if not unit:
        return None
    value = unit.strip().casefold().replace("μ", "µ")
    return {
        "mcg": "µg", "ug": "µg", "µg": "µg",
        "milligram": "mg", "milligrams": "mg",
        "gram": "g", "grams": "g",
        "milliliter": "ml", "millilitre": "ml",
        "milliliters": "ml", "millilitres": "ml",
        "units": "unit",
    }.get(value, value)


def _unit_price(observation: PriceObservation) -> Optional[Decimal]:
    if observation.price <= 0 or observation.quantity is None or observation.quantity <= 0:
        return None
    return observation.price / observation.quantity


def _latest_comparable(
    observations: list[PriceObservation],
    reference: Optional[PriceObservation] = None,
) -> Optional[PriceObservation]:
    valid = [item for item in observations if _unit_price(item) is not None]
    if reference is not None:
        valid = [
            item for item in valid
            if item.currency.upper() == reference.currency.upper()
            and item.country == reference.country
            and item.region == reference.region
        ]
    if not valid:
        return None
    valid.sort(
        key=lambda item: (
            item.recorded_at is not None,
            item.recorded_at or datetime.min.replace(tzinfo=timezone.utc),
        ),
        reverse=True,
    )
    return valid[0]


def score_price(
    candidate: Optional[PriceObservation],
    reference: Optional[PriceObservation],
    max_age_days: int = 365,
) -> tuple[Optional[float], str, list[str]]:
    if candidate is None or reference is None:
        return None, "Comparable price evidence is unavailable.", []
    if (
        candidate.currency.upper() != reference.currency.upper()
        or candidate.country != reference.country
        or candidate.region != reference.region
    ):
        return None, "Price currency or geography differs.", []
    candidate_unit = _unit_price(candidate)
    reference_unit = _unit_price(reference)
    if candidate_unit is None or reference_unit is None:
        return None, "Comparable package quantity is unavailable.", []

    date_warning = []
    now = datetime.now(timezone.utc)
    for item in (candidate, reference):
        if item.recorded_at is None:
            date_warning.append(
                "The current medicine_prices ingestion contract has no observed-at timestamp; price freshness cannot be verified."
            )
            continue
        timestamp = item.recorded_at
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        age = (now - timestamp.astimezone(timezone.utc)).days
        if age < 0 or age > max_age_days:
            return None, "Price observation is stale or has an invalid future date.", []

    # Relative unit price score: candidate at or below reference = 100.
    # More expensive candidates receive a proportionally lower score.
    score = min(100.0, float(reference_unit / candidate_unit * Decimal("100")))
    return round(score, 2), "Compared dated unit prices in the same currency and geography.", [
        f"Candidate unit price: {candidate_unit} {candidate.currency.upper()}",
        f"Reference unit price: {reference_unit} {reference.currency.upper()}",
        f"Candidate price source: {candidate.source or 'not supplied'}",
        f"Candidate price date: {candidate.recorded_at.isoformat() if candidate.recorded_at else 'not supplied'}",
    ] + date_warning


def score_ingredients(
    source: MedicineCandidate,
    candidate: MedicineCandidate,
) -> tuple[Optional[float], str, list[str]]:
    source_items = {item.ingredient_id: item for item in source.ingredients}
    candidate_items = {item.ingredient_id: item for item in candidate.ingredients}
    if not source_items or not candidate_items:
        return None, "Active ingredient data is incomplete.", []
    if set(source_items) != set(candidate_items):
        return None, "Active ingredient composition differs.", []

    evidence = ["Exact active ingredient ID composition matches."]
    for ingredient_id, source_item in source_items.items():
        other = candidate_items[ingredient_id]
        if (
            source_item.strength_value is None or other.strength_value is None
            or not source_item.strength_unit or not other.strength_unit
        ):
            return None, "Per-ingredient strength data is incomplete.", evidence
        if (
            source_item.strength_value != other.strength_value
            or _normalise_unit(source_item.strength_unit) != _normalise_unit(other.strength_unit)
        ):
            return None, "Per-ingredient strength differs.", evidence
    return 100.0, "Exact ingredient composition and per-ingredient strengths match.", evidence + [
        "Per-ingredient strengths match."
    ]


def score_safety(data: Layer4CandidateData) -> tuple[Optional[float], str, list[str], list[str]]:
    safety = data.safety
    categories = [
        bool(safety.contraindications),
        bool(safety.precautions),
        bool(safety.side_effects),
        bool(safety.interactions),
    ]
    count = sum(categories)
    evidence = (
        [f"Contraindication: {x}" for x in safety.contraindications]
        + [f"Precaution: {x}" for x in safety.precautions]
        + [f"Side effect: {x}" for x in safety.side_effects]
        + [f"Interaction: {x}" for x in safety.interactions]
        + [f"Safety source: {x}" for x in safety.evidence_sources]
    )
    warnings = []
    if safety.contraindications or safety.interactions:
        warnings.append("Potential contraindication or interaction evidence supplied; professional review is required.")
    if count == 0:
        return None, "No safety evidence supplied; absence of data is not evidence of safety.", evidence, [
            "Safety evidence unavailable."
        ]
    return round(count / 4 * 100, 2), (
        "Score represents completeness of supplied safety evidence categories, not clinical safety."
    ), evidence, warnings


def score_brand_generic(data: Layer4CandidateData) -> tuple[Optional[float], str, list[str]]:
    medicine = data.medicine
    if medicine.generic_name:
        return 100.0, "Generic identity is recorded; this does not imply superior quality.", [
            f"Generic name: {medicine.generic_name}"
        ]
    if medicine.brand_name:
        return 70.0, "Brand identity is recorded; no user preference was supplied.", [
            f"Brand name: {medicine.brand_name}"
        ]
    return None, "Brand/generic information is unavailable.", []


def score_manufacturer_quality(data: Layer4CandidateData) -> tuple[Optional[float], str, list[str]]:
    manufacturer = data.manufacturer
    evidence = list(manufacturer.evidence_sources)
    if manufacturer.manufacturer_name:
        evidence.append(f"Manufacturer: {manufacturer.manufacturer_name}")
    if manufacturer.regulatory_status:
        evidence.append(f"Regulatory status: {manufacturer.regulatory_status}")
    if manufacturer.gmp_status:
        evidence.append(f"GMP status: {manufacturer.gmp_status}")
    if not evidence:
        return None, "Manufacturer and quality evidence unavailable.", []
    # Evidence completeness only. The input source must be validated by Layer 4.
    fields = sum(bool(x) for x in (
        manufacturer.manufacturer_name,
        manufacturer.regulatory_status,
        manufacturer.gmp_status,
        manufacturer.evidence_sources,
    ))
    return min(100.0, fields / 4 * 100), (
        "Score represents supplied manufacturer/quality evidence completeness, not a certification verdict."
    ), evidence


def aggregate_weighted_score(
    criteria: dict[str, CriterionScore],
) -> float:
    available = [
        (item.score, item.weight)
        for item in criteria.values()
        if item.score is not None
    ]
    total_weight = sum(weight for _, weight in available)
    if total_weight <= 0:
        return 0.0
    return round(sum(score * weight for score, weight in available) / total_weight, 2)
