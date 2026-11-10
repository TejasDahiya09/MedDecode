"""
Candidate finder for the MedDecode medicine dataset ingestion pipeline.

Responsibility:

    MedicineRecord
        ↓
    Search existing medicines
        ↓
    Exact matching
        ↓
    Alias matching
        ↓
    Controlled fuzzy matching
        ↓
    CandidateSearchResult

This module does NOT:
- insert records
- update records
- merge records
- modify the database

It only identifies possible existing medicine records.

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

from difflib import SequenceMatcher
from typing import Any, Optional

from .models import (
    CandidateSearchResult,
    MatchStatus,
    MedicineCandidate,
    MedicineRecord,
)


# ============================================================
# CONFIGURATION
# ============================================================

# Minimum score required for a fuzzy candidate to be returned.
FUZZY_MATCH_THRESHOLD = 0.85

# Score at or above this value is considered highly likely,
# but candidate_finder still does not make merge decisions.
HIGH_CONFIDENCE_THRESHOLD = 0.95

# Maximum number of fuzzy candidates returned.
MAX_FUZZY_CANDIDATES = 10


# ============================================================
# DATABASE ACCESS HELPERS
# ============================================================

def _get_table(database: Any, table_name: str) -> Any:
    """
    Returns a database table/query object.

    This helper supports the expected Supabase-style client:

        database.table("medicines")

    The database client itself is intentionally injected from outside
    this module so candidate_finder.py remains independent from
    connection configuration.
    """

    return database.table(table_name)


def _execute(query: Any) -> Any:
    """
    Executes a database query.

    Kept as a separate helper so database-client-specific behavior
    remains isolated.
    """

    return query.execute()


def _response_data(response: Any) -> list[dict[str, Any]]:
    """
    Extracts row data from a database response.

    Supports common Supabase/PostgREST response objects where data is
    available as:

        response.data
    """

    data = getattr(response, "data", None)

    if data is None:
        return []

    if not isinstance(data, list):
        return []

    return data


# ============================================================
# CANDIDATE CONVERSION
# ============================================================

def _medicine_row_to_candidate(
    row: dict[str, Any],
    similarity_score: Optional[float] = None,
    match_reasons: Optional[list[str]] = None,
) -> MedicineCandidate:
    """
    Converts a medicines table row into a MedicineCandidate.
    """

    return MedicineCandidate(
        medicine_id=str(row["id"]),
        canonical_name=row["canonical_name"],
        normalized_name=row["normalized_name"],
        brand_name=row.get("brand_name"),
        generic_name=row.get("generic_name"),
        similarity_score=similarity_score,
        match_reasons=match_reasons or [],
    )


# ============================================================
# EXACT MATCHING
# ============================================================

def _find_exact_normalized_name_match(
    database: Any,
    normalized_name: str,
) -> list[MedicineCandidate]:
    """
    Searches for an exact match using medicines.normalized_name.

    normalized_name has a UNIQUE constraint in the database, so this
    should normally return zero or one record.
    """

    query = (
        _get_table(database, "medicines")
        .select(
            "id, canonical_name, normalized_name, "
            "brand_name, generic_name"
        )
        .eq("normalized_name", normalized_name)
    )

    response = _execute(query)
    rows = _response_data(response)

    return [
        _medicine_row_to_candidate(
            row,
            similarity_score=1.0,
            match_reasons=[
                "Exact match on medicines.normalized_name"
            ],
        )
        for row in rows
    ]


def _find_exact_alias_matches(
    database: Any,
    normalized_name: str,
) -> list[MedicineCandidate]:
    """
    Searches medicine_aliases.normalized_alias for an exact match.

    The alias table allows the same alias for different medicines,
    so this can return multiple candidates.
    """

    query = (
        _get_table(database, "medicine_aliases")
        .select(
            """
            medicine_id,
            alias_name,
            normalized_alias,
            medicines (
                id,
                canonical_name,
                normalized_name,
                brand_name,
                generic_name
            )
            """
        )
        .eq("normalized_alias", normalized_name)
    )

    response = _execute(query)
    rows = _response_data(response)

    candidates: list[MedicineCandidate] = []

    for row in rows:
        medicine = row.get("medicines")

        if not isinstance(medicine, dict):
            continue

        candidate = _medicine_row_to_candidate(
            medicine,
            similarity_score=1.0,
            match_reasons=[
                (
                    "Exact match on medicine_aliases.normalized_alias "
                    f"using alias '{row.get('alias_name')}'"
                )
            ],
        )

        candidates.append(candidate)

    return candidates


# ============================================================
# FIELD-BASED EXACT MATCHING
# ============================================================

def _find_exact_field_matches(
    database: Any,
    record: MedicineRecord,
) -> list[MedicineCandidate]:
    """
    Searches additional medicine identity fields.

    These fields are weaker than normalized_name matching and therefore
    are returned as POSSIBLE candidates rather than automatically being
    treated as exact canonical matches.

    Checked fields:
    - brand_name
    - generic_name
    """

    candidates: list[MedicineCandidate] = []

    search_fields = [
        (
            "brand_name",
            record.brand_name,
        ),
        (
            "generic_name",
            record.generic_name,
        ),
    ]

    for field_name, value in search_fields:

        if not value:
            continue

        query = (
            _get_table(database, "medicines")
            .select(
                "id, canonical_name, normalized_name, "
                "brand_name, generic_name"
            )
            .eq(field_name, value)
        )

        response = _execute(query)
        rows = _response_data(response)

        for row in rows:

            candidate = _medicine_row_to_candidate(
                row,
                similarity_score=None,
                match_reasons=[
                    f"Exact match on medicines.{field_name}"
                ],
            )

            candidates.append(candidate)

    return candidates


# ============================================================
# FUZZY MATCHING
# ============================================================

def _string_similarity(
    value_a: str,
    value_b: str,
) -> float:
    """
    Calculates similarity between two normalized strings.

    Uses Python's standard library so this module does not require
    an additional fuzzy-matching dependency.
    """

    return SequenceMatcher(
        None,
        value_a,
        value_b,
    ).ratio()


def _find_fuzzy_matches(
    database: Any,
    normalized_name: str,
) -> list[MedicineCandidate]:
    """
    Performs controlled fuzzy matching against existing medicines.

    Important:
    Fuzzy matching is only used after exact canonical and alias
    matching have failed.

    The database table is queried for medicine identity fields and
    similarity scoring happens in Python.

    For very large medicine databases, this strategy can later be
    replaced with PostgreSQL pg_trgm similarity search without changing
    the external candidate finder contract.
    """

    query = (
        _get_table(database, "medicines")
        .select(
            "id, canonical_name, normalized_name, "
            "brand_name, generic_name"
        )
    )

    response = _execute(query)
    rows = _response_data(response)

    candidates: list[MedicineCandidate] = []

    for row in rows:

        existing_normalized_name = row.get(
            "normalized_name"
        )

        if not existing_normalized_name:
            continue

        score = _string_similarity(
            normalized_name,
            existing_normalized_name,
        )

        if score < FUZZY_MATCH_THRESHOLD:
            continue

        reasons = [
            (
                "Fuzzy match on medicines.normalized_name "
                f"(score={score:.3f})"
            )
        ]

        candidate = _medicine_row_to_candidate(
            row,
            similarity_score=score,
            match_reasons=reasons,
        )

        candidates.append(candidate)

    candidates.sort(
        key=lambda candidate: (
            candidate.similarity_score
            if candidate.similarity_score is not None
            else 0.0
        ),
        reverse=True,
    )

    return candidates[:MAX_FUZZY_CANDIDATES]


# ============================================================
# CANDIDATE DEDUPLICATION
# ============================================================

def _merge_duplicate_candidates(
    candidates: list[MedicineCandidate],
) -> list[MedicineCandidate]:
    """
    Removes duplicate medicine candidates.

    A medicine can be discovered through multiple matching strategies,
    for example:

    - alias match
    - brand_name match
    - generic_name match

    This function combines all match reasons into one candidate.
    """

    merged: dict[str, MedicineCandidate] = {}

    for candidate in candidates:

        existing = merged.get(
            candidate.medicine_id
        )

        if existing is None:

            merged[
                candidate.medicine_id
            ] = MedicineCandidate(
                medicine_id=candidate.medicine_id,
                canonical_name=candidate.canonical_name,
                normalized_name=candidate.normalized_name,
                brand_name=candidate.brand_name,
                generic_name=candidate.generic_name,
                similarity_score=candidate.similarity_score,
                match_reasons=list(
                    candidate.match_reasons
                ),
            )

            continue

        # Merge match reasons.
        for reason in candidate.match_reasons:

            if reason not in existing.match_reasons:
                existing.match_reasons.append(
                    reason
                )

        # Preserve the highest similarity score.
        if candidate.similarity_score is not None:

            if (
                existing.similarity_score is None
                or candidate.similarity_score
                > existing.similarity_score
            ):
                existing.similarity_score = (
                    candidate.similarity_score
                )

    results = list(merged.values())

    results.sort(
        key=lambda candidate: (
            candidate.similarity_score
            if candidate.similarity_score is not None
            else 0.0
        ),
        reverse=True,
    )

    return results


# ============================================================
# RESULT CLASSIFICATION
# ============================================================

def _classify_candidates(
    candidates: list[MedicineCandidate],
) -> MatchStatus:
    """
    Determines the overall MatchStatus.

    Rules:

    NEW
        No candidates found.

    EXACT_MATCH
        Exactly one candidate with a score of 1.0.

    AMBIGUOUS
        Multiple candidates have equally strong exact matches.

    POSSIBLE_MATCH
        One or more non-exact candidates exist.
    """

    if not candidates:
        return MatchStatus.NEW

    exact_candidates = [
        candidate
        for candidate in candidates
        if candidate.similarity_score == 1.0
    ]

    if len(exact_candidates) == 1:
        return MatchStatus.EXACT_MATCH

    if len(exact_candidates) > 1:
        return MatchStatus.AMBIGUOUS

    return MatchStatus.POSSIBLE_MATCH


# ============================================================
# PUBLIC API
# ============================================================

def find_candidates(
    database: Any,
    record: MedicineRecord,
) -> CandidateSearchResult:
    """
    Finds possible existing medicine records.

    Search strategy:

    1. Exact medicines.normalized_name match
    2. Exact medicine_aliases.normalized_alias match
    3. Exact brand_name / generic_name match
    4. Controlled fuzzy normalized_name matching

    The function stops early when an unambiguous exact canonical match
    is found.

    Parameters
    ----------
    database:
        Configured database client.

    record:
        Validated and normalized MedicineRecord.

    Returns
    -------
    CandidateSearchResult
        Match status and possible existing medicine candidates.
    """

    normalized_name = record.normalized_name

    # Candidate finding requires normalized identity.
    if not normalized_name:

        return CandidateSearchResult(
            match_status=MatchStatus.NEW,
            candidates=[],
        )

    # --------------------------------------------------------
    # 1. Exact canonical match
    # --------------------------------------------------------

    exact_canonical_matches = (
        _find_exact_normalized_name_match(
            database=database,
            normalized_name=normalized_name,
        )
    )

    if len(exact_canonical_matches) == 1:

        return CandidateSearchResult(
            match_status=MatchStatus.EXACT_MATCH,
            candidates=exact_canonical_matches,
        )

    # --------------------------------------------------------
    # 2. Exact alias match
    # --------------------------------------------------------

    alias_matches = _find_exact_alias_matches(
        database=database,
        normalized_name=normalized_name,
    )

    combined_exact_matches = (
        exact_canonical_matches
        + alias_matches
    )

    combined_exact_matches = (
        _merge_duplicate_candidates(
            combined_exact_matches
        )
    )

    if combined_exact_matches:

        return CandidateSearchResult(
            match_status=_classify_candidates(
                combined_exact_matches
            ),
            candidates=combined_exact_matches,
        )

    # --------------------------------------------------------
    # 3. Exact identity field matches
    # --------------------------------------------------------

    field_matches = _find_exact_field_matches(
        database=database,
        record=record,
    )

    if field_matches:

        field_matches = (
            _merge_duplicate_candidates(
                field_matches
            )
        )

        return CandidateSearchResult(
            match_status=MatchStatus.POSSIBLE_MATCH,
            candidates=field_matches,
        )

    # --------------------------------------------------------
    # 4. Fuzzy matching
    # --------------------------------------------------------

    fuzzy_matches = _find_fuzzy_matches(
        database=database,
        normalized_name=normalized_name,
    )

    fuzzy_matches = (
        _merge_duplicate_candidates(
            fuzzy_matches
        )
    )

    if fuzzy_matches:

        return CandidateSearchResult(
            match_status=MatchStatus.POSSIBLE_MATCH,
            candidates=fuzzy_matches,
        )

    # --------------------------------------------------------
    # No candidates
    # --------------------------------------------------------

    return CandidateSearchResult(
        match_status=MatchStatus.NEW,
        candidates=[],
    )

# ============================================================
# CANDIDATE FINDER SERVICE
# ============================================================


class CandidateFinder:
    """
    Service wrapper for medicine candidate searching.

    This class provides the interface expected by pipeline.py while
    keeping the candidate matching logic implemented in the module-level
    helper functions above.

    Example
    -------

    finder = CandidateFinder(database)

    result = finder.find_candidates(record)
    """

    def __init__(self, database: Any) -> None:
        """
        Initialize the candidate finder.

        Parameters
        ----------
        database:
            Configured Supabase/PostgreSQL client.
        """

        self.database = database

    def find_candidates(
        self,
        record: MedicineRecord,
    ) -> CandidateSearchResult:
        """
        Find possible existing medicine records.

        Delegates to the module-level find_candidates() function.
        """

        return find_candidates(
            database=self.database,
            record=record,
        )