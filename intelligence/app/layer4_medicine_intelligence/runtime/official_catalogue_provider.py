"""Read-only, strict official-catalogue lookup for local Layer 4 composition.

It is deliberately separate from the current Supabase MedicineRepository until
the additive schema is reviewed for a hosted deployment.
"""
from __future__ import annotations
from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Any, Protocol
from uuid import UUID

from .schemas import CandidateIngredient, MedicineCandidate

class Cursor(Protocol):
    def execute(self, statement: str, parameters: tuple[Any, ...] = ()) -> Any: ...
    def fetchall(self) -> list[tuple[Any, ...]]: ...
class Connection(Protocol):
    def cursor(self) -> Cursor: ...
@dataclass(frozen=True)
class OfficialCatalogueLookup:
    status: str
    evidence: tuple[dict[str, Any], ...]
    warning: str | None = None

class OfficialCatalogueProvider:
    def __init__(self, connection: Connection): self._connection = connection
    def find_exact_formulation(self, *, ingredients: list[dict[str, Any]], dosage_form: str | None, release_type: str | None = None) -> OfficialCatalogueLookup:
        if not ingredients or not dosage_form or any(not item.get('name') or item.get('strength_value') is None or not item.get('strength_unit') for item in ingredients):
            return OfficialCatalogueLookup('unresolved', (), 'Official catalogue exact matching requires ingredient-specific strength and dosage form.')
        identity = {'ingredients': sorted(ingredients, key=lambda value: json.dumps(value, sort_keys=True)), 'dosage_form': dosage_form.strip().casefold(), 'release_type': release_type.strip().casefold() if release_type else None}
        digest = sha256(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        cursor = self._connection.cursor()
        cursor.execute("SELECT evidence FROM official_catalogue.catalogue_entities WHERE entity_type = 'formulation' AND identity_hash = %s", (digest,))
        rows = cursor.fetchall()
        if not rows: return OfficialCatalogueLookup('unresolved', (), 'No exact official formulation evidence was found.')
        evidence = tuple(row[0] if isinstance(row[0], dict) else json.loads(row[0]) for row in rows)
        if len(evidence) != 1: return OfficialCatalogueLookup('ambiguous', evidence, 'Multiple official source records match exactly; no canonical medicine was selected.')
        return OfficialCatalogueLookup('matched', evidence)


class LocalOfficialCatalogueMedicineRepository:
    """Read-only Layer 4 repository backed only by ``official_catalogue``.

    It never queries application medicine tables, never offers alternatives,
    and deliberately returns no price/package relationship because those links
    are not populated in the local catalogue import.
    """
    def __init__(self, connection: Connection, max_search_results: int = 25):
        self._connection, self.max_search_results = connection, max_search_results

    def find_by_normalized_name(self, value: str) -> list[MedicineCandidate]:
        return self._find(value)
    def find_by_alias(self, value: str) -> list[MedicineCandidate]: return []
    def find_by_brand_name(self, value: str) -> list[MedicineCandidate]: return []
    def find_by_generic_name(self, value: str) -> list[MedicineCandidate]: return self._find(value)
    def search_name_prefix(self, value: str) -> list[MedicineCandidate]: return self._find(value, prefix=True)
    def enrich_with_ingredients(self, candidates: list[MedicineCandidate]) -> list[MedicineCandidate]: return candidates

    def _find(self, value: str, prefix: bool = False) -> list[MedicineCandidate]:
        needle = value.strip().casefold()
        if not needle: return []
        cursor = self._connection.cursor()
        if prefix:
            cursor.execute("SELECT entity_id,evidence,identity FROM official_catalogue.catalogue_entities WHERE entity_type='formulation' AND lower(coalesce(evidence->>'normalized_name', evidence->>'canonical_name','')) LIKE %s ORDER BY entity_id LIMIT %s", (f'{needle}%', self.max_search_results))
        else:
            cursor.execute("SELECT entity_id,evidence,identity FROM official_catalogue.catalogue_entities WHERE entity_type='formulation' AND lower(coalesce(evidence->>'normalized_name', evidence->>'canonical_name','')) = %s ORDER BY entity_id LIMIT %s", (needle, self.max_search_results))
        return [self._candidate(row) for row in cursor.fetchall()]

    @staticmethod
    def _candidate(row: tuple[Any, ...]) -> MedicineCandidate:
        entity_id, evidence, identity = row
        evidence = evidence if isinstance(evidence, dict) else json.loads(evidence)
        identity = identity if isinstance(identity, dict) else json.loads(identity)
        ingredients = [
            CandidateIngredient(UUID(str(uuid5_from_entity(entity_id, item['name']))), item['name'], item['name'], _number(item.get('strength_value')), item.get('strength_unit'))
            for item in identity.get('ingredients', []) if item.get('name')
        ]
        return MedicineCandidate(UUID(str(entity_id)), str(evidence.get('canonical_name') or ''), str(evidence.get('normalized_name') or evidence.get('canonical_name','')).casefold(), evidence.get('brand_name'), evidence.get('generic_name'), evidence.get('dosage_form'), _number(evidence.get('strength_value')), evidence.get('strength_unit'), 'official_catalogue_evidence', None, ingredients)

def uuid5_from_entity(entity_id: Any, ingredient_name: str) -> str:
    from uuid import NAMESPACE_URL, uuid5
    return str(uuid5(NAMESPACE_URL, f'meddecode:official-ingredient:{entity_id}:{ingredient_name}'))

def _number(value: Any) -> float | None:
    try: return float(value) if value is not None else None
    except (TypeError, ValueError): return None
