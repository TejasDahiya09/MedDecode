"""
Shared data models for the MedDecode medicine dataset ingestion pipeline.

These models are internal ingestion contracts.

They are intentionally independent from:
- raw CSV column names
- individual CSV dataset schemas
- Supabase/PostgreSQL insertion syntax

Pipeline:

CSV Dataset
    ↓
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
    ↓
Supabase PostgreSQL
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Any, Optional
from uuid import UUID


# ============================================================
# ENUMS
# ============================================================


class ValidationStatus(str, Enum):
    """
    Overall validation result for an ingestion record.
    """

    VALID = "valid"
    WARNING = "warning"
    INVALID = "invalid"


class MatchStatus(str, Enum):
    """
    Result of candidate matching against existing database records.
    """

    NEW = "new"
    EXACT_MATCH = "exact_match"
    POSSIBLE_MATCH = "possible_match"
    AMBIGUOUS = "ambiguous"


class MergeAction(str, Enum):
    """
    Action selected after candidate evaluation.
    """

    INSERT = "insert"
    UPDATE = "update"
    SKIP = "skip"
    REVIEW = "review"


class AliasType(str, Enum):
    """
    Classification of an alternative medicine name.
    """

    BRAND = "brand"
    GENERIC = "generic"
    SPELLING_VARIATION = "spelling_variation"
    SOURCE_ALIAS = "source_alias"
    OTHER = "other"


class Severity(str, Enum):
    """
    Standardized medicine interaction severity.
    """

    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    UNKNOWN = "unknown"


# ============================================================
# SOURCE / RAW CSV INGESTION MODELS
# ============================================================


@dataclass
class SourceMetadata:
    """
    Metadata describing where a record originated.

    This conceptually maps to the medicine_sources table but remains
    independent from database IDs during ingestion.
    """

    source_dataset: str
    source_record_id: Optional[str] = None
    source_url: Optional[str] = None
    source_record_hash: Optional[str] = None
    # Internal provenance retained by offline ingestion. The checked-in
    # database schema does not currently expose columns for these values, so
    # the live writer deliberately does not persist them.
    source_release: Optional[str] = None
    source_authority: Optional[str] = None
    jurisdiction: Optional[str] = None


@dataclass
class RawRecord:
    """
    One record loaded directly from a CSV file.

    No assumptions should be made about CSV column names or source-specific
    structure at this stage.

    mapper.py converts this record into the standardized MedicineRecord.
    """

    data: dict[str, Any]
    source: SourceMetadata
    row_number: Optional[int] = None


# ============================================================
# CORE ENTITY MODELS
# ============================================================


@dataclass
class ManufacturerRecord:
    """
    Standardized manufacturer information.
    """

    name: str
    normalized_name: Optional[str] = None
    country: Optional[str] = None


@dataclass
class ActiveIngredientRecord:
    """
    Standardized active ingredient information.
    """

    ingredient_name: str
    normalized_name: Optional[str] = None
    description: Optional[str] = None


@dataclass
class MedicineIngredientRecord:
    """
    Relationship between a medicine and one active ingredient.

    The ingredient is represented as an object because database UUIDs may not
    exist yet during the early stages of ingestion.
    """

    ingredient: ActiveIngredientRecord

    ingredient_strength_value: Optional[Decimal] = None
    ingredient_strength_unit: Optional[str] = None


@dataclass
class MedicineAliasRecord:
    """
    Alternative name associated with a medicine.
    """

    alias_name: str

    alias_type: Optional[AliasType] = None
    normalized_alias: Optional[str] = None


# ============================================================
# MEDICINE INTELLIGENCE MODELS
# ============================================================


@dataclass
class SideEffectRecord:
    """
    Medicine side effect.
    """

    side_effect: str

    frequency: Optional[str] = None
    source: Optional[str] = None


@dataclass
class PrecautionRecord:
    """
    Medicine precaution.
    """

    precaution: str

    source: Optional[str] = None


@dataclass
class ContraindicationRecord:
    """
    Medicine contraindication.
    """

    contraindication: str

    source: Optional[str] = None


@dataclass
class PriceRecord:
    """
    Medicine price information.

    Prices remain source-specific because the same medicine can have
    different prices depending on package, country, and region.
    """

    price: Decimal
    currency: str

    country: Optional[str] = None
    region: Optional[str] = None

    package_description: Optional[str] = None
    quantity: Optional[Decimal] = None

    source: Optional[str] = None


# ============================================================
# CANONICAL MEDICINE RECORD
# ============================================================


@dataclass
class MedicineRecord:
    """
    Canonical internal representation of a medicine during ingestion.

    This is the central data contract used throughout the CSV ingestion
    pipeline.

    Different CSV datasets may have completely different column names,
    but mapper.py converts them into this standardized representation.
    """

    # --------------------------------------------------------
    # Core identity
    # --------------------------------------------------------

    canonical_name: str

    # Filled by normalizer.py before database writing.
    normalized_name: Optional[str] = None

    brand_name: Optional[str] = None
    generic_name: Optional[str] = None

    medicine_type: Optional[str] = None
    category: Optional[str] = None

    # --------------------------------------------------------
    # Description / purpose
    # --------------------------------------------------------

    description: Optional[str] = None
    purpose: Optional[str] = None

    # --------------------------------------------------------
    # Pharmaceutical information
    # --------------------------------------------------------

    dosage_form: Optional[str] = None

    strength_value: Optional[Decimal] = None
    strength_unit: Optional[str] = None

    prescription_required: Optional[bool] = None

    usage_instructions: Optional[str] = None
    storage_information: Optional[str] = None

    # --------------------------------------------------------
    # Geographic information
    # --------------------------------------------------------

    country: Optional[str] = None
    currency: Optional[str] = None

    # --------------------------------------------------------
    # General / legacy cost information
    # --------------------------------------------------------

    average_cost: Optional[Decimal] = None

    # --------------------------------------------------------
    # Optional medicine image
    # --------------------------------------------------------

    image_url: Optional[str] = None

    # --------------------------------------------------------
    # Manufacturer
    # --------------------------------------------------------

    manufacturer: Optional[ManufacturerRecord] = None

    # --------------------------------------------------------
    # Related information
    # --------------------------------------------------------

    ingredients: list[MedicineIngredientRecord] = field(
        default_factory=list
    )

    aliases: list[MedicineAliasRecord] = field(
        default_factory=list
    )

    side_effects: list[SideEffectRecord] = field(
        default_factory=list
    )

    precautions: list[PrecautionRecord] = field(
        default_factory=list
    )

    contraindications: list[ContraindicationRecord] = field(
        default_factory=list
    )

    prices: list[PriceRecord] = field(
        default_factory=list
    )

    # --------------------------------------------------------
    # Provenance
    # --------------------------------------------------------

    sources: list[SourceMetadata] = field(
        default_factory=list
    )


# ============================================================
# INTERACTION / SIMILARITY MODELS
# ============================================================


@dataclass
class MedicineInteractionRecord:
    """
    Standardized interaction between two medicines.

    Database IDs are intentionally not stored here because CSV ingestion
    may process interaction records before canonical medicine UUIDs are
    resolved.
    """

    medicine_a_normalized_name: str
    medicine_b_normalized_name: str

    severity: Optional[Severity] = None
    description: Optional[str] = None
    source: Optional[str] = None


@dataclass
class MedicineSimilarityRecord:
    """
    Standardized relationship between two medicines.

    Similarity records should generally be created only after canonical
    medicine matching is complete.
    """

    medicine_normalized_name: str
    similar_medicine_normalized_name: str

    similarity_type: Optional[str] = None
    similarity_score: Optional[Decimal] = None
    reason: Optional[str] = None


# ============================================================
# VALIDATION MODELS
# ============================================================


@dataclass
class ValidationIssue:
    """
    One validation issue detected during ingestion.
    """

    field_name: str
    message: str
    value: Any = None


@dataclass
class ValidationResult:
    """
    Result returned by validator.py.
    """

    status: ValidationStatus

    errors: list[ValidationIssue] = field(
        default_factory=list
    )

    warnings: list[ValidationIssue] = field(
        default_factory=list
    )

    @property
    def is_valid(self) -> bool:
        """
        Returns True when no validation errors exist.
        """

        return len(self.errors) == 0


# ============================================================
# CANDIDATE MATCHING MODELS
# ============================================================


@dataclass
class MedicineCandidate:
    """
    Possible existing medicine match found in Supabase/PostgreSQL.
    """

    medicine_id: UUID

    canonical_name: str
    normalized_name: str

    brand_name: Optional[str] = None
    generic_name: Optional[str] = None

    similarity_score: Optional[float] = None

    match_reasons: list[str] = field(
        default_factory=list
    )


@dataclass
class CandidateSearchResult:
    """
    Result returned by candidate_finder.py.
    """

    match_status: MatchStatus

    candidates: list[MedicineCandidate] = field(
        default_factory=list
    )


# ============================================================
# MERGE MODELS
# ============================================================


@dataclass
class MergeDecision:
    """
    Final decision returned by merger.py.

    INSERT:
        Create a new canonical medicine.

    UPDATE:
        Merge incoming information into an existing medicine.

    SKIP:
        Ignore the incoming record.

    REVIEW:
        Do not automatically write the record because human review
        is required.
    """

    action: MergeAction

    target_medicine_id: Optional[UUID] = None

    record: Optional[MedicineRecord] = None

    reason: Optional[str] = None


# ============================================================
# PIPELINE RESULT MODEL
# ============================================================


@dataclass
class PipelineResult:
    """
    Final result for one processed CSV row.

    Used by pipeline.py for reporting, logging, debugging,
    and ingestion statistics.
    """

    raw_record: RawRecord

    medicine: Optional[MedicineRecord] = None

    validation: Optional[ValidationResult] = None

    candidate_result: Optional[CandidateSearchResult] = None

    merge_decision: Optional[MergeDecision] = None

    success: bool = False

    error_message: Optional[str] = None
