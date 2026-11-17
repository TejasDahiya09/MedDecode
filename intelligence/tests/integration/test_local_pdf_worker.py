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


def test_real_worker_refuses_fictional_catalogue_fallback(monkeypatch, capsys):
    monkeypatch.setattr(worker.sys, "stdin", StringIO(json.dumps(REQUEST)))
    assert worker.main(["--local-pdf-path", "test.pdf"]) == 0
    response = json.loads(capsys.readouterr().out)
    assert response["status"] == "failed"
    assert "medicines" not in response


def test_real_pdf_worker_fails_when_easyocr_model_directory_is_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _install_fake_ocr(monkeypatch, ())
    monkeypatch.setattr(worker.sys, "stdin", StringIO(json.dumps(REQUEST)))

    exit_code = worker.main(
        [
            "--local-pdf-path",
            str(tmp_path / "prescription.pdf"),
            "--official-catalogue-local",
            "--easyocr-model-directory",
            str(tmp_path / "missing-models"),
        ]
    )

    response = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert response["status"] == "failed"
    assert response["error"]["code"] == "PROCESSING_FAILED"
    assert "medicines" not in response


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
    def __init__(self, *, whole_page_providers, max_parallel_providers: int, per_engine_timeout_seconds: float) -> None:
        self.whole_page_providers = whole_page_providers
        self.max_parallel_providers = max_parallel_providers
        self.per_engine_timeout_seconds = per_engine_timeout_seconds
        self.handwritten_provider = None


class FakeAdaptiveOCREngine:
    adaptive = True


def _install_fake_ocr(monkeypatch: pytest.MonkeyPatch, pages: tuple[object, ...]) -> dict[str, object]:
    observed: dict[str, object] = {}
    monkeypatch.setenv("MEDDECODE_CATALOGUE_ENV", "local")
    monkeypatch.setitem(worker.sys.modules, "psycopg", SimpleNamespace(connect=lambda **kwargs: SimpleNamespace(close=lambda: None)))
    monkeypatch.setattr(worker, "EasyOCRProvider", FakeEasyOCRProvider)
    monkeypatch.setattr(worker, "AwsTextractProvider", FakeAwsTextractProvider)
    monkeypatch.setattr(worker, "GoogleVisionProvider", FakeGoogleVisionProvider)
    monkeypatch.setattr(worker, "HybridOCREngine", FakeHybridOCREngine)
    def build_adaptive(**kwargs):
        observed["adaptive_options"] = kwargs
        return FakeAdaptiveOCREngine()
    monkeypatch.setattr(worker, "build_adaptive_easy_paddle_engine", build_adaptive)

    def process_pdf(*, pdf_path: str, job_id: str, prescription_id: str, hybrid_ocr: FakeHybridOCREngine, **kwargs):
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
            "--official-catalogue-local",
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
    assert engine.per_engine_timeout_seconds == 60.0
    assert len(engine.whole_page_providers) == 1
    assert isinstance(engine.whole_page_providers[0], FakeEasyOCRProvider)
    assert engine.whole_page_providers[0].model_storage_directory == model_directory
    assert engine.handwritten_provider is None


def test_real_pdf_worker_selects_adaptive_easy_paddle_only_when_explicit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    model_directory = tmp_path / "easyocr-model-cache"
    detection_directory = tmp_path / "paddle-detection"
    recognition_directory = tmp_path / "paddle-recognition"
    for directory in (model_directory, detection_directory, recognition_directory):
        directory.mkdir()
    page = SimpleNamespace(predictions=(object(),), failures=())
    observed = _install_fake_ocr(monkeypatch, (page,))
    monkeypatch.setattr(worker.sys, "stdin", StringIO(json.dumps(REQUEST)))

    exit_code = worker.main([
        "--local-pdf-path", str(tmp_path / "prescription.pdf"),
        "--official-catalogue-local",
        "--easyocr-model-directory", str(model_directory),
        "--adaptive-ocr",
        "--paddle-detection-model-directory", str(detection_directory),
        "--paddle-recognition-model-directory", str(recognition_directory),
    ])

    response = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert response["status"] == "completed_with_warnings"
    assert isinstance(observed["hybrid_ocr"], FakeAdaptiveOCREngine)
    assert observed["adaptive_options"] == {
        "easyocr_model_directory": model_directory,
        "paddle_detection_model_directory": detection_directory,
        "paddle_recognition_model_directory": recognition_directory,
        "per_engine_timeout_seconds": 60.0,
    }


