from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Optional
from uuid import UUID

from app.layer4_medicine_intelligence.runtime.schemas import (
    MedicineCandidate,
    RuntimeMatchStatus,
)


class RecommendationStatus(str, Enum):
    RANKED = "RANKED"
    NO_CANDIDATES = "NO_CANDIDATES"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    NOT_ELIGIBLE = "NOT_ELIGIBLE"


@dataclass(frozen=True)
class RankingWeights:
    ingredient_compatibility: float = 0.35
    price_competitiveness: float = 0.25
    safety_evidence: float = 0.20
    brand_generic: float = 0.10
    manufacturer_quality: float = 0.10

    def __post_init__(self) -> None:
        values = (
            self.ingredient_compatibility,
            self.price_competitiveness,
            self.safety_evidence,
            self.brand_generic,
            self.manufacturer_quality,
        )
        if any(value < 0 for value in values):
            raise ValueError("Ranking weights cannot be negative.")
        if round(sum(values), 8) != 1.0:
            raise ValueError("Ranking weights must total exactly 1.0.")


@dataclass
class PriceObservation:
    medicine_id: UUID
    price: Decimal
    currency: str
    country: Optional[str]
    region: Optional[str]
    quantity: Optional[Decimal]
    package_description: Optional[str]
    source: Optional[str]
    recorded_at: Optional[datetime]


@dataclass
class SafetyEvidence:
    contraindications: list[str] = field(default_factory=list)
    precautions: list[str] = field(default_factory=list)
    side_effects: list[str] = field(default_factory=list)
    interactions: list[str] = field(default_factory=list)
    evidence_sources: list[str] = field(default_factory=list)


@dataclass
class ManufacturerEvidence:
    manufacturer_name: Optional[str] = None
    regulatory_status: Optional[str] = None
    gmp_status: Optional[str] = None
    evidence_sources: list[str] = field(default_factory=list)


@dataclass
class Layer4CandidateData:
    """
    Fully enriched candidate supplied by Layer 4.

    Layer 5 consumes this object and performs no database or network access.
    """
    medicine: MedicineCandidate
    prices: list[PriceObservation] = field(default_factory=list)
    safety: SafetyEvidence = field(default_factory=SafetyEvidence)
    manufacturer: ManufacturerEvidence = field(default_factory=ManufacturerEvidence)


@dataclass
class Layer4RecommendationInput:
    """
    Explicit Layer 4 -> Layer 5 contract.
    Layer 4 supplies the confirmed source and pre-retrieved alternative set.
    """
    match_status: RuntimeMatchStatus
    selected_medicine: Optional[Layer4CandidateData]
    alternative_candidates: list[Layer4CandidateData] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class CriterionScore:
    score: Optional[float]
    weight: float
    contribution: Optional[float]
    explanation: str
    evidence: list[str] = field(default_factory=list)


@dataclass
class RankedMedicine:
    medicine_id: UUID
    medicine_name: str
    brand_name: Optional[str]
    generic_name: Optional[str]
    dosage_form: Optional[str]
    strength_value: Optional[float]
    strength_unit: Optional[str]
    rank: int
    overall_score: float
    criteria_scores: dict[str, CriterionScore]
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    review_required: bool = True


@dataclass
class RecommendationResult:
    status: RecommendationStatus
    source_medicine_id: Optional[UUID]
    source_medicine_name: Optional[str]
    ranking_weights: RankingWeights
    ranked_medicines: list[RankedMedicine] = field(default_factory=list)
    excluded_candidates: list[dict] = field(default_factory=list)
    explanation: str = ""
    warnings: list[str] = field(default_factory=list)
