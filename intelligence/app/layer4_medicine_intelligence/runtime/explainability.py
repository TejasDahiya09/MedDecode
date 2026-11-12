
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from .candidate_ranker import CandidateRankingResult
from .match_classifier import ClassificationResult


@dataclass
class MatchExplanation:
    status: str
    summary: str
    selected_medicine_name: Optional[str]
    confidence_score: Optional[float]
    reasons: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    alternatives: List[str] = field(default_factory=list)


class MatchExplainer:
    """
    Creates human-readable explanations from ranking and classification.

    This class does not make or change matching decisions.
    It only communicates the evidence already calculated.
    """

    def explain(
        self,
        ranking_result: CandidateRankingResult,
        classification: ClassificationResult,
    ) -> MatchExplanation:

        selected = classification.selected_candidate

        selected_name = (
            selected.canonical_name if selected is not None else None
        )

        reasons: List[str] = []
        warnings = list(classification.warnings)

        if selected is not None:
            selected_rank = next(
                (
                    item
                    for item in ranking_result.ranked_candidates
                    if item.candidate.medicine_id == selected.medicine_id
                ),
                None,
            )

            if selected_rank is not None:
                reasons.extend(selected_rank.score.reasons)
                warnings.extend(selected_rank.score.warnings)

        alternatives = []

        for item in ranking_result.ranked_candidates:
            if selected is not None and (
                item.candidate.medicine_id == selected.medicine_id
            ):
                continue

            if item.hard_conflicts:
                continue

            if item.score.overall_score < 0.50:
                continue

            alternatives.append(item.candidate.canonical_name)

        # Remove duplicate explanations while preserving their order.
        reasons = list(dict.fromkeys(reasons))
        warnings = list(dict.fromkeys(warnings))
        alternatives = list(dict.fromkeys(alternatives))

        return MatchExplanation(
            status=classification.match_status.value,
            summary=classification.explanation,
            selected_medicine_name=selected_name,
            confidence_score=classification.confidence_score,
            reasons=reasons,
            warnings=warnings,
            alternatives=alternatives,
        )
