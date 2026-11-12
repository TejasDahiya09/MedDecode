from __future__ import annotations

import json
import sys
from typing import Any

from .contract_v1 import ContractError, failure, synthetic_success, validate_request

MAX_STDIN_BYTES = 1024 * 1024


def process(value: Any) -> dict[str, Any]:
    try:
        request = validate_request(value)
    except ContractError as exc:
        if isinstance(value, dict) and isinstance(value.get("job_id"), str) and isinstance(value.get("prescription_id"), str):
            return failure(value, str(exc))
        raise
    return synthetic_success(request)


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_STDIN_BYTES + 1)
    if len(raw) > MAX_STDIN_BYTES:
        print("input rejected", file=sys.stderr)
        return 2
    try:
        value = json.loads(raw.decode("utf-8"))
        output = process(value)
    except (UnicodeDecodeError, json.JSONDecodeError, ContractError):
        print("invalid contract input", file=sys.stderr)
        return 2
    sys.stdout.write(json.dumps(output, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
