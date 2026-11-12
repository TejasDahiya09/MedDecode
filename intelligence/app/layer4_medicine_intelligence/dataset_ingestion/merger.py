"""
Merge decision logic for the MedDecode medicine dataset ingestion pipeline.

Responsibility:

    Validated MedicineRecord
            +
    CandidateSearchResult
            ↓
        merger.py
            ↓
       MergeDecision

This module decides whether an incoming medicine record should be:

    INSERT
        A new medicine record should be created.

    UPDATE
        An existing medicine record can be safely enriched.

    SKIP
        The incoming record provides no meaningful new information.

    REVIEW
        Automatic merging is unsafe and requires review.

This module does NOT:

- query the database
- insert records
- update records
- delete records

Those responsibilities belong to:

candidate_finder.py
    → database lookup

database_writer.py
    → database writes

Pipeline position:

loader.py
    ↓
mapper.py
    ↓
transformer.py
    ↓
normalizer.py
    ↓
validator.py
    ↓
candidate_finder.py
    ↓
merger.py
    ↓
database_writer.py
"""

from __future__ import annotations

from typing import Optional

from .models import (
    CandidateSearchResult,
    MatchStatus,
    MedicineCandidate,
    MedicineRecord,
    MergeAction,
    MergeDecision,
)


# ============================================================
# CONFIGURATION
# ============================================================

# A fuzzy candidate at or above this score is considered strong
# enough to potentially update automatically, provided that there
# is only one candidate and there is no ambiguity.
AUTO_UPDATE_SIMILARITY_THRESHOLD = 0.95


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def _has_value(value: object) -> bool:
    """
    Returns True when a value should be considered meaningful.

    Empty strings and None are treated as missing.
    """

    if value is None:
        return False

    if isinstance(value, str):
        return bool(value.strip())

    return True


def _record_has_related_information(
    record: MedicineRecord,
) -> bool:
    """
    Checks whether the incoming record contains related information
    that could enrich an existing medicine.

    This includes:

    - manufacturer
    - ingredients
    - aliases
    - side effects
    - precautions
    - contraindications
    - prices
    - sources
    """

    return any(
        [
            record.manufacturer is not None,
            bool(record.ingredients),
            bool(record.aliases),
            bool(record.side_effects),
            bool(record.precautions),
            bool(record.contraindications),
            bool(record.prices),
            bool(record.sources),
        ]
    )


def _record_has_core_information(
    record: MedicineRecord,
) -> bool:
    """
    Checks whether the record contains meaningful medicine-level
    information beyond canonical identity.
    """

    return any(
        [
            _has_value(record.brand_name),
            _has_value(record.generic_name),
            _has_value(record.medicine_type),
            _has_value(record.category),
            _has_value(record.description),
            _has_value(record.purpose),
            _has_value(record.dosage_form),
            record.strength_value is not None,
            _has_value(record.strength_unit),
            record.prescription_required is not None,
            _has_value(record.usage_instructions),
            _has_value(record.storage_information),
            _has_value(record.country),
            _has_value(record.currency),
            record.average_cost is not None,
            _has_value(record.image_url),
        ]
    )


def _record_can_enrich_existing_medicine(
    record: MedicineRecord,
) -> bool:
    """
    Returns True when the incoming record contains information that
    could potentially enrich an existing medicine.

    The actual field-level merge is intentionally NOT performed here.
    database_writer.py will apply the approved merge operation.
    """

    return (
        _record_has_core_information(record)
        or _record_has_related_information(record)
    )


def _get_single_candidate(
    candidate_result: CandidateSearchResult,
) -> Optional[MedicineCandidate]:
    """
    Returns the candidate only when exactly one candidate exists.
    """

    if len(candidate_result.candidates) != 1:
        return None

    return candidate_result.candidates[0]


def _candidate_is_high_confidence(
    candidate: MedicineCandidate,
) -> bool:
    """
    Determines whether a candidate is strong enough to be considered
    for automatic update.

    Exact matches are represented with similarity_score == 1.0.
    """

    if candidate.similarity_score is None:
        return False

    return (
        candidate.similarity_score
        >= AUTO_UPDATE_SIMILARITY_THRESHOLD
    )


# ============================================================
# NEW MEDICINE DECISION
# ============================================================

def _decide_new_medicine(
    record: MedicineRecord,
) -> MergeDecision:
    """
    Creates an INSERT decision for a medicine that does not already
    exist in the database.
    """

    return MergeDecision(
        action=MergeAction.INSERT,
        target_medicine_id=None,
        record=record,
        reason=(
            "No existing medicine candidate was found. "
            "Insert as a new canonical medicine record."
        ),
    )


# ============================================================
# EXACT MATCH DECISION
# ============================================================

