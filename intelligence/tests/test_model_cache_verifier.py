from __future__ import annotations

import hashlib
import json
from pathlib import Path

from tools.verify_model_cache import verify


def test_model_cache_verifier_accepts_exact_assets_and_rejects_drift(tmp_path: Path) -> None:
    model = tmp_path / "model"
    model.mkdir()
    asset = model / "fixture.pth"
    asset.write_bytes(b"fictional-model-fixture")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps({"files": [{
            "name": asset.name,
            "bytes": asset.stat().st_size,
            "sha256": hashlib.sha256(asset.read_bytes()).hexdigest(),
        }]}),
        encoding="utf-8",
    )

    assert verify(manifest, model) == []
    asset.write_bytes(b"changed")
    assert verify(manifest, model) == ["size:fixture.pth"]
