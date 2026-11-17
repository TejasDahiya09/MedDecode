from dataclasses import replace

import pytest

from app.integration.contract_v1_mapper import map_contract_v1
from app.integration.offline_pipeline import InMemoryMedicineRepository, run_offline_pipeline, synthetic_ocr_pages
from app.schemas.prescription import ExtractionWarning


REQUEST = {
    "schema_version": "1.0",
    "job_id": "11111111-1111-4111-8111-111111111111",
    "prescription_id": "22222222-2222-4222-8222-222222222222",
}


def test_mapper_preserves_correlation_and_omits_internal_identifiers() -> None:
    result = run_offline_pipeline(synthetic_ocr_pages(), InMemoryMedicineRepository())
    response = map_contract_v1(REQUEST, result)

    assert response["job_id"] == REQUEST["job_id"]
    assert response["prescription_id"] == REQUEST["prescription_id"]
    assert response["status"] == "completed_with_warnings"
    assert len(response["medicines"]) == 2
    assert response["medicines"][0]["sequence_number"] == 1
    assert response["medicines"][1]["sequence_number"] == 2
    assert response["medicines"][0]["medicine_match"]["medicine_external_id"] is None
    assert response["medicines"][0]["alternatives"] == []
    assert response["recommendations"] == []
    assert response["processing_metadata"] == {"overall_confidence": None}


def test_mapper_preserves_missing_information_and_sos_semantics() -> None:
    result = run_offline_pipeline(synthetic_ocr_pages(), InMemoryMedicineRepository())
    response = map_contract_v1(REQUEST, result)

    second = response["medicines"][1]
    assert second["extraction"]["frequency"]["type"] == "as_needed"
    assert second["extraction"]["duration"] == {"value": None, "unit": None}
    assert second["extraction"]["quantity"] == {"value": None, "unit": None}


def test_mapper_separates_frequency_from_daily_dose_units() -> None:
    result = run_offline_pipeline(synthetic_ocr_pages(), InMemoryMedicineRepository())
    medicine = result.medicines[0]
    medicine.frequency_times_per_day = 2
    medicine.dosage_schedule.units_per_day = 4

    response = map_contract_v1(REQUEST, result)

    first = response["medicines"][0]
    assert first["extraction"]["frequency"]["times_per_day"] == 2
    assert first["derived"]["units_per_day"] == 4


def test_mapper_preserves_observed_confidence_and_layer_warnings() -> None:
    result = run_offline_pipeline(synthetic_ocr_pages(), InMemoryMedicineRepository())
    result.prescription.medicines[0].confidence = 0.31
    result.prescription.warnings.append(
        ExtractionWarning("date", "Date evidence was ambiguous.")
    )
    result.medicines[0].warnings.append(
        ExtractionWarning("strength", "Strength evidence needs review.")
    )
    result.matches[0].warnings.append("Multiple catalogue candidates require review.")
    result.recommendations[0].warnings.append("Ranking is not clinical suitability.")

    response = map_contract_v1(REQUEST, result)

    first = response["medicines"][0]
    assert first["confidence"] == {"extraction": 0.31}
    assert "medicine_name" not in first["confidence"]
    assert "dosage" not in first["confidence"]

    warnings = response["warnings"]
    assert any(
        warning["code"] == "PRESCRIPTION_EXTRACTION_WARNING"
        and warning["message"] == "date: Date evidence was ambiguous."
        for warning in warnings
    )
    assert any(
        warning["code"] == "MEDICINE_UNDERSTANDING_WARNING"
        and warning["related_medicine_sequence_number"] == 1
        for warning in warnings
    )
    assert any(
        warning["code"] == "MEDICINE_MATCH_WARNING"
        and warning["message"] == "Multiple catalogue candidates require review."
        for warning in warnings
    )
    assert any(
        warning["code"] == "RECOMMENDATION_WARNING"
        and warning["message"] == "Ranking is not clinical suitability."
        for warning in warnings
    )


def test_official_catalogue_source_uses_namespaced_external_identifier() -> None:
    result = run_offline_pipeline(synthetic_ocr_pages(), InMemoryMedicineRepository())
    response = map_contract_v1(
        REQUEST,
        result,
        source_mode="local_pdf_official_catalogue",
    )

    assert response["medicines"][0]["medicine_match"]["medicine_external_id"] == (
        "official_catalogue:10000000-0000-4000-8000-000000000001"
    )
    assert not any(
        warning["code"] == "PUBLIC_MEDICINE_IDENTIFIER_UNAVAILABLE"
        for warning in response["warnings"]
    )


def test_mapper_rejects_misaligned_real_layer_results() -> None:
    result = run_offline_pipeline(synthetic_ocr_pages(), InMemoryMedicineRepository())

    with pytest.raises(ValueError):
        map_contract_v1(REQUEST, replace(result, matches=[]))
