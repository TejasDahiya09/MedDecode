from __future__ import annotations

import json
import subprocess
import sys

from app.integration.synthetic_worker import process
from .test_contract_v1 import valid_request


def test_process_returns_structured_invalid_request() -> None:
    request = valid_request()
    request["document"]["access_type"] = "direct_upload"  # type: ignore[index]
    response = process(request)
    assert response["status"] == "failed"
    assert response["error"]["code"] == "INVALID_REQUEST"


def test_module_protocol_writes_one_json_document() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "app.integration.synthetic_worker"],
        input=json.dumps(valid_request()),
        text=True,
        capture_output=True,
        check=False,
        timeout=5,
    )
    assert completed.returncode == 0
    assert completed.stderr == ""
    lines = completed.stdout.splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["status"] == "completed"


def test_malformed_json_fails_without_contract_output() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "app.integration.synthetic_worker"],
        input="not-json",
        text=True,
        capture_output=True,
        check=False,
        timeout=5,
    )
    assert completed.returncode == 2
    assert completed.stdout == ""
