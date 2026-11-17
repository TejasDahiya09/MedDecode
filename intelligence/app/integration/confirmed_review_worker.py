"""Private confirmed-review adapter for Layers 4-5.

This interface is deliberately not Contract v1 input. It consumes the immutable
review fingerprint and active confirmed medicine fields, bypasses OCR and
Layers 2-3, then emits the existing Contract v1 output.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from contextlib import redirect_stdout
from io import StringIO
from typing import Any
from uuid import UUID

from app.integration.contract_v1_mapper import map_contract_v1
from app.integration.offline_pipeline import InMemoryMedicineRepository, OfflinePipelineResult
from app.layer4_medicine_intelligence.runtime.pipeline import MedicineIntelligencePipeline
from app.layer5_recommendations.pipeline import RecommendationPipeline
from app.layer5_recommendations.schemas import Layer4CandidateData, Layer4RecommendationInput
from app.schemas.medicine import DosageSchedule, Duration, MedicineUsageRecord, Strength
from app.schemas.prescription import PrescriptionRecord, RawMedicineEntry

MAX_INPUT_BYTES = 1024 * 1024
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _text(value: Any, maximum: int = 1000) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError("invalid confirmed field")
    return value.strip()


def _number(value: Any) -> float | None:
    if value is None:
        return None
    text = _text(value, 32)
    if text is None or not re.fullmatch(r"\d+(?:\.\d+)?", text):
        return None
    return float(text)


def _validate(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema_version") != "meddecode.confirmed-review-intelligence.v1":
        raise ValueError("invalid request")
    for key in ("job_id", "prescription_id", "revision_id"):
        UUID(str(value.get(key)))
    if not isinstance(value.get("input_fingerprint"), str) or not SHA256.fullmatch(value["input_fingerprint"]):
        raise ValueError("invalid fingerprint")
    medicines = value.get("medicines")
    if not isinstance(medicines, list) or not 1 <= len(medicines) <= 100:
        raise ValueError("invalid medicines")
    positions: set[int] = set()
    for medicine in medicines:
        if not isinstance(medicine, dict) or not isinstance(medicine.get("fields"), dict):
            raise ValueError("invalid medicine")
        UUID(str(medicine.get("medicine_id")))
        position = medicine.get("position")
        if not isinstance(position, int) or position < 1 or position in positions:
            raise ValueError("invalid position")
        positions.add(position)
        fields = medicine["fields"]
        for key in ("medicineName", "brandName", "genericName", "dosageForm", "frequency", "timing", "route", "notes"):
            if fields.get(key) is not None:
                _text(fields[key], 1000 if key == "notes" else 200)
        for key in ("strength", "dose", "duration", "quantity"):
            item = fields.get(key)
            if not isinstance(item, dict):
                raise ValueError("invalid value-unit field")
            if item.get("value") is not None:
                _text(item["value"], 32)
            if item.get("unit") is not None:
                _text(item["unit"], 32)
    return value


def _usage(fields: dict[str, Any]) -> MedicineUsageRecord:
    name = fields.get("medicineName") or fields.get("brandName") or fields.get("genericName")
    frequency = fields.get("frequency")
    dose = " ".join(item for item in (fields["dose"].get("value"), fields["dose"].get("unit")) if item)
    quantity = " ".join(item for item in (fields["quantity"].get("value"), fields["quantity"].get("unit")) if item)
    source_instructions = [
        item
        for item in (dose, frequency, fields.get("timing"), fields.get("route"), quantity, fields.get("notes"))
        if item
    ]
    return MedicineUsageRecord(
        raw_medicine_text=name or "",
        raw_medicine_name=name,
        normalized_medicine_name=name.casefold() if isinstance(name, str) else None,
        dosage_form=fields.get("dosageForm"),
        strength=Strength(value=_number(fields["strength"].get("value")), unit=fields["strength"].get("unit")),
        dosage_schedule=DosageSchedule(raw_pattern=frequency),
        timing=fields.get("timing"),
        duration=Duration(value=_number(fields["duration"].get("value")), unit=fields["duration"].get("unit")),
        additional_instructions=source_instructions,
        source_instructions=source_instructions,
    )


def process(value: Any, repository: Any | None = None) -> dict[str, Any]:
    request = _validate(value)
    medicines = [_usage(item["fields"]) for item in sorted(request["medicines"], key=lambda item: item["position"])]
    prescription = PrescriptionRecord(medicines=[
        RawMedicineEntry(raw_text=medicine.raw_medicine_text, page_number=1, confidence=0.0, evidence=[], instructions=list(medicine.source_instructions))
        for medicine in medicines
    ])
    catalogue = repository or InMemoryMedicineRepository()
    matches = MedicineIntelligencePipeline(repository=catalogue).match_medicines(medicines)
    ranker = RecommendationPipeline()
    recommendations = []
    for match in matches:
        selected = match.selected_candidate
        recommendations.append(ranker.rank(Layer4RecommendationInput(
            match_status=match.match_status,
            selected_medicine=None if selected is None else Layer4CandidateData(medicine=selected),
            alternative_candidates=[],
            warnings=list(match.warnings),
        )))
    contract_request = {"job_id": request["job_id"], "prescription_id": request["prescription_id"]}
    return map_contract_v1(contract_request, OfflinePipelineResult(prescription, medicines, matches, recommendations), source_mode="confirmed_review")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--official-catalogue", action="store_true")
    args = parser.parse_args(argv)
    connection = None
    try:
        payload = sys.stdin.read(MAX_INPUT_BYTES + 1)
        if len(payload) > MAX_INPUT_BYTES:
            return 2
        value = _validate(json.loads(payload))
        repository = None
        if args.official_catalogue:
            from app.database.catalogue_connection import connect_catalogue
            from app.layer4_medicine_intelligence.runtime.official_catalogue_provider import LocalOfficialCatalogueMedicineRepository
            connection = connect_catalogue()
            repository = LocalOfficialCatalogueMedicineRepository(connection)
        with redirect_stdout(StringIO()):
            output = process(value, repository)
        sys.stdout.write(json.dumps(output, separators=(",", ":"), allow_nan=False))
        return 0
    except Exception:
        return 3
    finally:
        if connection is not None:
            connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
