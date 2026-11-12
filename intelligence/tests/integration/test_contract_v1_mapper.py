from dataclasses import replace

import pytest

from app.integration.contract_v1_mapper import map_contract_v1
from app.integration.offline_pipeline import InMemoryMedicineRepository, run_offline_pipeline, synthetic_ocr_pages


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


def test_mapper_rejects_misaligned_real_layer_results() -> None:
    result = run_offline_pipeline(synthetic_ocr_pages(), InMemoryMedicineRepository())

    with pytest.raises(ValueError):
        map_contract_v1(REQUEST, replace(result, matches=[]))
