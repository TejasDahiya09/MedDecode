from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _requirements(name: str) -> set[str]:
    return {
        line.strip().casefold()
        for line in (ROOT / name).read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def test_local_default_requirements_exclude_cloud_ocr_sdks() -> None:
    runtime = _requirements("requirements.txt")
    tests = _requirements("requirements-test.txt")

    assert "boto3" not in runtime
    assert "google-cloud-vision" not in runtime
    assert tests == {"-r requirements.txt", "pytest==9.1.1", "iniconfig==2.3.0", "packaging==26.3", "pluggy==1.6.0", "pygments==2.21.0"}


def test_cloud_ocr_dependencies_have_separate_minimal_profiles() -> None:
    assert _requirements("requirements-cloud-aws.txt") == {"boto3"}
    assert _requirements("requirements-cloud-google.txt") == {"google-cloud-vision"}
