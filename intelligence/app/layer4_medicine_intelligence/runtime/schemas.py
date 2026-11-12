
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional
from uuid import UUID


class RuntimeMatchStatus(str, Enum):
    MATCHED = "MATCHED"
    PROBABLE_MATCH = "PROBABLE_MATCH"
    AMBIGUOUS = "AMBIGUOUS"
    UNMATCHED = "UNMATCHED"
    NOT_ATTEMPTED = "NOT_ATTEMPTED"


@dataclass
class MedicineQuery:
    raw_medicine_text: str
    medicine_name: Optional[str] = None
    normalized_medicine_name: Optional[str] = None
    dosage_form: Optional[str] = None
    strength_value: Optional[float] = None
    strength_unit: Optional[str] = None
    active_ingredients: List[str] = field(default_factory=list)


@dataclass
class CandidateIngredient:
    ingredient_id: UUID
    ingredient_name: str
    normalized_name: str
    strength_value: Optional[float] = None
    strength_unit: Optional[str] = None


@dataclass
class MedicineCandidate:
    medicine_id: UUID
    canonical_name: str
    normalized_name: str
    brand_name: Optional[str] = None
    generic_name: Optional[str] = None
    dosage_form: Optional[str] = None
    strength_value: Optional[float] = None
    strength_unit: Optional[str] = None
    medicine_type: Optional[str] = None
    prescription_required: Optional[bool] = None
    ingredients: List[CandidateIngredient] = field(default_factory=list)


@dataclass
class CandidateScore:
    medicine_id: UUID
    name_score: float
    strength_score: Optional[float]
    dosage_form_score: Optional[float]
    ingredient_score: Optional[float]
    overall_score: float
    reasons: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


@dataclass
class MedicineMatchResult:
    query: MedicineQuery
    match_status: RuntimeMatchStatus
    selected_candidate: Optional[MedicineCandidate] = None
    ranked_candidates: List[CandidateScore] = field(default_factory=list)
    confidence_score: Optional[float] = None
    explanation: str = ""
    warnings: List[str] = field(default_factory=list)
