"""Conservative, offline assessment of official price-to-formulation links."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal

from .catalogue_import_preparation import (
    CatalogueCandidate,
    CataloguePreparationReport,
    PreparedSourceRecord,
)


PriceLinkStatus = Literal["eligible", "ambiguous", "conflict", "incomplete", "unmatched"]

_SOURCE_PRICE_BASES = {
    "india_nppa_standard_ceiling_prices": "ceiling_price_excluding_taxes",
    "india_nppa_special_feature_ceiling_prices": "special_feature_ceiling_price",
    "india_nppa_anticancer_revised_mrp": "revised_mrp",
    "india_pmbi_product_catalogue": "pmbi_listed_mrp",
}


@dataclass(frozen=True)
class PriceLinkDecision:
    price_candidate_id: str
    source_record_stable_id: str
    price_basis: str
    status: PriceLinkStatus
    reason: str
    formulation_candidate_id: str | None = None
    package_candidate_id: str | None = None
    product_candidate_id: str | None = None
    product_identifier: str | None = None


def assess_price_linkages(report: CataloguePreparationReport) -> list[PriceLinkDecision]:
    """Assess candidate links without writing or promoting any database records.

    All matches are constrained to the exact source record. This intentionally
    does not use medicine-name similarity or raw candidate evidence.
    """

    records: dict[str, list[PreparedSourceRecord]] = {}
    for record in report.source_records:
        records.setdefault(record.stable_id, []).append(record)

    candidates: dict[str, dict[str, list[CatalogueCandidate]]] = {}
    for candidate in report.candidates:
        by_type = candidates.setdefault(candidate.source_record_stable_id, {})
        by_type.setdefault(candidate.entity_type, []).append(candidate)

    conflicted_records = {
        item.get("stable_id", "") for item in report.conflicting_replays
    }
    decisions = [
        _assess_one(
            candidate,
            records.get(candidate.source_record_stable_id, []),
            candidates.get(candidate.source_record_stable_id, {}),
            candidate.source_record_stable_id in conflicted_records,
        )
        for candidate in report.candidates
        if candidate.entity_type == "price_observation"
    ]
    return sorted(decisions, key=lambda item: item.price_candidate_id)


def _assess_one(
    price: CatalogueCandidate,
    source_records: list[PreparedSourceRecord],
    candidates: dict[str, list[CatalogueCandidate]],
    has_conflicting_replay: bool,
) -> PriceLinkDecision:
    identity = price.identity
    basis = str(identity.get("price_basis") or "unknown")
    stable_id = price.source_record_stable_id

    def result(
        status: PriceLinkStatus,
        reason: str,
        *,
        formulation: CatalogueCandidate | None = None,
        package: CatalogueCandidate | None = None,
        product: CatalogueCandidate | None = None,
        product_identifier: str | None = None,
    ) -> PriceLinkDecision:
        return PriceLinkDecision(
            price_candidate_id=price.candidate_id,
            source_record_stable_id=stable_id,
            price_basis=basis,
            status=status,
            reason=reason,
            formulation_candidate_id=formulation.candidate_id if formulation else None,
            package_candidate_id=package.candidate_id if package else None,
            product_candidate_id=product.candidate_id if product else None,
            product_identifier=product_identifier,
        )

    if len(source_records) != 1:
        return result("conflict", "source record identity is missing or duplicated")
    record = source_records[0]
    if has_conflicting_replay:
        return result("conflict", "the source record has a conflicting content replay")
    if (
        identity.get("source_dataset") != record.source_dataset
        or identity.get("source_release") != record.source_release
    ):
        return result("conflict", "price source dataset or release differs from its source record")
    if not identity.get("source_record_id"):
        return result("incomplete", "price has no explicit source record identifier")
    if identity.get("source_record_id") != record.source_record_id:
        return result("conflict", "price source record identifier does not match its source record")
    expected_basis = _SOURCE_PRICE_BASES.get(record.source_dataset)
    if expected_basis is None:
        return result("incomplete", "source dataset has no reviewed price-basis rule")
    if basis != expected_basis:
        return result("conflict", "price basis conflicts with the official source adapter")
    if not _valid_price(identity.get("value"), basis):
        return result("incomplete", "price amount is missing or invalid for this source basis")
    if identity.get("currency") != "inr":
        return result("incomplete", "price currency is missing or is not INR")
    if basis in {
        "ceiling_price_excluding_taxes",
        "special_feature_ceiling_price",
    } and (
        not _text(identity.get("notification_number"))
        or not _is_iso_date(identity.get("notification_date"))
    ):
        return result("incomplete", "NPPA notification reference or date is missing")
    if basis == "revised_mrp" and (
        not _is_iso_date(identity.get("effective_date"))
        or not _is_iso_date(identity.get("publication_date"))
        or _positive_decimal(identity.get("previous_value")) is None
    ):
        return result(
            "incomplete",
            "revised MRP lacks its effective/publication date or previous MRP",
        )

    if basis == "pmbi_listed_mrp":
        if not record.source_release:
            return result("incomplete", "PMBI retrieval release is missing")
        if identity.get("pmbi_product_kind") == "surgical_medical_consumable":
            return result("unmatched", "PMBI record is a consumable, not a medicine")
        code = _text(identity.get("pmbi_drug_code"))
        if not code:
            return result("incomplete", "PMBI drug code is missing")
        if record.source_record_id != f"pmbi-drug-code:{code}":
            return result("conflict", "PMBI drug code does not match the source record identifier")
        if identity.get("pmbi_product_kind") != "medicine_product":
            return result("incomplete", "PMBI medicine product classification is missing")

    if basis == "special_feature_ceiling_price" and not _text(
        identity.get("special_feature_qualifier")
    ):
        return result("incomplete", "special-feature qualifier is not present as a typed field")

    formulations = candidates.get("formulation", [])
    if not formulations:
        return result("unmatched", "no formulation candidate exists in the same source record")
    if len(formulations) != 1:
        return result("ambiguous", "multiple formulation candidates exist in the same source record")
    formulation = formulations[0]
    formulation_signature = _formulation_signature(formulation.identity)
    if formulation_signature is None:
        return result(
            "incomplete",
            "formulation lacks a dosage form or complete ingredient strengths and units",
            formulation=formulation,
        )

    packages = candidates.get("product_package", [])
    if not packages:
        return result(
            "incomplete", "no package candidate exists in the same source record",
            formulation=formulation,
        )
    if len(packages) != 1:
        return result(
            "ambiguous", "multiple package candidates exist in the same source record",
            formulation=formulation,
        )
    package = packages[0]
    package_description = _text(identity.get("package_description"))
    candidate_description = _text(package.identity.get("description"))
    price_quantity = _positive_decimal(identity.get("quantity"))
    package_quantity = _positive_decimal(package.identity.get("quantity"))
    price_quantity_unit = _text(identity.get("package_quantity_unit"))
    package_quantity_unit = _text(package.identity.get("unit"))
    if not all((
        package_description, candidate_description, price_quantity, package_quantity,
        price_quantity_unit, package_quantity_unit,
    )):
        return result(
            "incomplete",
            "price or package lacks a complete description, quantity, or unit",
            formulation=formulation, package=package,
        )
    if (
        package_description != candidate_description
        or price_quantity_unit != package_quantity_unit
    ):
        return result(
            "conflict", "price package identity differs from the same-record package candidate",
            formulation=formulation, package=package,
        )
    if price_quantity != package_quantity:
        return result(
            "conflict", "price and package quantities differ",
            formulation=formulation, package=package,
        )
    if basis == "special_feature_ceiling_price":
        qualifier = _text(identity.get("special_feature_qualifier"))
        package_qualifier = _text(
            package.identity.get("special_feature_qualifier")
        )
        if not package_qualifier:
            return result(
                "incomplete", "package has no typed special-feature qualifier",
                formulation=formulation, package=package,
            )
        if qualifier != package_qualifier:
            return result(
                "conflict", "price and package special-feature qualifiers differ",
                formulation=formulation, package=package,
            )
    package_formulation = package.identity.get("formulation")
    if package_formulation is not None:
        package_signature = _formulation_signature(package_formulation)
        if package_signature is None:
            return result(
                "incomplete", "package formulation identity is incomplete",
                formulation=formulation, package=package,
            )
        if package_signature != formulation_signature:
            return result(
                "conflict", "package formulation differs from the same-record formulation",
                formulation=formulation, package=package,
            )

    if basis == "revised_mrp":
        products = candidates.get("brand_product", [])
        if not products:
            return result(
                "incomplete", "revised MRP has no brand/manufacturer product candidate",
                formulation=formulation, package=package,
            )
        if len(products) != 1:
            return result(
                "ambiguous", "multiple product candidates exist for the revised MRP",
                formulation=formulation, package=package,
            )
        product = products[0]
        product_identity = product.identity
        brand = _text(product_identity.get("brand_name"))
        manufacturer = _text(product_identity.get("manufacturer"))
        product_formulation = product_identity.get("formulation")
        if not brand or not manufacturer or product_formulation is None:
            return result(
                "incomplete", "revised MRP lacks brand, manufacturer, or product formulation identity",
                formulation=formulation, package=package, product=product,
            )
        product_signature = _formulation_signature(product_formulation)
        if product_signature is None:
            return result(
                "incomplete", "revised-MRP product formulation identity is incomplete",
                formulation=formulation, package=package, product=product,
            )
        if product_signature != formulation_signature:
            return result(
                "conflict", "revised-MRP product does not identify the same formulation",
                formulation=formulation, package=package, product=product,
            )
        return result(
            "eligible", "exact source record, formulation, brand, manufacturer, and package",
            formulation=formulation, package=package, product=product,
            product_identifier=record.source_record_id,
        )

    if basis == "pmbi_listed_mrp":
        return result(
            "eligible", "exact PMBI drug code, source record, formulation, and unit size",
            formulation=formulation, package=package,
            product_identifier=identity["pmbi_drug_code"],
        )

    reason = (
        "special-feature ceiling is scoped to the verified qualifier and formulation"
        if basis == "special_feature_ceiling_price"
        else "formulation-level NPPA ceiling; not a branded-product price"
    )
    return result(
        "eligible", reason, formulation=formulation, package=package,
    )


def _formulation_signature(identity: object) -> tuple[object, ...] | None:
    if not isinstance(identity, dict):
        return None
    dosage_form = _text(identity.get("dosage_form"))
    ingredients = identity.get("ingredients")
    if not dosage_form or not isinstance(ingredients, list) or not ingredients:
        return None

    components: list[tuple[str, str, str]] = []
    seen_names: set[str] = set()
    for ingredient in ingredients:
        if not isinstance(ingredient, dict):
            return None
        name = _text(ingredient.get("name"))
        unit = _text(ingredient.get("strength_unit"))
        strength = _positive_decimal(ingredient.get("strength_value"))
        if not name or not unit or strength is None or name in seen_names:
            return None
        seen_names.add(name)
        components.append((name, strength, unit))

    release_type = _text(identity.get("release_type"))
    return dosage_form, release_type, tuple(sorted(components))


def _valid_price(value: object, basis: str) -> bool:
    if isinstance(value, bool) or value is None:
        return False
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return False
    if not amount.is_finite() or amount < 0:
        return False
    return amount > 0 or basis == "pmbi_listed_mrp"


def _is_iso_date(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def _positive_decimal(value: object) -> str | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite() or number <= 0:
        return None
    return format(number.normalize(), "f")


def _text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split()).casefold()
    return normalized or None
