
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from .candidate_ranker import (
    CandidateRankingResult,
    RankedCandidate,
)
from .schemas import (
    MedicineMatchResult,
    MedicineQuery,
    RuntimeMatchStatus,
)


@dataclass
class ClassificationResult:
    match_status: RuntimeMatchStatus
    selected_candidate: Optional[object]
    confidence_score: Optional[float]
    explanation: str
    warnings: List[str] = field(default_factory=list)


class MatchClassifier:
    """
    Classifies ranked medicine candidates conservatively.

    The score is a ranking score, not a medically validated probability.

    MATCHED requires:
    - Strong name evidence.
    - At least one independent, known identity feature that matches.
    - No hard identity conflicts.
    """

    MATCH_THRESHOLD = 0.90
    PROBABLE_THRESHOLD = 0.65
    AMBIGUITY_MARGIN = 0.05

    def classify(
        self,
        ranking_result: CandidateRankingResult,
    ) -> ClassificationResult:

        candidates = ranking_result.ranked_candidates
        warnings = list(ranking_result.warnings)

        if not candidates:
            return ClassificationResult(
                match_status=RuntimeMatchStatus.UNMATCHED,
                selected_candidate=None,
                confidence_score=None,
                explanation="No medicine candidates were retrieved.",
                warnings=warnings,
            )

        eligible = [
            item for item in candidates
            if not item.hard_conflicts
        ]

        if not eligible:
            warnings.append(
                "No candidate can be confirmed because all retrieved candidates have identity conflicts."
            )
            return ClassificationResult(
                match_status=RuntimeMatchStatus.UNMATCHED,
                selected_candidate=None,
                confidence_score=None,
                explanation=(
                    "Retrieved candidates conflict with known prescription "
                    "identity information."
                ),
                warnings=warnings,
            )

        top = eligible[0]
        second = eligible[1] if len(eligible) > 1 else None

        score = top.score
        independent_support = self._has_independent_support(top)
        strong_name = score.name_score >= 0.90

        if (
            score.overall_score >= self.MATCH_THRESHOLD
            and strong_name
            and independent_support
        ):
            if (
                second is not None
                and second.score.overall_score >= self.MATCH_THRESHOLD
                and abs(
                    score.overall_score - second.score.overall_score
                ) <= self.AMBIGUITY_MARGIN
            ):
                warnings.append(
                    "Multiple candidates have similarly strong identity scores."
                )
                return ClassificationResult(
                    match_status=RuntimeMatchStatus.AMBIGUOUS,
                    selected_candidate=None,
                    confidence_score=score.overall_score,
                    explanation=(
                        "More than one candidate has similarly strong "
                        "identity evidence; no single candidate is selected."
                    ),
                    warnings=warnings,
                )

            return ClassificationResult(
                match_status=RuntimeMatchStatus.MATCHED,
                selected_candidate=top.candidate,
                confidence_score=score.overall_score,
                explanation=(
                    "A strong medicine-name match and independent identity "
                    "evidence were found, with no known identity conflicts."
                ),
                warnings=warnings + score.warnings,
            )

        if (
            second is not None
            and second.score.overall_score >= self.PROBABLE_THRESHOLD
            and abs(
                score.overall_score - second.score.overall_score
            ) <= self.AMBIGUITY_MARGIN
        ):
            warnings.append(
                "Several candidates have similar scores; manual verification is required."
            )
            return ClassificationResult(
                match_status=RuntimeMatchStatus.AMBIGUOUS,
                selected_candidate=None,
                confidence_score=score.overall_score,
                explanation=(
                    "Multiple plausible candidates have similar ranking scores."
                ),
                warnings=warnings,
            )

        if score.overall_score >= self.PROBABLE_THRESHOLD:
            warnings.append(
                "Candidate identity is not sufficiently established for a confirmed match."
            )
            return ClassificationResult(
                match_status=RuntimeMatchStatus.PROBABLE_MATCH,
                selected_candidate=top.candidate,
                confidence_score=score.overall_score,
                explanation=(
                    "A plausible candidate was found, but the available "
                    "identity evidence is insufficient for a confirmed match."
                ),
                warnings=warnings + score.warnings,
            )

        return ClassificationResult(
            match_status=RuntimeMatchStatus.UNMATCHED,
            selected_candidate=None,
            confidence_score=score.overall_score,
            explanation=(
                "No candidate met the minimum ranking threshold for a plausible match."
            ),
            warnings=warnings + score.warnings,
        )

    @staticmethod
    def _has_independent_support(candidate: RankedCandidate) -> bool:
        """
        Require at least one known, matching feature beyond the name.

        Missing values do not count as supporting evidence.
        """

        score = candidate.score

        matching_strength = score.strength_score == 1.0
        matching_form = score.dosage_form_score == 1.0
        matching_ingredients = (
            score.ingredient_score is not None
            and score.ingredient_score > 0.0
        )

        return (
            matching_strength
            or matching_form
            or matching_ingredients
        )
