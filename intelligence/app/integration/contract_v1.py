from __future__ import annotations

from typing import Any
from urllib.parse import urlparse
from uuid import UUID

SUPPORTED_TYPES = {"image/jpeg", "image/png", "application/pdf"}
FEATURE_FLAGS = (
    "extract_prescription",
    "match_medicines",
    "find_alternatives",
    "generate_recommendations",
)


class ContractError(ValueError):
    pass


def _uuid(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ContractError(f"{field} must be a UUID")
    try:
        UUID(value)
    except ValueError as exc:
        raise ContractError(f"{field} must be a UUID") from exc
    return value


def validate_request(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ContractError("request must be an object")
    if value.get("schema_version") != "1.0":
        raise ContractError("schema_version must be 1.0")
    _uuid(value.get("job_id"), "job_id")
    _uuid(value.get("prescription_id"), "prescription_id")

    document = value.get("document")
    if not isinstance(document, dict):
        raise ContractError("document must be an object")
    if document.get("access_type") != "authorized_url":
        raise ContractError("Phase 5.2 supports authorized_url only")
    file_url = document.get("file_url")
    if not isinstance(file_url, str):
        raise ContractError("file_url must be a string")
    parsed = urlparse(file_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ContractError("file_url must be an HTTPS URL")
    if document.get("file_type") not in SUPPORTED_TYPES:
        raise ContractError("file_type is unsupported")

    requested = value.get("requested_analysis")
    if not isinstance(requested, dict):
        raise ContractError("requested_analysis must be an object")
    for flag in FEATURE_FLAGS:
        if not isinstance(requested.get(flag), bool):
            raise ContractError(f"{flag} must be a boolean")
    return value


def synthetic_success(request: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "job_id": request["job_id"],
        "prescription_id": request["prescription_id"],
        "status": "completed",
        "prescription": {
            "prescription_date": None,
            "doctor": {"name": None, "registration_number": None},
            "facility": {"name": None, "address": None, "phone": None},
        },
        "patient": {"name": None, "age": None, "gender": None},
        "medicines": [],
        "recommendations": [],
        "warnings": [],
        "processing_metadata": {
            "overall_confidence": None,
            "dataset_version": "synthetic-offline-v1",
            "model_version": "synthetic-offline-v1",
        },
    }

def failure(request: dict[str, Any], message: str) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "job_id": request["job_id"],
        "prescription_id": request["prescription_id"],
        "status": "failed",
        "error": {"code": "INVALID_REQUEST", "message": message, "retryable": False},
    }
