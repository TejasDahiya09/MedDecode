
"""
Candidate retrieval for MedDecode Layer 4 runtime.

Combines repository search methods to retrieve possible medicine
identities from the Supabase catalogue.

This module:
- Does not select a final medicine.
- Does not calculate final confidence.
- Does not modify the database.
- Preserves the reasons each candidate was retrieved.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from app.layer4_medicine_intelligence.runtime.normalizer import (
    normalize_medicine_query,
)
from app.layer4_medicine_intelligence.runtime.repository import (
    MedicineRepository,
)
from app.layer4_medicine_intelligence.runtime.schemas import (
    MedicineCandidate,
    MedicineQuery,
)


@dataclass
class CandidateRetrievalResult:
    """
    Output of the candidate retrieval stage.

    candidates:
        Unique medicine candidates retrieved from the catalogue.

    retrieval_reasons:
        Search methods that found each candidate, keyed by medicine UUID.

    attempted:
        False when there was insufficient input to perform retrieval.
    """

    candidates: list[MedicineCandidate] = field(
        default_factory=list
    )

    retrieval_reasons: dict[UUID, list[str]] = field(
        default_factory=dict
    )

    attempted: bool = True

    warnings: list[str] = field(
        default_factory=list
    )


class CandidateRetriever:
    """
    Retrieves possible medicine candidates from the catalogue.

    Search strategy:

    1. Exact canonical normalized-name search.
    2. Exact normalized-alias search.
    3. Exact brand-name search.
    4. Exact generic-name search.
    5. Bounded canonical-name prefix search.

    All results are deduplicated by medicine UUID.
    """

    def __init__(
        self,
        repository: MedicineRepository,
        enable_prefix_search: bool = True,
    ) -> None:

        self.repository = repository
        self.enable_prefix_search = enable_prefix_search

    # --------------------------------------------------------
    # CANDIDATE DEDUPLICATION
    # --------------------------------------------------------

    @staticmethod
    def _add_candidates(
        candidates_by_id: dict[UUID, MedicineCandidate],
        reasons_by_id: dict[UUID, list[str]],
        candidates: list[MedicineCandidate],
        reason: str,
    ) -> None:
        """
        Add candidates while preserving their retrieval reasons.
        """

        for candidate in candidates:

            medicine_id = candidate.medicine_id

            if medicine_id not in candidates_by_id:
                candidates_by_id[medicine_id] = candidate

            if medicine_id not in reasons_by_id:
                reasons_by_id[medicine_id] = []

            if reason not in reasons_by_id[medicine_id]:
                reasons_by_id[medicine_id].append(reason)

    # --------------------------------------------------------
    # PUBLIC RETRIEVAL API
    # --------------------------------------------------------

    def retrieve(
        self,
        query: MedicineQuery,
    ) -> CandidateRetrievalResult:
        """
        Retrieve possible medicine candidates for one Layer 3 query.

        No candidate is selected as the final medicine here.
        """

        normalized_query = normalize_medicine_query(
            query
        )

        medicine_name = (
            normalized_query.normalized_medicine_name
        )

        if not medicine_name:

            return CandidateRetrievalResult(
                attempted=False,
                warnings=[
                    "Medicine name is unavailable. "
                    "Candidate retrieval was not attempted."
                ],
            )

        candidates_by_id: dict[
            UUID,
            MedicineCandidate
        ] = {}

        reasons_by_id: dict[
            UUID,
            list[str]
        ] = {}

        # ----------------------------------------------------
        # 1. Exact canonical name
        # ----------------------------------------------------

        results = self.repository.find_by_normalized_name(
            medicine_name
        )

        self._add_candidates(
            candidates_by_id,
            reasons_by_id,
            results,
            "Exact normalized canonical-name match",
        )

        # ----------------------------------------------------
        # 2. Exact alias
        # ----------------------------------------------------

        results = self.repository.find_by_alias(
            medicine_name
        )

        self._add_candidates(
            candidates_by_id,
            reasons_by_id,
            results,
            "Exact normalized medicine-alias match",
        )

        # ----------------------------------------------------
        # 3. Exact brand name
        # ----------------------------------------------------

        if normalized_query.medicine_name:

            results = self.repository.find_by_brand_name(
                normalized_query.medicine_name
            )

            self._add_candidates(
                candidates_by_id,
                reasons_by_id,
                results,
                "Exact brand-name match",
            )

        # ----------------------------------------------------
        # 4. Exact generic name
        # ----------------------------------------------------

        if normalized_query.medicine_name:

            results = self.repository.find_by_generic_name(
                normalized_query.medicine_name
            )

            self._add_candidates(
                candidates_by_id,
                reasons_by_id,
                results,
                "Exact generic-name match",
            )

        # ----------------------------------------------------
        # 5. Bounded prefix search
        # ----------------------------------------------------

        if (
            self.enable_prefix_search
            and len(medicine_name) >= 3
        ):

            results = self.repository.search_name_prefix(
                medicine_name
            )

            self._add_candidates(
                candidates_by_id,
                reasons_by_id,
                results,
                "Canonical-name prefix match",
            )

        candidates = list(
            candidates_by_id.values()
        )

        # ----------------------------------------------------
        # Enrich candidates with active ingredients
        # ----------------------------------------------------

        if candidates:

            candidates = (
                self.repository.enrich_with_ingredients(
                    candidates
                )
            )

        return CandidateRetrievalResult(
            candidates=candidates,
            retrieval_reasons=reasons_by_id,
            attempted=True,
        )
