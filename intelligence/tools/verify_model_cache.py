"""Verify approved local EasyOCR assets without downloading or modifying them."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def verify(manifest_path: Path, model_directory: Path) -> list[str]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    failures: list[str] = []
    for expected in manifest.get("files", []):
        path = model_directory / expected["name"]
        if not path.is_file():
            failures.append(f"missing:{expected['name']}")
            continue
        if path.stat().st_size != expected["bytes"]:
            failures.append(f"size:{expected['name']}")
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != expected["sha256"]:
            failures.append(f"sha256:{expected['name']}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("model_directory", type=Path)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "model-cache-manifest.json",
    )
    args = parser.parse_args()
    failures = verify(args.manifest.resolve(), args.model_directory.resolve())
    if failures:
        print("MODEL_CACHE_VERIFY_FAILED:" + ",".join(failures))
        return 1
    print("MODEL_CACHE_VERIFY_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
