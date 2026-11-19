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
    assert runtime == {"-r requirements/locks/win-py312-runtime-local.txt"}
    assert tests == {"-r requirements/locks/win-py312-test.txt"}


def test_cloud_ocr_dependencies_have_separate_minimal_profiles() -> None:
    assert _requirements("requirements-cloud-aws.txt") == {
        "-r requirements/locks/win-py312-cloud-aws.txt"
    }
    assert _requirements("requirements-cloud-google.txt") == {
        "-r requirements/locks/win-py312-cloud-google.txt"
    }


def test_lock_inputs_keep_optional_providers_out_of_local_default() -> None:
    runtime = _requirements("requirements/runtime-local.in")
    paddle = _requirements("requirements/runtime-adaptive-paddle.in")
    aws = _requirements("requirements/cloud-aws.in")
    google = _requirements("requirements/cloud-google.in")

    assert not {"paddleocr==3.7.0", "paddlepaddle==3.2.2"} & runtime
    assert "-r runtime-local.in" in paddle
    assert {"paddleocr==3.7.0", "paddlepaddle==3.2.2"} <= paddle
    assert aws == {"-r runtime-local.in", "boto3"}
    assert google == {"-r runtime-local.in", "google-cloud-vision"}
