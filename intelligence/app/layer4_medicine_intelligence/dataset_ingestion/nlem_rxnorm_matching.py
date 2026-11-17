"""Conservative offline comparison of NLEM formulations to RxNorm exports."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import re
from typing import Any


@dataclass(frozen=True)
class NlemRxNormMatchCounts:
    exact: int
    uncertain: int
    unmatched: int


def compare_nlem_to_rxnorm(
    nlem_payload: dict[str, Any], rxnorm_export_path: str | Path
) -> tuple[dict[str, Any], NlemRxNormMatchCounts]:
    """Classify exact, uncertain, and unmatched records without merging them."""

    rxnorm = json.loads(Path(rxnorm_export_path).read_text(encoding="utf-8"))
    rx_records = rxnorm.get("accepted", [])
    ingredient_index: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    for candidate in rx_records:
        ingredients = _ingredient_names(candidate.get("normalized_record") or {})
        if ingredients:
            ingredient_index[ingredients].append(candidate)

    output = json.loads(json.dumps(nlem_payload))
    exact = uncertain = unmatched = 0
    for entry in output.get("accepted", []):
        medicine = entry.get("normalized_record") or {}
        ingredients = _ingredient_names(medicine)
        candidates = ingredient_index.get(ingredients, [])
        exact_candidates = [item for item in candidates if _same_formulation(medicine, item.get("normalized_record") or {})]
        if len(exact_candidates) == 1:
            status = "exact"
            exact += 1
            selected = [_candidate_reference(exact_candidates[0])]
            reason = "Ingredient identities, ingredient-specific strengths, and dosage form agree."
        elif candidates:
            status = "uncertain"
            uncertain += 1
            selected = [_candidate_reference(item) for item in candidates[:10]]
            reason = "Ingredient identity agrees but strength or dosage form is missing, differs, or is non-unique."
        else:
            status = "unmatched"
            unmatched += 1
            selected = []
            reason = "No RxNorm record has the same verified ingredient identity set."
        entry["rxnorm_comparison"] = {
            "status": status,
            "reason": reason,
            "candidates": selected,
            "does_not_imply_india_approval_or_availability": True,
        }
    output["rxnorm_comparison_summary"] = {
        "exact": exact, "uncertain": uncertain, "unmatched": unmatched,
        "policy": "comparison_only_no_automatic_merge",
    }
    return output, NlemRxNormMatchCounts(exact, uncertain, unmatched)


def _ingredient_names(record: dict[str, Any]) -> tuple[str, ...]:
    names = []
    for item in record.get("ingredients") or []:
        name = (item.get("ingredient") or {}).get("ingredient_name")
        if name:
            names.append(_normalize(name))
    if not names and record.get("generic_name"):
        names = [_normalize(item) for item in re.split(r"\s*\+\s*", record["generic_name"])]
    return tuple(sorted(item for item in names if item))


def _same_formulation(left: dict[str, Any], right: dict[str, Any]) -> bool:
    if not left.get("dosage_form") or not right.get("dosage_form"):
        return False
    if _normalize(left["dosage_form"]) != _normalize(right["dosage_form"]):
        return False
    return _strengths(left) == _strengths(right) and bool(_strengths(left))


def _strengths(record: dict[str, Any]) -> tuple[tuple[str, str], ...]:
    values = []
    for item in record.get("ingredients") or []:
        value = item.get("ingredient_strength_value")
        unit = item.get("ingredient_strength_unit")
        if value is None or not unit:
            return ()
        try:
            normalized_value = format(Decimal(str(value)).normalize(), "f")
        except InvalidOperation:
            return ()
        values.append((normalized_value, _normalize(unit)))
    return tuple(sorted(values))


def _candidate_reference(entry: dict[str, Any]) -> dict[str, Any]:
    fields = entry.get("source_fields") or {}
    return {
        "rxcui": fields.get("source_rxnorm_cui"),
        "rxaui": entry.get("source_record_id"),
        "name": (entry.get("normalized_record") or {}).get("canonical_name"),
    }


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()
