from __future__ import annotations

from app.integration.confirmed_review_worker import process


def request() -> dict:
    return {
        "schema_version": "meddecode.confirmed-review-intelligence.v1",
        "job_id": "11111111-1111-4111-8111-111111111111",
        "prescription_id": "22222222-2222-4222-8222-222222222222",
        "revision_id": "33333333-3333-4333-8333-333333333333",
        "input_fingerprint": "a" * 64,
        "medicines": [{
            "medicine_id": "44444444-4444-4444-8444-444444444444",
            "position": 1,
            "fields": {
                "medicineName": "Paracetamol", "brandName": None, "genericName": None,
                "strength": {"value": "500", "unit": "mg"}, "dosageForm": "tablet",
                "dose": {"value": "1", "unit": "tablet"}, "frequency": "1-0-1",
                "timing": "after food", "route": "oral",
                "duration": {"value": "3", "unit": "days"},
                "quantity": {"value": "6", "unit": "tablets"}, "notes": None,
            },
        }],
    }


def test_confirmed_review_runs_layers_4_and_5_without_ocr_or_layers_2_3() -> None:
    output = process(request())
    assert output["status"] == "completed_with_warnings"
    assert output["medicines"][0]["extraction"]["medicine_name"] == "Paracetamol"
    assert output["medicines"][0]["extraction"]["strength"] == {"value": 500.0, "unit": "mg"}
    assert "1 tablet" in output["medicines"][0]["extraction"]["instructions"]
    assert "6 tablets" in output["medicines"][0]["extraction"]["instructions"]
    assert output["medicines"][0]["confidence"]["extraction"] is None
    assert any(item["code"] == "USER_CONFIRMED_TRANSCRIPTION" for item in output["warnings"])


def test_confirmed_review_rejects_invalid_fingerprint_and_empty_medicines() -> None:
    invalid = request()
    invalid["input_fingerprint"] = "bad"
    try:
        process(invalid)
        raise AssertionError("invalid fingerprint accepted")
    except ValueError:
        pass
    invalid = request()
    invalid["medicines"] = []
    try:
        process(invalid)
        raise AssertionError("empty medicines accepted")
    except ValueError:
        pass
