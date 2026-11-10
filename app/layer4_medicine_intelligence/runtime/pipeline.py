
from __future__ import annotations

from typing import List, Optional, Sequence

from app.schemas.medicine import MedicineUsageRecord

from .candidate_ranker import CandidateRanker
from .candidate_retriever import CandidateRetriever
from .explainability import MatchExplainer
from .match_classifier import MatchClassifier
from .repository import MedicineRepository
from .schemas import (
    MedicineMatchResult,
    MedicineQuery,
    RuntimeMatchStatus,
)


class MedicineIntelligencePipeline:
    """
    Read-only runtime pipeline for medicine identity matching.

    Layer 3 supplies extracted medicine information.
    Layer 4 retrieves, ranks, and classifies catalogue candidates.

    No catalogue writes or ingestion operations are performed here.
    """

    def __init__(
        self,
        repository: Optional[MedicineRepository] = None,
    ) -> None:

        self.repository = repository or MedicineRepository()

        self.retriever = CandidateRetriever(
            repository=self.repository
        )

        self.ranker = CandidateRanker()
        self.classifier = MatchClassifier()
        self.explainer = MatchExplainer()

    def match_medicine(
        self,
        medicine: MedicineUsageRecord,
    ) -> MedicineMatchResult:
        """
        Match one Layer 3 medicine record against the catalogue.
        """

        query = self._build_query(medicine)

        if not query.medicine_name and not query.normalized_medicine_name:
            return self._not_attempted_result(
                query=query,
                warning=(
                    "Medicine matching was not attempted because "
                    "Layer 3 did not provide a usable medicine name."
                ),
            )

        # Step 1: Retrieve candidates from the read-only repository.
        retrieval = self.retriever.retrieve(query)

        if not retrieval.attempted:
            return self._not_attempted_result(
                query=query,
                warning="Candidate retrieval could not be attempted.",
                additional_warnings=retrieval.warnings,
            )

        if not retrieval.candidates:
            return MedicineMatchResult(
                query=query,
                match_status=RuntimeMatchStatus.UNMATCHED,
                selected_candidate=None,
                ranked_candidates=[],
                confidence_score=None,
                explanation="No matching medicine candidates were found in the catalogue.",
                warnings=list(retrieval.warnings),
            )

        # Step 2: Rank the retrieved candidates.
        ranking = self.ranker.rank(
            query=query,
            candidates=retrieval.candidates,
            retrieval_reasons=retrieval.retrieval_reasons,
        )

        # Step 3: Classify the ranking result.
        classification = self.classifier.classify(ranking)

        # Step 4: Generate a human-readable explanation.
        explanation = self.explainer.explain(
            ranking_result=ranking,
            classification=classification,
        )

        # Step 5: Convert ranked candidates into the public result schema.
        ranked_scores = [
            item.score for item in ranking.ranked_candidates
        ]

        warnings = list(retrieval.warnings)
        warnings.extend(ranking.warnings)
        warnings.extend(explanation.warnings)

        return MedicineMatchResult(
            query=query,
            match_status=classification.match_status,
            selected_candidate=classification.selected_candidate,
            ranked_candidates=ranked_scores,
            confidence_score=classification.confidence_score,
            explanation=explanation.summary,
            warnings=list(dict.fromkeys(warnings)),
        )

    def match_medicines(
        self,
        medicines: Sequence[MedicineUsageRecord],
    ) -> List[MedicineMatchResult]:
        """
        Match multiple Layer 3 medicine records independently.
        """

        return [
            self.match_medicine(medicine)
            for medicine in medicines
        ]

    @staticmethod
    def _build_query(
        medicine: MedicineUsageRecord,
    ) -> MedicineQuery:
        """
        Adapt the existing Layer 3 dataclass to the Layer 4 query schema.

        No missing ingredient, strength, or dosage-form information
        is inferred.
        """

        strength = medicine.strength

        return MedicineQuery(
            raw_medicine_text=medicine.raw_medicine_text or "",
            medicine_name=medicine.raw_medicine_name,
            normalized_medicine_name=medicine.normalized_medicine_name,
            dosage_form=medicine.dosage_form,
            strength_value=strength.value if strength else None,
            strength_unit=strength.unit if strength else None,
            active_ingredients=[],
        )

    @staticmethod
    def _not_attempted_result(
        query: MedicineQuery,
        warning: str,
        additional_warnings: Optional[List[str]] = None,
    ) -> MedicineMatchResult:

        warnings = [warning]
        warnings.extend(additional_warnings or [])

        return MedicineMatchResult(
            query=query,
            match_status=RuntimeMatchStatus.NOT_ATTEMPTED,
            selected_candidate=None,
            ranked_candidates=[],
            confidence_score=None,
            explanation=warning,
            warnings=list(dict.fromkeys(warnings)),
        )


def match_medicine(
    medicine: MedicineUsageRecord,
) -> MedicineMatchResult:
    """
    Convenience function for matching one Layer 3 medicine record.
    """

    pipeline = MedicineIntelligencePipeline()
    return pipeline.match_medicine(medicine)


def match_medicines(
    medicines: Sequence[MedicineUsageRecord],
) -> List[MedicineMatchResult]:
    """
    Convenience function for matching multiple Layer 3 records.
    """

    pipeline = MedicineIntelligencePipeline()
    return pipeline.match_medicines(medicines)
