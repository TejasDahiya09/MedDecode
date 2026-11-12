from __future__ import annotations

import json
import sys
from typing import Any

from app.integration.contract_v1 import ContractError, failure, validate_request
from app.integration.contract_v1_mapper import map_contract_v1
from app.integration.offline_pipeline import InMemoryMedicineRepository, run_offline_pipeline, synthetic_ocr_pages


MAX_INPUT_BYTES = 1024 * 1024


def process(value: Any) -> dict[str, Any]:
    request = validate_request(value)
    result = run_offline_pipeline(synthetic_ocr_pages(), InMemoryMedicineRepository())
    return map_contract_v1(request, result)


def main() -> int:
    request: dict[str, Any] | None = None
    try:
        payload = sys.stdin.read(MAX_INPUT_BYTES + 1)
        if len(payload) > MAX_INPUT_BYTES:
            return 2
        value = json.loads(payload)
        request = validate_request(value)
        result = run_offline_pipeline(synthetic_ocr_pages(), InMemoryMedicineRepository())
        output = map_contract_v1(request, result)
    except (json.JSONDecodeError, ContractError) as exc:
        if isinstance(locals().get("value"), dict):
            output = failure(value, str(exc))
        else:
            return 2
    except Exception:
        if request is None:
            return 3
        output = {
            "schema_version": "1.0",
            "job_id": request["job_id"],
            "prescription_id": request["prescription_id"],
            "status": "failed",
            "error": {
                "code": "PROCESSING_FAILED",
                "message": "Offline intelligence processing failed safely.",
                "retryable": False,
            },
        }
    sys.stdout.write(json.dumps(output, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
