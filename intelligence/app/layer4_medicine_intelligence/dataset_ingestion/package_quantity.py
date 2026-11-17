"""Strict parsing of explicit package quantities from official source fields."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import re


@dataclass(frozen=True)
class ExplicitPackageQuantity:
    quantity: Decimal
    unit: str
    special_feature_qualifier: str | None = None


_UNIT_PATTERN = (
    r"tablets?|tabs?|capsules?|caps?|vials?|ampoules?|ampules?|"
    r"millilit(?:er|re)s?|ml|lit(?:er|re)s?|l|grams?|g|mg|"
    r"units?|pieces?|strips?"
)
_QUANTITY_UNIT = re.compile(
    rf"^\s*(?P<quantity>\d+(?:\.\d+)?)\s*(?P<unit>{_UNIT_PATTERN})"
    r"(?:\s+(?:vial|bottle|ampoule|ampule))?\s*$",
    re.IGNORECASE,
)
_BOTTLE_OF_UNITS = re.compile(
    r"^\s*bottle\s+of\s+(?P<quantity>\d+(?:\.\d+)?)\s*"
    r"(?P<unit>tablets?|capsules?|units?|pieces?)\s*$",
    re.IGNORECASE,
)
_COUNT_SHORTHAND = re.compile(r"^\s*(?P<quantity>\d+)\s*['’]s\s*$")
_SPECIAL_FEATURE = re.compile(
    rf"^\s*(?P<quantity>\d+(?:\.\d+)?)\s*"
    r"(?P<unit>ml|milliliters?|millilitres?|g|grams?)\s+"
    r"(?P<qualifier>.+?\bwith\s+special\s+features?)\s*$",
    re.IGNORECASE,
)


def parse_explicit_package_quantity(
    value: str | None,
    *,
    allow_count_shorthand: bool = False,
    special_feature: bool = False,
) -> ExplicitPackageQuantity | None:
    """Parse only complete, unambiguous source package formats."""
    text = " ".join((value or "").split())
    if not text:
        return None

    match = _SPECIAL_FEATURE.fullmatch(text) if special_feature else None
    if match:
        result = _build(
            match.group("quantity"),
            match.group("unit"),
            match.group("qualifier"),
        )
        if result:
            return result

    match = _QUANTITY_UNIT.fullmatch(text) or _BOTTLE_OF_UNITS.fullmatch(text)
    if match:
        return _build(match.group("quantity"), match.group("unit"))

    if allow_count_shorthand:
        match = _COUNT_SHORTHAND.fullmatch(text)
        if match:
            return _build(match.group("quantity"), "units")
    return None


def _build(
    raw_quantity: str,
    raw_unit: str,
    qualifier: str | None = None,
) -> ExplicitPackageQuantity | None:
    try:
        quantity = Decimal(raw_quantity)
    except InvalidOperation:
        return None
    if not quantity.is_finite() or quantity <= 0:
        return None

    unit = _canonical_unit(raw_unit)
    if unit is None:
        return None
    clean_qualifier = " ".join(qualifier.split()) if qualifier else None
    return ExplicitPackageQuantity(quantity, unit, clean_qualifier)


def _canonical_unit(value: str) -> str | None:
    unit = value.casefold()
    if unit in {"tablet", "tablets", "tab", "tabs"}:
        return "tablets"
    if unit in {"capsule", "capsules", "cap", "caps"}:
        return "capsules"
    if unit in {"vial", "vials"}:
        return "vials"
    if unit in {"ampoule", "ampoules", "ampule", "ampules"}:
        return "ampoules"
    if unit in {"ml", "milliliter", "milliliters", "millilitre", "millilitres"}:
        return "mL"
    if unit in {"l", "liter", "liters", "litre", "litres"}:
        return "L"
    if unit in {"g", "gram", "grams"}:
        return "g"
    if unit == "mg":
        return "mg"
    if unit in {"unit", "units", "piece", "pieces"}:
        return "units"
    if unit in {"strip", "strips"}:
        return "strips"
    return None
