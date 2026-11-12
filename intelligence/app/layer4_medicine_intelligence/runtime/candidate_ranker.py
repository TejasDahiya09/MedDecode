
from __future__ import annotations

from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Set, Tuple
import re
import unicodedata

from .schemas import (
    CandidateScore,
    MedicineCandidate,
    MedicineQuery,
)


@dataclass
class RankedCandidate:
    candidate: MedicineCandidate
    score: CandidateScore
    hard_conflicts: List[str] = field(default_factory=list)


@dataclass
class CandidateRankingResult:
    ranked_candidates: List[RankedCandidate]
    warnings: List[str] = field(default_factory=list)


class CandidateRanker:
    """
    Ranks retrieved medicine candidates using identity-related evidence.

    This class:
    - Does not access or modify the database.
    - Does not select a final medicine match.
    - Does not infer missing prescription information.
    - Records known identity conflicts separately from ranking scores.
    """

    WEIGHTS = {
        "name": 0.45,
        "strength": 0.20,
        "dosage_form": 0.15,
        "ingredients": 0.20,
    }

    def rank(
        self,
        query: MedicineQuery,
        candidates: List[MedicineCandidate],
        retrieval_reasons: Optional[Dict] = None,
    ) -> CandidateRankingResult:

        retrieval_reasons = retrieval_reasons or {}
        ranked: List[RankedCandidate] = []
        result_warnings: List[str] = []

        normalized_query = self._normalise_name(
            query.normalized_medicine_name or query.medicine_name or ""
        )

        if not normalized_query:
            return CandidateRankingResult(
                ranked_candidates=[],
                warnings=["Medicine name is unavailable; candidates cannot be ranked."],
            )

        for candidate in candidates:
            reasons: List[str] = []
            warnings: List[str] = []
            conflicts: List[str] = []

            retrieval_reason = retrieval_reasons.get(
                candidate.medicine_id, ""
            )
            if isinstance(retrieval_reason, (list, tuple, set)):
                retrieval_reason = " ".join(
                    str(item) for item in retrieval_reason
                )
            retrieval_reason = str(retrieval_reason).casefold()

            # 1. Medicine-name similarity
            name_score, name_reason = self._score_name(
                normalized_query,
                candidate,
                retrieval_reason,
            )
            reasons.append(name_reason)

            # 2. Strength compatibility
            strength_score, strength_conflict, strength_reason = (
                self._score_strength(query, candidate)
            )
            if strength_reason:
                reasons.append(strength_reason)
            if strength_conflict:
                conflicts.append(strength_conflict)

            # 3. Dosage-form compatibility
            form_score, form_conflict, form_reason = (
                self._score_dosage_form(query, candidate)
            )
            if form_reason:
                reasons.append(form_reason)
            if form_conflict:
                conflicts.append(form_conflict)

            # 4. Active-ingredient compatibility
            ingredient_score, ingredient_conflict, ingredient_reason = (
                self._score_ingredients(query, candidate)
            )
            if ingredient_reason:
                reasons.append(ingredient_reason)
            if ingredient_conflict:
                conflicts.append(ingredient_conflict)

            if strength_score is None:
                warnings.append(
                    "Strength comparison unavailable because strength information is incomplete."
                )

            if form_score is None:
                warnings.append(
                    "Dosage-form comparison unavailable because dosage-form information is missing."
                )

            if ingredient_score is None:
                warnings.append(
                    "Ingredient comparison unavailable because explicit ingredient information is missing."
                )

            overall_score = self._calculate_overall_score(
                name_score=name_score,
                strength_score=strength_score,
                dosage_form_score=form_score,
                ingredient_score=ingredient_score,
            )

            if conflicts:
                warnings.append(
                    "Known identity conflict detected; this candidate must not be treated as a confirmed match."
                )

            score = CandidateScore(
                medicine_id=candidate.medicine_id,
                name_score=name_score,
                strength_score=strength_score,
                dosage_form_score=form_score,
                ingredient_score=ingredient_score,
                overall_score=overall_score,
                reasons=reasons,
                warnings=warnings,
            )

            ranked.append(
                RankedCandidate(
                    candidate=candidate,
                    score=score,
                    hard_conflicts=conflicts,
                )
            )

        ranked.sort(
            key=lambda item: (
                bool(item.hard_conflicts),
                -item.score.overall_score,
                -item.score.name_score,
            )
        )

        if ranked and all(item.hard_conflicts for item in ranked):
            result_warnings.append(
                "All retrieved candidates have known identity conflicts."
            )

        return CandidateRankingResult(
            ranked_candidates=ranked,
            warnings=result_warnings,
        )

    @staticmethod
    def _normalise_name(value: str) -> str:
        value = unicodedata.normalize("NFKC", value or "")
        value = value.casefold()
        value = re.sub(r"[^\w\s]", " ", value)
        return " ".join(value.split())

    def _score_name(
        self,
        query_name: str,
        candidate: MedicineCandidate,
        retrieval_reason: str,
    ) -> Tuple[float, str]:

        candidate_name = self._normalise_name(
            candidate.normalized_name or candidate.canonical_name or ""
        )

        if not candidate_name:
            return 0.0, "Candidate has no usable medicine name."

        if query_name == candidate_name:
            return 1.0, "Exact normalized canonical medicine-name match."

        if "exact" in retrieval_reason and "alias" in retrieval_reason:
            return 1.0, "Candidate retrieved through an exact medicine-alias match."

        if "exact" in retrieval_reason and (
            "brand" in retrieval_reason or "generic" in retrieval_reason
        ):
            return 1.0, "Candidate retrieved through an exact brand/generic-name match."

        sequence_score = SequenceMatcher(
            None, query_name, candidate_name
        ).ratio()

        query_tokens: Set[str] = set(query_name.split())
        candidate_tokens: Set[str] = set(candidate_name.split())

        if query_tokens and candidate_tokens:
            token_score = len(query_tokens & candidate_tokens) / max(
                len(query_tokens), len(candidate_tokens)
            )
        else:
            token_score = 0.0

        combined_score = (0.70 * sequence_score) + (0.30 * token_score)

        return round(combined_score, 4), (
            "Medicine-name similarity calculated from text and token overlap."
        )

    @staticmethod
    def _normalise_unit(unit: Optional[str]) -> Optional[str]:
        if not unit:
            return None

        value = unit.strip().casefold().replace("μ", "µ")

        aliases = {
            "mcg": "µg",
            "ug": "µg",
            "µg": "µg",
            "milligram": "mg",
            "milligrams": "mg",
            "gram": "g",
            "grams": "g",
            "milliliter": "ml",
            "milliliters": "ml",
            "millilitre": "ml",
            "millilitres": "ml",
            "iu": "iu",
            "unit": "unit",
            "units": "unit",
        }

        return aliases.get(value, value)

    def _score_strength(
        self,
        query: MedicineQuery,
        candidate: MedicineCandidate,
    ) -> Tuple[Optional[float], Optional[str], Optional[str]]:

        query_value = query.strength_value
        candidate_value = candidate.strength_value

        query_unit = self._normalise_unit(query.strength_unit)
        candidate_unit = self._normalise_unit(candidate.strength_unit)

        if (
            query_value is None
            or candidate_value is None
            or query_unit is None
            or candidate_unit is None
        ):
            return None, None, None

        if query_unit != candidate_unit:
            return (
                0.0,
                (
                    f"Strength-unit conflict: prescription specifies "
                    f"{query_unit}, candidate specifies {candidate_unit}."
                ),
                "Strength units are different.",
            )

        if query_value != candidate_value:
            return (
                0.0,
                (
                    f"Strength conflict: prescription specifies "
                    f"{query_value} {query_unit}, candidate specifies "
                    f"{candidate_value} {candidate_unit}."
                ),
                "Strength values are different.",
            )

        return 1.0, None, "Exact strength value and unit match."

    def _score_dosage_form(
        self,
        query: MedicineQuery,
        candidate: MedicineCandidate,
    ) -> Tuple[Optional[float], Optional[str], Optional[str]]:

        query_form = self._normalise_name(query.dosage_form or "")
        candidate_form = self._normalise_name(candidate.dosage_form or "")

        if not query_form or not candidate_form:
            return None, None, None

        if query_form == candidate_form:
            return 1.0, None, "Exact dosage-form match."

        return (
            0.0,
            (
                f"Dosage-form conflict: prescription specifies "
                f"{query.dosage_form}, candidate specifies "
                f"{candidate.dosage_form}."
            ),
            "Dosage forms are different.",
        )

    def _score_ingredients(
        self,
        query: MedicineQuery,
        candidate: MedicineCandidate,
    ) -> Tuple[Optional[float], Optional[str], Optional[str]]:

        query_ingredients = {
            self._normalise_name(item)
            for item in (query.active_ingredients or [])
            if item and self._normalise_name(item)
        }

        candidate_ingredients = {
            self._normalise_name(item.ingredient_name)
            for item in (candidate.ingredients or [])
            if item.ingredient_name
            and self._normalise_name(item.ingredient_name)
        }

        if not query_ingredients or not candidate_ingredients:
            return None, None, None

        overlap = query_ingredients & candidate_ingredients

        if not overlap:
            return (
                0.0,
                (
                    "Active-ingredient conflict: explicitly supplied "
                    "prescription ingredients do not overlap with candidate ingredients."
                ),
                "No overlap between explicitly supplied active ingredients.",
            )

        union = query_ingredients | candidate_ingredients
        score = len(overlap) / len(union)

        return (
            round(score, 4),
            None,
            "Active-ingredient overlap found.",
        )

    def _calculate_overall_score(
        self,
        name_score: float,
        strength_score: Optional[float],
        dosage_form_score: Optional[float],
        ingredient_score: Optional[float],
    ) -> float:

        components = [
            (self.WEIGHTS["name"], name_score),
            (self.WEIGHTS["strength"], strength_score),
            (self.WEIGHTS["dosage_form"], dosage_form_score),
            (self.WEIGHTS["ingredients"], ingredient_score),
        ]

        available_weight = sum(
            weight
            for weight, score in components
            if score is not None
        )

        if available_weight == 0:
            return 0.0

        weighted_total = sum(
            weight * score
            for weight, score in components
            if score is not None
        )

        return round(weighted_total / available_weight, 4)
