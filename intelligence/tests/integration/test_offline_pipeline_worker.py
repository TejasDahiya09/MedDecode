from app.integration.offline_pipeline_worker import process


def test_worker_uses_fixed_internal_fixture_and_never_dereferences_url() -> None:
    request = {
        "schema_version": "1.0",
        "job_id": "11111111-1111-4111-8111-111111111111",
        "prescription_id": "22222222-2222-4222-8222-222222222222",
        "document": {
            "access_type": "authorized_url",
            "file_url": "https://must-not-be-requested.invalid/prescription.pdf",
            "file_type": "application/pdf",
        },
        "requested_analysis": {
            "extract_prescription": True,
            "match_medicines": True,
            "find_alternatives": True,
            "generate_recommendations": True,
        },
    }

    response = process(request)
    assert len(response["medicines"]) == 2
    assert response["medicines"][0]["extraction"]["medicine_name_normalized"] == "paracetamol"
    assert response["warnings"][0]["code"] == "OFFLINE_SYNTHETIC_INPUT"
