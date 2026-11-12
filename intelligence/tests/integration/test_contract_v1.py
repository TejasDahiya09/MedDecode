from __future__ import annotations

import pytest

from app.integration.contract_v1 import ContractError, synthetic_success, validate_request


def valid_request() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "job_id": "11111111-1111-4111-8111-111111111111",
        "prescription_id": "22222222-2222-4222-8222-222222222222",
        "document": {
            "access_type": "authorized_url",
            "file_url": "https://contract.invalid/private/synthetic.pdf",
            "file_type": "application/pdf",
        },
        "requested_analysis": {
            "extract_prescription": True,
            "match_medicines": True,
            "find_alternatives": True,
            "generate_recommendations": True,
        },
    }


def test_validates_authorized_url_request_without_fetching() -> None:
    assert validate_request(valid_request())["schema_version"] == "1.0"


def test_rejects_direct_upload() -> None:
    request = valid_request()
    request["document"]["access_type"] = "direct_upload"  # type: ignore[index]
    with pytest.raises(ContractError):
        validate_request(request)


def test_rejects_missing_feature_flag() -> None:
    request = valid_request()
    del request["requested_analysis"]["match_medicines"]  # type: ignore[index]
    with pytest.raises(ContractError):
        validate_request(request)


def test_synthetic_response_is_empty_and_correlated() -> None:
    request = valid_request()
    response = synthetic_success(request)
    assert response["job_id"] == request["job_id"]
    assert response["prescription_id"] == request["prescription_id"]
    assert response["medicines"] == []
    assert response["recommendations"] == []
    assert response["warnings"] == []
