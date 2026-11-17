"""Streaming RxNorm relationship enrichment for accepted medicine records.

RxNorm's RXNREL relationship label describes RXCUI2 relative to RXCUI1.
This module normalizes the inverse rows present in the release into a single
medicine -> component -> ingredient representation and uses RXNSAT BOSS
attributes for ingredient-specific strength.  It never infers a missing
clinical value from free text.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
from typing import Any, Iterable, Iterator


RXNREL_RRF_COLUMNS = (
    "RXCUI1", "RXAUI1", "STYPE1", "REL", "RXCUI2", "RXAUI2", "STYPE2",
    "RELA", "RUI", "SRUI", "SAB", "SL", "DIR", "RG", "SUPPRESS", "CVF",
)
RXNSAT_RRF_COLUMNS = (
    "RXCUI", "LUI", "SUI", "RXAUI", "STYPE", "CODE", "ATUI", "SATUI",
    "ATN", "SAB", "ATV", "SUPPRESS", "CVF",
)
RXNCONSO_RRF_COLUMNS = (
    "RXCUI", "LAT", "TS", "LUI", "STT", "SUI", "ISPREF", "RXAUI",
    "SAUI", "SCUI", "SDUI", "SAB", "TTY", "CODE", "STR", "SRL",
    "SUPPRESS", "CVF",
)

_COMPONENT_TTYS = frozenset({"SCDC", "SBDC"})
_INGREDIENT_TTYS = frozenset({"IN", "PIN", "MIN"})
_DOSAGE_FORM_TTYS = frozenset({"DF"})
_STRENGTH_ATTRIBUTES = frozenset({
    "RXN_BOSS_STRENGTH_NUM_VALUE", "RXN_BOSS_STRENGTH_NUM_UNIT",
    "RXN_BOSS_STRENGTH_DENOM_VALUE", "RXN_BOSS_STRENGTH_DENOM_UNIT",
})


@dataclass(frozen=True)
class ConceptAtom:
    rxcui: str
    rxaui: str
    tty: str
    name: str


@dataclass(frozen=True)
class RelationEvidence:
    source_file: str
    source_concept_id: str
    target_concept_id: str
    relation: str
    relationship_id: str
    release: str


@dataclass
class EnrichmentStats:
    records: int = 0
    ingredient_records: int = 0
    strength_records: int = 0
    dosage_form_records: int = 0
    conflicts: int = 0
    unknowns: int = 0
    malformed_relationship_rows: int = 0
    malformed_attribute_rows: int = 0


@dataclass
class _Indexes:
    components: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    dosage_forms: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    ingredients: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    precise_ingredients: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    brands: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    evidence: dict[tuple[str, str, str], list[RelationEvidence]] = field(
        default_factory=lambda: defaultdict(list)
    )
    malformed_relationship_rows: int = 0


def enrich_rxnorm_dry_run_export(
    dry_run_path: str | Path,
    *,
    rxnconso_path: str | Path,
    rxnrel_path: str | Path,
    rxnsat_path: str | Path,
    release: str,
    export_path: str | Path | None = None,
) -> tuple[dict[str, Any], EnrichmentStats]:
    """Enrich an existing accepted RxNorm dry-run export, entirely offline."""

    dry_run = json.loads(Path(dry_run_path).read_text(encoding="utf-8"))
    accepted = dry_run.get("accepted")
    if not isinstance(accepted, list):
        raise ValueError("RxNorm dry-run export must contain an accepted list.")
    target_ids = {
        str(entry.get("source_fields", {}).get("source_rxnorm_cui") or "").strip()
        for entry in accepted
    }
    target_ids.discard("")

    indexes = _scan_medicine_relationships(Path(rxnrel_path), target_ids, release)
    component_ids = set().union(*indexes.components.values()) if indexes.components else set()
    _scan_component_relationships(Path(rxnrel_path), component_ids, indexes, release)

    related_ids = set(target_ids) | component_ids
    related_ids.update(set().union(*indexes.ingredients.values()) if indexes.ingredients else set())
    related_ids.update(
        set().union(*indexes.precise_ingredients.values()) if indexes.precise_ingredients else set()
    )
    related_ids.update(set().union(*indexes.dosage_forms.values()) if indexes.dosage_forms else set())
    related_ids.update(set().union(*indexes.brands.values()) if indexes.brands else set())
    concepts = _scan_concepts(Path(rxnconso_path), related_ids)
    attributes, malformed_attributes = _scan_strength_attributes(Path(rxnsat_path), component_ids)

    stats = EnrichmentStats(
        records=len(accepted),
        malformed_relationship_rows=indexes.malformed_relationship_rows,
        malformed_attribute_rows=malformed_attributes,
    )
    enriched: list[dict[str, Any]] = []
    for entry in accepted:
        enriched.append(_enrich_entry(entry, concepts, indexes, attributes, release, stats))

    payload = dict(dry_run)
    payload["mode"] = "offline_dry_run_rxnorm_enriched"
    payload["accepted"] = enriched
    payload["enrichment_summary"] = {
        "records": stats.records,
        "with_verified_ingredients": stats.ingredient_records,
        "with_verified_ingredient_strengths": stats.strength_records,
        "with_verified_dosage_forms": stats.dosage_form_records,
        "conflicts": stats.conflicts,
        "unknowns": stats.unknowns,
        "malformed_relationship_rows": stats.malformed_relationship_rows,
        "malformed_attribute_rows": stats.malformed_attribute_rows,
        "source_files": ["RXNCONSO.RRF", "RXNREL.RRF", "RXNSAT.RRF"],
        "release": release,
    }
    if export_path is not None:
        output = Path(export_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload, stats


def _rrf_rows(path: Path, columns: tuple[str, ...]) -> Iterator[tuple[dict[str, str], bool]]:
    if not path.is_file() or path.suffix.casefold() != ".rrf":
        raise FileNotFoundError(f"Required RxNorm RRF file is unavailable: {path}")
    with path.open("r", encoding="utf-8", newline="") as stream:
        for line in stream:
            parts = line.rstrip("\r\n").split("|")
            if parts and parts[-1] == "":
                parts.pop()
            malformed = len(parts) != len(columns)
            yield ({name: parts[i] if i < len(parts) else "" for i, name in enumerate(columns)}, malformed)


def _scan_medicine_relationships(path: Path, targets: set[str], release: str) -> _Indexes:
    indexes = _Indexes()
    for row, malformed in _rrf_rows(path, RXNREL_RRF_COLUMNS):
        if malformed:
            indexes.malformed_relationship_rows += 1
            continue
        if row["SAB"] != "RXNORM" or row["SUPPRESS"] not in {"", "N"}:
            continue
        c1, c2, relation = row["RXCUI1"], row["RXCUI2"], row["RELA"]
        if c1 in targets:
            if relation == "constitutes":
                _add_relation(indexes, "component", c1, c2, row, release)
            elif relation == "dose_form_of":
                _add_relation(indexes, "dosage_form", c1, c2, row, release)
            elif relation in {"has_tradename", "tradename_of"}:
                _add_relation(indexes, "brand", c1, c2, row, release)
        if c2 in targets:
            if relation == "consists_of":
                _add_relation(indexes, "component", c2, c1, row, release)
            elif relation == "has_dose_form":
                _add_relation(indexes, "dosage_form", c2, c1, row, release)
            elif relation in {"has_tradename", "tradename_of"}:
                _add_relation(indexes, "brand", c2, c1, row, release)
    return indexes


def _scan_component_relationships(
    path: Path, components: set[str], indexes: _Indexes, release: str
) -> None:
    for row, malformed in _rrf_rows(path, RXNREL_RRF_COLUMNS):
        if malformed:
            continue
        if row["SAB"] != "RXNORM" or row["SUPPRESS"] not in {"", "N"}:
            continue
        c1, c2, relation = row["RXCUI1"], row["RXCUI2"], row["RELA"]
        if c1 in components and relation == "ingredient_of":
            _add_relation(indexes, "ingredient", c1, c2, row, release)
        elif c2 in components and relation == "has_ingredient":
            _add_relation(indexes, "ingredient", c2, c1, row, release)
        elif c1 in components and relation == "precise_ingredient_of":
            _add_relation(indexes, "precise_ingredient", c1, c2, row, release)
        elif c2 in components and relation == "has_precise_ingredient":
            _add_relation(indexes, "precise_ingredient", c2, c1, row, release)


def _add_relation(
    indexes: _Indexes, kind: str, source: str, target: str,
    row: dict[str, str], release: str,
) -> None:
    collection = {
        "component": indexes.components,
        "dosage_form": indexes.dosage_forms,
        "ingredient": indexes.ingredients,
        "precise_ingredient": indexes.precise_ingredients,
        "brand": indexes.brands,
    }[kind]
    collection[source].add(target)
    evidence = RelationEvidence(
        source_file="RXNREL.RRF",
        source_concept_id=source,
        target_concept_id=target,
        relation=row["RELA"],
        relationship_id=row["RUI"],
        release=release,
    )
    if evidence not in indexes.evidence[(kind, source, target)]:
        indexes.evidence[(kind, source, target)].append(evidence)


def _scan_concepts(path: Path, concept_ids: set[str]) -> dict[str, ConceptAtom]:
    candidates: dict[str, list[ConceptAtom]] = defaultdict(list)
    for row, malformed in _rrf_rows(path, RXNCONSO_RRF_COLUMNS):
        if malformed or row["RXCUI"] not in concept_ids:
            continue
        if row["SAB"] != "RXNORM" or row["SUPPRESS"] not in {"", "N"} or row["LAT"] != "ENG":
            continue
        candidates[row["RXCUI"]].append(ConceptAtom(
            row["RXCUI"], row["RXAUI"], row["TTY"], row["STR"]
        ))
    priority = {"SCD": 0, "SBD": 0, "SCDC": 0, "SBDC": 0, "IN": 0, "PIN": 0, "MIN": 0, "DF": 0}
    return {
        cui: sorted(atoms, key=lambda atom: (priority.get(atom.tty, 10), atom.rxaui))[0]
        for cui, atoms in candidates.items()
    }


def _scan_strength_attributes(
    path: Path, component_ids: set[str]
) -> tuple[dict[str, dict[str, set[str]]], int]:
    values: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    malformed_count = 0
    for row, malformed in _rrf_rows(path, RXNSAT_RRF_COLUMNS):
        if malformed:
            malformed_count += 1
            continue
        if row["RXCUI"] not in component_ids or row["ATN"] not in _STRENGTH_ATTRIBUTES:
            continue
        if row["SAB"] != "RXNORM" or row["SUPPRESS"] not in {"", "N"}:
            continue
        values[row["RXCUI"]][row["ATN"]].add(row["ATV"])
    return values, malformed_count


def _enrich_entry(
    entry: dict[str, Any], concepts: dict[str, ConceptAtom], indexes: _Indexes,
    attributes: dict[str, dict[str, set[str]]], release: str, stats: EnrichmentStats,
) -> dict[str, Any]:
    result = json.loads(json.dumps(entry))
    medicine = result.get("normalized_record") or {}
    cui = str(result.get("source_fields", {}).get("source_rxnorm_cui") or "")
    provenance: dict[str, list[dict[str, Any]]] = defaultdict(list)
    conflicts: list[str] = []
    unknowns: list[str] = []

    forms = []
    for form_id in sorted(indexes.dosage_forms.get(cui, set())):
        atom = concepts.get(form_id)
        if atom and atom.tty in _DOSAGE_FORM_TTYS:
            forms.append(atom)
            provenance["dosage_form"].extend(
                _evidence_dicts(indexes.evidence[("dosage_form", cui, form_id)])
            )
    unique_forms = {atom.name for atom in forms}
    if len(unique_forms) == 1:
        medicine["dosage_form"] = next(iter(unique_forms))
        stats.dosage_form_records += 1
    elif len(unique_forms) > 1:
        medicine["dosage_form"] = None
        conflicts.append("Multiple official dosage-form relationships disagree.")
    else:
        medicine["dosage_form"] = None
        unknowns.append("No supported RxNorm dosage-form relationship was found.")

    ingredients: list[dict[str, Any]] = []
    seen_ingredients: set[tuple[str, str]] = set()
    strength_complete = True
    all_component_ids = sorted(indexes.components.get(cui, set()))
    # Branded drugs commonly carry both an SCDC (clinical ingredient/strength)
    # and an SBDC (brand component).  The latter relates to a BN rather than an
    # active ingredient, so prefer SCDC components whenever the release supplies
    # them instead of treating the brand-name relationship as clinical content.
    clinical_components = [
        item for item in all_component_ids
        if item in concepts and concepts[item].tty == "SCDC"
    ]
    component_ids = clinical_components or [
        item for item in all_component_ids
        if item in concepts and concepts[item].tty in _COMPONENT_TTYS
    ]
    if not component_ids:
        unknowns.append("No supported RxNorm clinical-drug component relationship was found.")
        strength_complete = False
    for component_id in component_ids:
        component = concepts.get(component_id)
        if component is None or component.tty not in _COMPONENT_TTYS:
            unknowns.append(f"Component {component_id} has no supported RxNorm SCDC/SBDC atom.")
            strength_complete = False
            continue
        base_ingredient_ids = sorted(indexes.ingredients.get(component_id, set()))
        precise_ingredient_ids = sorted(indexes.precise_ingredients.get(component_id, set()))
        # A precise ingredient (PIN, such as a salt) is the formulation-facing
        # identity when RxNorm supplies exactly one.  The base IN relationship is
        # retained separately so no official identity is lost.
        ingredient_ids = precise_ingredient_ids or base_ingredient_ids
        ingredient_atoms = [
            concepts[item] for item in ingredient_ids
            if item in concepts and concepts[item].tty in _INGREDIENT_TTYS
        ]
        if len(ingredient_atoms) != 1:
            reason = "no" if not ingredient_atoms else "multiple"
            unknowns.append(f"Component {component_id} has {reason} unambiguous official ingredient relationship.")
            strength_complete = False
            continue
        ingredient = ingredient_atoms[0]
        strength_value, strength_unit, strength_reason = _component_strength(attributes.get(component_id, {}))
        if strength_reason:
            unknowns.append(f"Component {component_id}: {strength_reason}")
            strength_complete = False
        key = (ingredient.rxcui, component_id)
        if key in seen_ingredients:
            continue
        seen_ingredients.add(key)
        ingredients.append({
            "ingredient": {
                "ingredient_name": ingredient.name,
                "normalized_name": ingredient.name.casefold(),
                "description": None,
            },
            "ingredient_strength_value": strength_value,
            "ingredient_strength_unit": strength_unit,
            "rxnorm_ingredient_cui": ingredient.rxcui,
            "rxnorm_ingredient_atom_id": ingredient.rxaui,
            "rxnorm_component_cui": component_id,
            "rxnorm_base_ingredient_cuis": base_ingredient_ids,
        })
        provenance["ingredients"].extend(
            _evidence_dicts(indexes.evidence[("component", cui, component_id)])
        )
        provenance["ingredients"].extend(
            _evidence_dicts(indexes.evidence[(
                "precise_ingredient" if precise_ingredient_ids else "ingredient",
                component_id,
                ingredient.rxcui,
            )])
        )
        if strength_value is not None:
            provenance["ingredient_strengths"].append({
                "source_file": "RXNSAT.RRF",
                "source_concept_id": component_id,
                "source_atom_id": component.rxaui,
                "attributes": sorted(_STRENGTH_ATTRIBUTES),
                "release": release,
            })

    medicine["ingredients"] = ingredients
    if ingredients:
        stats.ingredient_records += 1
    if ingredients and strength_complete and all(
        item["ingredient_strength_value"] is not None and item["ingredient_strength_unit"]
        for item in ingredients
    ):
        stats.strength_records += 1

    brand_relations = []
    for related_id in sorted(indexes.brands.get(cui, set())):
        atom = concepts.get(related_id)
        if atom:
            brand_relations.append({"rxcui": atom.rxcui, "rxaui": atom.rxaui, "tty": atom.tty, "name": atom.name})
            provenance["brand_generic_relationships"].extend(
                _evidence_dicts(indexes.evidence[("brand", cui, related_id)])
            )

    stats.conflicts += len(conflicts)
    stats.unknowns += len(unknowns)
    result["normalized_record"] = medicine
    result["enrichment"] = {
        "source_release": release,
        "field_provenance": dict(provenance),
        "brand_generic_relationships": brand_relations,
        "conflicts": conflicts,
        "unknown_reasons": unknowns,
    }
    return result


def _component_strength(values: dict[str, set[str]]) -> tuple[str | None, str | None, str | None]:
    keys = (
        "RXN_BOSS_STRENGTH_NUM_VALUE", "RXN_BOSS_STRENGTH_NUM_UNIT",
        "RXN_BOSS_STRENGTH_DENOM_VALUE", "RXN_BOSS_STRENGTH_DENOM_UNIT",
    )
    selected: dict[str, str] = {}
    for key in keys:
        candidates = {item.strip() for item in values.get(key, set()) if item.strip()}
        if len(candidates) > 1:
            return None, None, f"Conflicting {key} values were retained as unknown."
        if candidates:
            selected[key] = next(iter(candidates))
    if not all(key in selected for key in keys):
        return None, None, "Official BOSS numerator/denominator strength attributes are incomplete."
    try:
        numerator = Decimal(selected[keys[0]])
        denominator = Decimal(selected[keys[2]])
    except InvalidOperation:
        return None, None, "Official BOSS strength contains a non-decimal value."
    if numerator <= 0 or denominator <= 0:
        return None, None, "Official BOSS strength contains a non-positive value."
    value = format(numerator, "f")
    num_unit = selected[keys[1]]
    den_value = format(denominator, "f")
    den_unit = selected[keys[3]]
    if denominator == 1 and den_unit == "1":
        unit = num_unit
    elif denominator == 1:
        unit = f"{num_unit}/{den_unit}"
    else:
        unit = f"{num_unit}/{den_value} {den_unit}"
    return value, unit, None


def _evidence_dicts(items: Iterable[RelationEvidence]) -> list[dict[str, str]]:
    return [
        {
            "source_file": item.source_file,
            "source_concept_id": item.source_concept_id,
            "target_concept_id": item.target_concept_id,
            "relation": item.relation,
            "relationship_id": item.relationship_id,
            "release": item.release,
        }
        for item in items
    ]
