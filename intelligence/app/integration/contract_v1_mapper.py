from __future__ import annotations

from typing import Any, Literal

from app.integration.offline_pipeline import OfflinePipelineResult


def _value_unit(value: float | None, unit: str | None) -> dict[str, Any]:
    return {"value": value, "unit": unit}


def _patient_age(value: str | None) -> int | None:
    return int(value) if value is not None and value.isdigit() else None


def map_contract_v1(
    request: dict[str, Any],
    result: OfflinePipelineResult,
    *,
    source_mode: Literal["synthetic_fixture", "local_pdf", "local_pdf_injected_fixture", "local_pdf_official_catalogue", "confirmed_review"] = "synthetic_fixture",
) -> dict[str, Any]:
    """Map Layer 2-5 output to Contract v1 with source-safe identifiers.

    ``synthetic_fixture`` remains the default for the established offline
    worker. ``local_pdf`` is an explicit local-development mode: its warning
    records that OCR came from a supplied local PDF while the catalogue remains
    fictional. Neither mode adds a document path or URL to the response.
    """
    mapped_medicines: list[dict[str, Any]] = []
    source_warning = (
        {
            "code": "OFFLINE_SYNTHETIC_INPUT",
            "severity": "info",
            "message": "Result was produced from deterministic synthetic OCR and catalogue fixtures.",
            "related_medicine_sequence_number": None,
        }
        if source_mode == "synthetic_fixture"
        else {
            "code": "LOCAL_PDF_FICTIONAL_CATALOGUE",
            "severity": "info",
            "message": "Local PDF OCR was matched only against an injected fictional catalogue.",
            "related_medicine_sequence_number": None,
        }
    )
    if source_mode == "local_pdf_injected_fixture":
        source_warning = {
            "code": "DEVELOPMENT_FIXTURE_INJECTED_OCR",
            "severity": "info",
            "message": "Development-only fictional PDF used injected OCR fixture text; no genuine OCR was performed.",
            "related_medicine_sequence_number": None,
        }
    if source_mode == "local_pdf_official_catalogue":
        source_warning = {
            "code": "LOCAL_PDF_OFFICIAL_CATALOGUE",
            "severity": "info",
            "message": "Local PDF OCR was matched against imported official catalogue evidence; price and product-package associations are unavailable.",
            "related_medicine_sequence_number": None,
        }
    if source_mode == "confirmed_review":
        source_warning = {
            "code": "USER_CONFIRMED_TRANSCRIPTION",
            "severity": "info",
            "message": "Medicine intelligence used the confirmed review transcription; confirmation is not medical verification.",
            "related_medicine_sequence_number": None,
        }
    warnings: list[dict[str, Any]] = [
        source_warning
    ]

    for warning in result.prescription.warnings:
        warnings.append(
            _contract_warning(
                "PRESCRIPTION_EXTRACTION_WARNING",
                f"{warning.field_name}: {warning.message}",
            )
        )

    if result.prescription.unverified_numbered_rows:
        warnings.append(
            _contract_warning(
                "UNVERIFIED_NUMBERED_ROWS",
                "Numbered document rows were retained for manual review and were not treated as confirmed medicines.",
            )
        )

    for sequence, (raw_medicine, medicine, match, ranking) in enumerate(
        zip(
            result.prescription.medicines,
            result.medicines,
            result.matches,
            result.recommendations,
            strict=True,
        ),
        start=1,
    ):
        for warning in medicine.warnings:
            warnings.append(
                _contract_warning(
                    "MEDICINE_UNDERSTANDING_WARNING",
                    f"{warning.field_name}: {warning.message}",
                    sequence,
                )
            )

        for message in match.warnings:
            warnings.append(
                _contract_warning(
                    "MEDICINE_MATCH_WARNING",
                    message,
                    sequence,
                )
            )

        for message in ranking.warnings:
            warnings.append(
                _contract_warning(
                    "RECOMMENDATION_WARNING",
                    message,
                    sequence,
                )
            )

        instructions = " ".join(medicine.source_instructions) or None
        instruction_text = instructions.casefold() if instructions else ""
        if "sos" in instruction_text or "as needed" in instruction_text:
            frequency_type = "as_needed"
        elif medicine.dosage_schedule.raw_pattern:
            frequency_type = "scheduled"
        else:
            frequency_type = "unknown"

        selected = match.selected_candidate
        external_id = (
            f"official_catalogue:{selected.medicine_id}"
            if selected is not None and source_mode == "local_pdf_official_catalogue"
            else None
        )
        ingredients = [] if selected is None else [
            {
                "name": item.ingredient_name,
                "strength_value": item.strength_value,
                "strength_unit": item.strength_unit,
            }
            for item in selected.ingredients
            if item.strength_value is not None and item.strength_unit is not None
        ]
        mapped_medicines.append(
            {
                "sequence_number": sequence,
                "extraction": {
                    "raw_text": medicine.raw_medicine_text,
                    "medicine_name": medicine.raw_medicine_name,
                    "medicine_name_normalized": medicine.normalized_medicine_name,
                    "strength": _value_unit(medicine.strength.value, medicine.strength.unit),
                    "dosage_form": medicine.dosage_form,
                    "frequency": {
                        "type": frequency_type,
                        "morning": medicine.dosage_schedule.morning_units,
                        "afternoon": medicine.dosage_schedule.afternoon_units,
                        "night": medicine.dosage_schedule.night_units,
                        "times_per_day": medicine.frequency_times_per_day,
                    },
                    "timing": medicine.timing,
                    "duration": _value_unit(medicine.duration.value, medicine.duration.unit),
                    "quantity": _value_unit(None, None),
                    "instructions": instructions,
                },
                "confidence": {
                    "extraction": None if source_mode == "confirmed_review" else raw_medicine.confidence,
                },
                "medicine_match": {
                    "status": match.match_status.value.casefold(),
                    "confidence": match.confidence_score,
                    "medicine_external_id": external_id,
                    "brand_name": selected.brand_name if selected else None,
                    "dosage_form": selected.dosage_form if selected else None,
                    "ingredients": ingredients,
                },
                "derived": {
                    "units_per_day": medicine.dosage_schedule.units_per_day,
                    "estimated_total_units": None,
                },
                "alternatives": [],
            }
        )
        if (selected is not None or ranking.ranked_medicines) and external_id is None:
            warnings.append(
                {
                    "code": "PUBLIC_MEDICINE_IDENTIFIER_UNAVAILABLE",
                    "severity": "info",
                    "message": "Internal catalogue UUIDs were not exposed as public medicine identifiers; alternatives were omitted.",
                    "related_medicine_sequence_number": sequence,
                }
            )

    prescription = result.prescription
    return {
        "schema_version": "1.0",
        "job_id": request["job_id"],
        "prescription_id": request["prescription_id"],
        "status": "completed_with_warnings",
        "prescription": {
            "prescription_date": prescription.prescription_date.value if prescription.prescription_date else None,
            "doctor": {"name": prescription.doctor.name, "registration_number": prescription.doctor.registration_number},
            "facility": {"name": prescription.facility.name, "address": None, "phone": None},
        },
        "patient": {
            "name": prescription.patient.name,
            "age": _patient_age(prescription.patient.age),
            "gender": prescription.patient.gender,
        },
        "medicines": mapped_medicines,
        "recommendations": [],
        "warnings": list(
            {
                (
                    warning["code"],
                    warning["severity"],
                    warning["message"],
                    warning["related_medicine_sequence_number"],
                ): warning
                for warning in warnings
            }.values()
        ),
        "processing_metadata": {"overall_confidence": None},
    }


def _contract_warning(
    code: str,
    message: str,
    related_medicine_sequence_number: int | None = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "severity": "info",
        "message": message,
        "related_medicine_sequence_number": related_medicine_sequence_number,
    }
