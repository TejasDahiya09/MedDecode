from __future__ import annotations

import json
from io import StringIO
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.integration import local_pdf_worker as worker


JOB_ID = "11111111-1111-4111-8111-111111111111"
PRESCRIPTION_ID = "22222222-2222-4222-8222-222222222222"
REQUEST = {
    "schema_version": "1.0",
    "job_id": JOB_ID,
    "prescription_id": PRESCRIPTION_ID,
    "document": {
        "access_type": "authorized_url",
        "file_url": "https://local-test.invalid/prescription.pdf",
        "file_type": "application/pdf",
    },
    "requested_analysis": {
        "extract_prescription": True,
        "match_medicines": True,
        "find_alternatives": False,
        "generate_recommendations": False,
    },
}


class FakeEasyOCRProvider:
    def __init__(self, *, model_storage_directory: Path) -> None:
        self.model_storage_directory = model_storage_directory


class FakeAwsTextractProvider:
    def __init__(self, *, enabled: bool, region: str) -> None:
        self.enabled = enabled
        self.region = region


class FakeGoogleVisionProvider:
    def __init__(self, *, enabled: bool) -> None:
        self.enabled = enabled


class FakeHybridOCREngine:
    def __init__(self, *, whole_page_providers, max_parallel_providers: int) -> None:
        self.whole_page_providers = whole_page_providers
        self.max_parallel_providers = max_parallel_providers
        self.handwritten_provider = None


def _install_fake_ocr(monkeypatch: pytest.MonkeyPatch, pages: tuple[object, ...]) -> dict[str, object]:
    observed: dict[str, object] = {}
    monkeypatch.setattr(worker, "EasyOCRProvider", FakeEasyOCRProvider)
    monkeypatch.setattr(worker, "AwsTextractProvider", FakeAwsTextractProvider)
    monkeypatch.setattr(worker, "GoogleVisionProvider", FakeGoogleVisionProvider)
    monkeypatch.setattr(worker, "HybridOCREngine", FakeHybridOCREngine)

    def process_pdf(*, pdf_path: str, job_id: str, prescription_id: str, hybrid_ocr: FakeHybridOCREngine):
        print("diagnostic text must not reach stdout")
        observed.update(
            pdf_path=pdf_path,
            job_id=job_id,
            prescription_id=prescription_id,
            hybrid_ocr=hybrid_ocr,
        )
        return {
            "schema_version": "1.0",
            "job_id": job_id,
            "prescription_id": prescription_id,
            "status": "completed_with_warnings",
            "medicines": [{"extraction": {"medicine_name": "Examplemed"}}],
        }, pages

    monkeypatch.setattr(worker, "process_local_pdf_with_hybrid_ocr_to_contract_v1", process_pdf)
    return observed


def test_real_pdf_worker_selects_only_easyocr_and_writes_json_only(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    model_directory = tmp_path / "easyocr-model-cache"
    model_directory.mkdir()
    pdf_path = str(tmp_path / "prescription.pdf")
    page = SimpleNamespace(predictions=(object(),), failures=())
    observed = _install_fake_ocr(monkeypatch, (page,))
    monkeypatch.setattr(worker.sys, "stdin", StringIO(json.dumps(REQUEST)))

    exit_code = worker.main(
        [
            "--local-pdf-path",
            pdf_path,
            "--easyocr-model-directory",
            str(model_directory),
        ]
    )

    captured = capsys.readouterr()
    response = json.loads(captured.out)
    engine = observed["hybrid_ocr"]
    assert exit_code == 0
    assert captured.err == ""
    assert response["status"] == "completed_with_warnings"
    assert response["medicines"][0]["extraction"]["medicine_name"] == "Examplemed"
    assert observed["pdf_path"] == pdf_path
    assert observed["job_id"] == JOB_ID
    assert observed["prescription_id"] == PRESCRIPTION_ID
    assert engine.max_parallel_providers == 1
    assert len(engine.whole_page_providers) == 1
    assert isinstance(engine.whole_page_providers[0], FakeEasyOCRProvider)
    assert engine.whole_page_providers[0].model_storage_directory == model_directory
    assert engine.handwritten_provider is None


def test_real_pdf_worker_selects_textract_only_with_explicit_region(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    page = SimpleNamespace(predictions=(object(),), failures=())
    observed = _install_fake_ocr(monkeypatch, (page,))
    monkeypatch.setattr(worker.sys, "stdin", StringIO(json.dumps(REQUEST)))

    exit_code = worker.main(
        [
            "--local-pdf-path", str(tmp_path / "prescription.pdf"),
            "--ocr-provider", "aws-textract",
            "--aws-region", "ap-south-1",
        ]
    )

    response = json.loads(capsys.readouterr().out)
    engine = observed["hybrid_ocr"]
    assert exit_code == 0
    assert response["status"] == "completed_with_warnings"
    assert len(engine.whole_page_providers) == 1
    assert isinstance(engine.whole_page_providers[0], FakeAwsTextractProvider)
    assert engine.whole_page_providers[0].enabled is True
    assert engine.whole_page_providers[0].region == "ap-south-1"


def test_real_pdf_worker_selects_google_only_with_explicit_provider(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    page = SimpleNamespace(predictions=(object(),), failures=())
    observed = _install_fake_ocr(monkeypatch, (page,))
    monkeypatch.setattr(worker.sys, "stdin", StringIO(json.dumps(REQUEST)))

    exit_code = worker.main(
        [
            "--local-pdf-path", str(tmp_path / "prescription.pdf"),
            "--ocr-provider", "google-cloud-vision",
        ]
    )

    response = json.loads(capsys.readouterr().out)
    engine = observed["hybrid_ocr"]
    assert exit_code == 0
    assert response["status"] == "completed_with_warnings"
    assert len(engine.whole_page_providers) == 1
    assert isinstance(engine.whole_page_providers[0], FakeGoogleVisionProvider)
    assert engine.whole_page_providers[0].enabled is True


@pytest.mark.parametrize(
    "page",
    [
        SimpleNamespace(predictions=(), failures=(SimpleNamespace(engine_name="easyocr", code="UNAVAILABLE"),)),
        SimpleNamespace(predictions=(), failures=()),
    ],
)
def test_real_pdf_worker_returns_safe_failure_without_usable_ocr(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    page: object,
) -> None:
    model_directory = tmp_path / "easyocr-model-cache"
    model_directory.mkdir()
    _install_fake_ocr(monkeypatch, (page,))
    monkeypatch.setattr(worker.sys, "stdin", StringIO(json.dumps(REQUEST)))

    exit_code = worker.main(
        [
            "--local-pdf-path",
            str(tmp_path / "prescription.pdf"),
            "--easyocr-model-directory",
            str(model_directory),
        ]
    )

    captured = capsys.readouterr()
    response = json.loads(captured.out)
    assert exit_code == 0
    assert captured.err == ""
    assert response["status"] == "failed"
    assert response["error"]["code"] == "PROCESSING_FAILED"
    assert "medicines" not in response


def test_real_pdf_worker_rejects_fixture_ocr_arguments(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as error:
        worker.main(
            [
                "--local-pdf-path",
                str(tmp_path / "prescription.pdf"),
                "--easyocr-model-directory",
                str(tmp_path),
                "--injected-ocr-fixture",
            ]
        )

    assert error.value.code == 2
    assert capsys.readouterr().out == ""