def test_real_pdf_worker_adaptive_mode_fails_closed_without_paddle_paths(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    model_directory = tmp_path / "easyocr-model-cache"
    model_directory.mkdir()
    _install_fake_ocr(monkeypatch, ())
    monkeypatch.setattr(worker.sys, "stdin", StringIO(json.dumps(REQUEST)))

    exit_code = worker.main([
        "--local-pdf-path", str(tmp_path / "prescription.pdf"),
        "--official-catalogue-local",
        "--easyocr-model-directory", str(model_directory),
        "--adaptive-ocr",
    ])

    response = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert response["status"] == "failed"


def test_real_pdf_worker_emits_only_sanitized_catalogue_transport_category(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    model_directory = tmp_path / "easyocr-model-cache"
    model_directory.mkdir()
    monkeypatch.setattr(worker.sys, "stdin", StringIO(json.dumps(REQUEST)))
    monkeypatch.setattr(worker, "connect_catalogue", lambda: (_ for _ in ()).throw(
        RuntimeError("connection failed: Network is unreachable; secret-not-printed")
    ))

    exit_code = worker.main([
        "--local-pdf-path", str(tmp_path / "prescription.pdf"),
        "--official-catalogue-local",
        "--easyocr-model-directory", str(model_directory),
    ])

    captured = capsys.readouterr()
    assert exit_code == 0
    assert json.loads(captured.out)["status"] == "failed"
    assert "SAFE_WORKER_FAILURE:CATALOGUE_CONNECTION:NETWORK_UNREACHABLE" in captured.err
    assert "secret-not-printed" not in captured.err


@pytest.mark.parametrize(
    "invalid_confidence",
    [float("nan"), float("inf"), object()],
    ids=("nan", "infinity", "non-json"),
)
def test_real_pdf_worker_fails_closed_on_invalid_contract_values(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    invalid_confidence: object,
) -> None:
    page = SimpleNamespace(predictions=(object(),), failures=())
    _install_fake_ocr(monkeypatch, (page,))
    monkeypatch.setattr(worker.sys, "stdin", StringIO(json.dumps(REQUEST)))

    def process_with_non_finite_confidence(**kwargs):
        return {
            "schema_version": "1.0",
            "job_id": kwargs["job_id"],
            "prescription_id": kwargs["prescription_id"],
            "status": "completed_with_warnings",
            "medicines": [{"confidence": {"extraction": invalid_confidence}}],
        }, (page,)

    monkeypatch.setattr(
        worker,
        "process_local_pdf_with_hybrid_ocr_to_contract_v1",
        process_with_non_finite_confidence,
    )

    exit_code = worker.main(
        [
            "--local-pdf-path",
            str(tmp_path / "prescription.pdf"),
            "--official-catalogue-local",
            "--easyocr-model-directory",
            str(tmp_path),
        ]
    )

    captured = capsys.readouterr()
    response = json.loads(
        captured.out,
        parse_constant=lambda value: pytest.fail(f"non-standard JSON constant: {value}"),
    )
    assert exit_code == 0
    assert captured.err == ""
    assert response["status"] == "failed"
    assert response["error"]["code"] == "PROCESSING_FAILED"


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
            "--official-catalogue-local",
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
            "--official-catalogue-local",
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
            "--official-catalogue-local",
            "--easyocr-model-directory",
            str(model_directory),
        ]
    )

    captured = capsys.readouterr()
    response = json.loads(captured.out)
    assert exit_code == 0
    assert captured.err == "SAFE_WORKER_FAILURE:FIVE_LAYER_PIPELINE:LOCAL_PROCESSING_ERROR\n"
    assert response["status"] == "failed"
    assert response["error"]["code"] == "PROCESSING_FAILED"
    assert "medicines" not in response


def test_real_pdf_worker_returns_safe_failure_on_unexpected_extraction_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _install_fake_ocr(monkeypatch, ())

    def fail_processing(**kwargs):
        raise RuntimeError("fictional extraction failure")

    monkeypatch.setattr(
        worker,
        "process_local_pdf_with_hybrid_ocr_to_contract_v1",
        fail_processing,
    )
    monkeypatch.setattr(worker.sys, "stdin", StringIO(json.dumps(REQUEST)))

    exit_code = worker.main(
        [
            "--local-pdf-path",
            str(tmp_path / "prescription.pdf"),
            "--official-catalogue-local",
            "--easyocr-model-directory",
            str(tmp_path),
        ]
    )

    response = json.loads(capsys.readouterr().out)
    assert exit_code == 0
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
