from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from app.layer4_medicine_intelligence.runtime.repository import MedicineRepository
from app.layer4_medicine_intelligence.runtime.schemas import (
    MedicineCandidate,
    MedicineMatchResult,
)
from app.layer5_recommendations.schemas import (
    Layer4CandidateData,
    Layer4RecommendationInput,
    ManufacturerEvidence,
    PriceObservation,
    SafetyEvidence,
)


class Layer4RecommendationDataProvider:
    """
    Layer 4 adapter that enriches a confirmed match and its equivalent
    formulation candidates for Layer 5.

    This is the ONLY new component that performs recommendation-related
    database reads. Layer 5 remains a pure in-memory ranking engine.

    All selected columns below are grounded in the existing Layer 4
    MedicineRecord/DatabaseWriter contracts:
      medicines.manufacturer_id
      manufacturers.name
      medicine_prices: price, currency, country, region,
                       package_description, quantity, source
      safety tables: text field + source
      medicine_sources: source_dataset, source_record_id, source_url
    """

    def __init__(self, repository: MedicineRepository | None = None):
        self.repository = repository or MedicineRepository()
        self.database = self.repository.database

    @staticmethod
    def _rows(response: Any) -> list[dict]:
        data = getattr(response, "data", None)
        if data is None:
            return []
        if not isinstance(data, list):
            raise TypeError("Expected a list from the medicine database.")
        return data

    def _fetch_medicine_rows(self, medicine_ids: list[UUID]) -> dict[str, dict]:
        if not medicine_ids:
            return {}
        response = (
            self.database.table("medicines")
            .select(
                "id, canonical_name, normalized_name, brand_name, generic_name, "
                "dosage_form, strength_value, strength_unit, medicine_type, "
                "prescription_required, manufacturer_id"
            )
            .in_("id", [str(value) for value in medicine_ids])
            .execute()
        )
        return {str(row["id"]): row for row in self._rows(response) if row.get("id")}

    def _fetch_manufacturers(self, rows: dict[str, dict]) -> dict[str, ManufacturerEvidence]:
        manufacturer_ids = list(dict.fromkeys(
            str(row["manufacturer_id"])
            for row in rows.values() if row.get("manufacturer_id")
        ))
        if not manufacturer_ids:
            return {}
        response = (
            self.database.table("manufacturers")
            .select("id, name")
            .in_("id", manufacturer_ids)
            .execute()
        )
        return {
            str(row["id"]): ManufacturerEvidence(
                manufacturer_name=row.get("name"),
                evidence_sources=["manufacturers table"],
            )
            for row in self._rows(response) if row.get("id")
        }

    def _fetch_prices(self, medicine_ids: list[UUID]) -> dict[str, list[PriceObservation]]:
        if not medicine_ids:
            return {}
        response = (
            self.database.table("medicine_prices")
            .select(
                "medicine_id, price, currency, country, region, "
                "package_description, quantity, source"
            )
            .in_("medicine_id", [str(value) for value in medicine_ids])
            .execute()
        )
        result: dict[str, list[PriceObservation]] = {}
        for row in self._rows(response):
            try:
                price = Decimal(str(row["price"]))
                quantity = (
                    Decimal(str(row["quantity"]))
                    if row.get("quantity") is not None else None
                )
            except (KeyError, InvalidOperation, TypeError, ValueError):
                continue
            if price <= 0 or (quantity is not None and quantity <= 0):
                continue
            if not row.get("currency") or not row.get("source"):
                continue
            observation = PriceObservation(
                medicine_id=UUID(str(row["medicine_id"])),
                price=price,
                currency=str(row["currency"]).upper(),
                country=row.get("country"),
                region=row.get("region"),
                quantity=quantity,
                package_description=row.get("package_description"),
                source=row.get("source"),
                recorded_at=None,  # No observation timestamp exists in the verified writer contract.
            )
            result.setdefault(str(observation.medicine_id), []).append(observation)
        return result

    def _fetch_safety(self, medicine_ids: list[UUID]) -> dict[str, SafetyEvidence]:
        result = {str(mid): SafetyEvidence() for mid in medicine_ids}
        if not medicine_ids:
            return result
        id_values = [str(mid) for mid in medicine_ids]
        specs = (
            ("medicine_contraindications", "contraindication", "contraindications"),
            ("medicine_precautions", "precaution", "precautions"),
            ("medicine_side_effects", "side_effect", "side_effects"),
        )
        for table, text_column, attribute in specs:
            response = (
                self.database.table(table)
                .select(f"medicine_id, {text_column}, source")
                .in_("medicine_id", id_values)
                .execute()
            )
            for row in self._rows(response):
                medicine_id = str(row.get("medicine_id", ""))
                text_value = row.get(text_column)
                if medicine_id in result and text_value:
                    getattr(result[medicine_id], attribute).append(str(text_value))
                    if row.get("source"):
                        result[medicine_id].evidence_sources.append(str(row["source"]))
        return result

    def _fetch_source_evidence(self, medicine_ids: list[UUID]) -> dict[str, list[str]]:
        if not medicine_ids:
            return {}
        response = (
            self.database.table("medicine_sources")
            .select("medicine_id, source_dataset, source_record_id, source_url")
            .in_("medicine_id", [str(mid) for mid in medicine_ids])
            .execute()
        )
        result: dict[str, list[str]] = {}
        for row in self._rows(response):
            medicine_id = str(row.get("medicine_id", ""))
            labels = []
            if row.get("source_dataset"):
                labels.append(f"dataset:{row['source_dataset']}")
            if row.get("source_record_id"):
                labels.append(f"record:{row['source_record_id']}")
            if row.get("source_url"):
                labels.append(f"url:{row['source_url']}")
            result.setdefault(medicine_id, []).extend(labels)
        return result

    def build_input(self, match: MedicineMatchResult) -> Layer4RecommendationInput:
        """
        Build the exact Layer4RecommendationInput consumed by Layer 5.
        Does not run for uncertain Layer 4 identity statuses.
        """
        if match.selected_candidate is None:
            return Layer4RecommendationInput(
                match_status=match.match_status,
                selected_medicine=None,
                alternative_candidates=[],
                warnings=list(match.warnings),
            )

        source = match.selected_candidate
        if match.match_status.value != "MATCHED":
            return Layer4RecommendationInput(
                match_status=match.match_status,
                selected_medicine=None,
                alternative_candidates=[],
                warnings=list(match.warnings) + [
                    "Recommendation data enrichment skipped because Layer 4 identity is not MATCHED."
                ],
            )

        # Ensure source ingredients are loaded.
        source = self.repository.enrich_with_ingredients([source])[0]
        if not source.ingredients:
            return Layer4RecommendationInput(
                match_status=match.match_status,
                selected_medicine=None,
                warnings=list(match.warnings) + [
                    "Selected medicine has no active ingredient relationships."
                ],
            )

        source_ids = {str(item.ingredient_id) for item in source.ingredients}
        ingredient_rows = self._rows(
            self.database.table("medicine_ingredients")
            .select("medicine_id, ingredient_id")
            .in_("ingredient_id", list(source_ids))
            .execute()
        )
        candidate_ingredient_sets: dict[str, set[str]] = {}
        for row in ingredient_rows:
            mid, iid = row.get("medicine_id"), row.get("ingredient_id")
            if mid and iid:
                candidate_ingredient_sets.setdefault(str(mid), set()).add(str(iid))

        candidate_ids = [
            UUID(mid) for mid, found in candidate_ingredient_sets.items()
            if found == source_ids and mid != str(source.medicine_id)
        ]
        candidates = self.repository._fetch_by_ids(
            [str(mid) for mid in candidate_ids[:100]]
        )
        candidates = self.repository.enrich_with_ingredients(candidates)

        all_ids = [source.medicine_id] + [item.medicine_id for item in candidates]
        medicine_rows = self._fetch_medicine_rows(all_ids)
        manufacturers = self._fetch_manufacturers(medicine_rows)
        prices = self._fetch_prices(all_ids)
        safety = self._fetch_safety(all_ids)
        source_evidence = self._fetch_source_evidence(all_ids)

        def pack(candidate: MedicineCandidate) -> Layer4CandidateData:
            row = medicine_rows.get(str(candidate.medicine_id), {})
            manufacturer = manufacturers.get(
                str(row.get("manufacturer_id")),
                ManufacturerEvidence(),
            )
            manufacturer.evidence_sources.extend(
                source_evidence.get(str(candidate.medicine_id), [])
            )
            return Layer4CandidateData(
                medicine=candidate,
                prices=prices.get(str(candidate.medicine_id), []),
                safety=safety.get(str(candidate.medicine_id), SafetyEvidence()),
                manufacturer=manufacturer,
            )

        return Layer4RecommendationInput(
            match_status=match.match_status,
            selected_medicine=pack(source),
            alternative_candidates=[pack(item) for item in candidates],
            warnings=list(match.warnings),
        )
