"""
Runtime schemas for MedDecode Layer 4.

These models define the input, candidate and output contracts
for runtime medicine intelligence.

This module is separate from dataset_ingestion.models.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
from uuid import UUID


# ============================================================
# MATCH STATUS
# ============================================================

class RuntimeMatchStatus(str, Enum):
    """
    Final medicine matching status returned by Layer 4.

    MATCHED:
        One sufficiently reliable medicine identity was established.

    PROBABLE_MATCH:
        A likely candidate exists, but some identity information
        is missing or uncertain.

    AMBIGUOUS:
        Multiple plausible candidates exist.

    UNMATCHED:
        No suitable candidate was found.

    NOT_ATTEMPTED:
        Matching could not be performed because required input
        information was unavailable.
    """

    MATCHED = "matched"
    PROBABLE_MATCH = "probable_match"
    AMBIGUOUS = "ambiguous"
    UNMATCHED = "unmatched"
    NOT_ATTEMPTED = "not_attempted"


# ============================================================
# INPUT MODEL
# ============================================================

@dataclass
class MedicineQuery:
    """
    Structured medicine information received from Layer 3.

    Layer 4 uses this information to identify the corresponding
    medicine in the canonical medicine catalogue.

    No missing information is inferred.
    """

    raw_medicine_text: str

    medicine_name: Optional[str] = None
    normalized_medicine_name: Optional[str] = None

    dosage_form: Optional[str] = None

    strength_value: Optional[float] = None
    strength_unit: Optional[str] = None

    # Optional ingredients when supplied by an upstream component.
    # These must not be guessed from the medicine name.
    active_ingredients: list[str] = field(
        default_factory=list
    )


# ============================================================
# CANDIDATE INGREDIENT MODEL
# ============================================================

@dataclass
class CandidateIngredient:
    """
    Active ingredient associated with a catalogue medicine.
    """

    ingredient_id: Optional[UUID] = None

    ingredient_name: str = ""

    normalized_name: Optional[str] = None

    strength_value: Optional[float] = None

    strength_unit: Optional[str] = None


# ============================================================
# DATABASE CANDIDATE MODEL
# ============================================================

@dataclass
class MedicineCandidate:
    """
    One possible medicine retrieved from the Supabase catalogue.

    This is a read-only representation.

    It is not the same as the MedicineCandidate used by
    dataset_ingestion.models.
    """

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

    ingredients: list[CandidateIngredient] = field(
        default_factory=list
    )


# ============================================================
# CANDIDATE SCORE MODEL
# ============================================================

@dataclass
class CandidateScore:
    """
    Explainable ranking result for one medicine candidate.

    Component scores are optional when the corresponding input
    information is unavailable.

    Overall score is a ranking signal, not a medically validated
    probability of identity.
    """

    medicine_id: UUID

    name_score: float

    strength_score: Optional[float] = None

    dosage_form_score: Optional[float] = None

    ingredient_score: Optional[float] = None

    overall_score: float = 0.0

    reasons: list[str] = field(
        default_factory=list
    )

    warnings: list[str] = field(
        default_factory=list
    )


# ============================================================
# FINAL MATCH RESULT
# ============================================================

@dataclass
class MedicineMatchResult:
    """
    Complete runtime result returned by Layer 4.

    The result contains:
    - Original medicine query
    - Final match status
    - Selected candidate, if appropriate
    - Ranked candidates
    - Confidence/ranking score
    - Explanation
    - Warnings

    Layer 4 does not prescribe medicines or recommend
    autonomous medication changes.
    """

    query: MedicineQuery

    match_status: RuntimeMatchStatus

    selected_candidate: Optional[MedicineCandidate] = None

    ranked_candidates: list[CandidateScore] = field(
        default_factory=list
    )

    confidence_score: Optional[float] = None

    explanation: list[str] = field(
        default_factory=list
    )

    warnings: list[str] = field(
        default_factory=list
    )