def _decide_exact_match(
    record: MedicineRecord,
    candidate_result: CandidateSearchResult,
) -> MergeDecision:
    """
    Handles an exact medicine match.

    An exact match means candidate_finder.py found exactly one strong
    identity match.

    If the incoming record contains potentially useful information,
    UPDATE is selected.

    Otherwise SKIP is selected.
    """

    candidate = _get_single_candidate(
        candidate_result
    )

    if candidate is None:

        return MergeDecision(
            action=MergeAction.REVIEW,
            target_medicine_id=None,
            record=record,
            reason=(
                "Exact match status was returned but the candidate "
                "set is not uniquely resolvable."
            ),
        )

    if _record_can_enrich_existing_medicine(record):

        return MergeDecision(
            action=MergeAction.UPDATE,
            target_medicine_id=candidate.medicine_id,
            record=record,
            reason=(
                "Exactly one existing medicine was identified. "
                "The incoming record contains information that may "
                "enrich the existing medicine."
            ),
        )

    return MergeDecision(
        action=MergeAction.SKIP,
        target_medicine_id=candidate.medicine_id,
        record=record,
        reason=(
            "Exactly one existing medicine was identified, but the "
            "incoming record contains no additional information that "
            "requires enrichment."
        ),
    )


# ============================================================
# POSSIBLE MATCH DECISION
# ============================================================

def _decide_possible_match(
    record: MedicineRecord,
    candidate_result: CandidateSearchResult,
) -> MergeDecision:
    """
    Handles non-exact candidate matches.

    Automatic updates are only allowed when:

    - exactly one candidate exists
    - candidate confidence is sufficiently high

    Otherwise REVIEW is selected to prevent incorrect medicine merges.
    """

    candidate = _get_single_candidate(candidate_result)
    return MergeDecision(
        action=MergeAction.REVIEW,
        target_medicine_id=candidate.medicine_id if candidate is not None else None,
        record=record,
        reason=(
            "A fuzzy medicine candidate cannot update an official source "
            "record automatically. Manual identity review is required."
        ),
    )


# ============================================================
# AMBIGUOUS MATCH DECISION
# ============================================================

def _decide_ambiguous_match(
    record: MedicineRecord,
    candidate_result: CandidateSearchResult,
) -> MergeDecision:
    """
    Handles ambiguous candidate matches.

    Ambiguous records must never be automatically merged because doing
    so could attach medical information to the wrong medicine.
    """

    candidate_ids = [
        candidate.medicine_id
        for candidate in candidate_result.candidates
    ]

    return MergeDecision(
        action=MergeAction.REVIEW,
        target_medicine_id=None,
        record=record,
        reason=(
            "Multiple equally plausible medicine candidates were found. "
            f"Candidate IDs: {candidate_ids}. "
            "Manual review is required before merging."
        ),
    )


# ============================================================
# PUBLIC MERGE API
# ============================================================

def decide_merge(
    record: MedicineRecord,
    candidate_result: CandidateSearchResult,
) -> MergeDecision:
    """
    Determines the merge action for an incoming MedicineRecord.

    Decision matrix:

    ------------------------------------------------------------

    MatchStatus.NEW

        → INSERT

    ------------------------------------------------------------

    MatchStatus.EXACT_MATCH

        One exact candidate:

            Record contains enrichable information
                → UPDATE

            Record contains no additional information
                → SKIP

    ------------------------------------------------------------

    MatchStatus.POSSIBLE_MATCH

        One high-confidence candidate:

            Record contains enrichable information
                → UPDATE

            No additional information
                → SKIP

        Multiple candidates
            → REVIEW

        Low-confidence candidate
            → REVIEW

    ------------------------------------------------------------

    MatchStatus.AMBIGUOUS

        → REVIEW

    ------------------------------------------------------------

    Parameters
    ----------
    record:
        Validated and normalized MedicineRecord.

    candidate_result:
        CandidateSearchResult returned by candidate_finder.py.

    Returns
    -------
    MergeDecision
        The action that database_writer.py should execute.
    """

    # --------------------------------------------------------
    # NEW
    # --------------------------------------------------------

    if candidate_result.match_status == MatchStatus.NEW:

        return _decide_new_medicine(
            record=record,
        )

    # --------------------------------------------------------
    # EXACT MATCH
    # --------------------------------------------------------

    if (
        candidate_result.match_status
        == MatchStatus.EXACT_MATCH
    ):

        return _decide_exact_match(
            record=record,
            candidate_result=candidate_result,
        )

    # --------------------------------------------------------
    # POSSIBLE MATCH
    # --------------------------------------------------------

    if (
        candidate_result.match_status
        == MatchStatus.POSSIBLE_MATCH
    ):

        return _decide_possible_match(
            record=record,
            candidate_result=candidate_result,
        )

    # --------------------------------------------------------
    # AMBIGUOUS MATCH
    # --------------------------------------------------------

    if (
        candidate_result.match_status
        == MatchStatus.AMBIGUOUS
    ):

        return _decide_ambiguous_match(
            record=record,
            candidate_result=candidate_result,
        )

    # --------------------------------------------------------
    # Defensive fallback
    # --------------------------------------------------------

    return MergeDecision(
        action=MergeAction.REVIEW,
        target_medicine_id=None,
        record=record,
        reason=(
            "Candidate matching returned an unsupported or unknown "
            "match status. Manual review is required."
        ),
    )

# ============================================================
# MERGER SERVICE CLASS
# ============================================================


class MedicineMerger:
    """
    Public merge-decision interface for the MedDecode ingestion pipeline.

    Determines whether an incoming medicine record should be inserted,
    updated, skipped, or sent for manual review.
    """

    def decide(
        self,
        record: MedicineRecord,
        candidate_result: CandidateSearchResult,
    ) -> MergeDecision:
        """
        Determine the merge action for one medicine record.
        """

        return decide_merge(
            record=record,
            candidate_result=candidate_result,
        )
