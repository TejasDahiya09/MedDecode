from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import sys
from time import sleep
from types import SimpleNamespace

import fitz
import pytest
from PIL import Image

from app.integration.local_pdf_pipeline import process_local_pdf_with_hybrid_ocr_to_contract_v1
from app.layer1_document_processing.hybrid_ocr import (
    AwsTextractProvider,
    Boto3TextractTransport,
    CloudOCRMalformedResponseError,
    CloudOCRPermissionError,
    CloudOCRThrottledError,
    CloudOCRTimeoutError,
    CloudOCRDisabledError,
    EasyOCRProvider,
    HybridOCREngine,
    OCRPrediction,
    OCRProviderError,
    OCRRegion,
    PaddleOCRProvider,
    TrOCRHandwrittenProvider,
)
from app.layer1_document_processing.ocr_engine import PaddleOCRLocalModelConfig
from app.layer1_document_processing.google_vision_provider import GoogleVisionProvider
from app.schemas.ocr import OCRBlock, OCRPageResult


JOB_ID = "11111111-1111-4111-8111-111111111111"
PRESCRIPTION_ID = "22222222-2222-4222-8222-222222222222"


class StaticProvider:
    def __init__(self, name: str, lines: list[tuple[str, tuple[tuple[float, float], ...]]]) -> None:
        self.engine_name = name
        self._lines = lines
        self.image_sizes: list[tuple[int, int]] = []

    def recognize(self, image: Image.Image, page_number: int, _timeout_seconds: float) -> list[OCRPrediction]:
        self.image_sizes.append(image.size)
        return [
            OCRPrediction(self.engine_name, "test", page_number, text, polygon, 0.9, model_provenance="test")
            for text, polygon in self._lines
        ]


class FailingProvider:
    engine_name = "failing"

    def recognize(self, _image: Image.Image, _page_number: int, _timeout_seconds: float) -> list[OCRPrediction]:
        raise OCRProviderError("synthetic provider failure")


class FakeTrOCR:
    engine_name = "trocr_base_handwritten"

    def recognize_regions(self, regions: list[OCRRegion], page_number: int, _timeout_seconds: float) -> list[OCRPrediction]:
        return [
            OCRPrediction(self.engine_name, "test", page_number, "Examplemed 10 mg", region.polygon, None, "handwritten", "test")
            for region in regions
        ]


def _polygon(y: float = 10.0) -> tuple[tuple[float, float], ...]:
    return ((10.0, y), (200.0, y), (200.0, y + 20.0), (10.0, y + 20.0))


def _pdf(path: Path) -> Path:
    document = fitz.open()
    document.new_page().insert_text((72, 72), "MEDDECODE SYNTHETIC HYBRID OCR TEST")
    document.save(path)
    document.close()
    return path


def test_three_provider_agreement_preserves_all_predictions_and_downstream_text() -> None:
    providers = [StaticProvider(name, [("Examplemed 10 mg", _polygon())]) for name in ("paddleocr", "easyocr", "google")]
    result = HybridOCREngine(providers, max_parallel_providers=2).recognize_page(Image.new("RGB", (300, 100), "white"), 1)

    assert len(result.predictions) == 3
    assert result.regions[0].state == "agreement"
    assert result.to_ocr_page_result().full_text == "Examplemed 10 mg"


def test_material_text_disagreement_is_omitted_from_downstream_ocr() -> None:
    providers = [
        StaticProvider("paddleocr", [("Examplemed 10 mg", _polygon())]),
        StaticProvider("easyocr", [("Examplemed 40 mg", _polygon())]),
    ]
    result = HybridOCREngine(providers).recognize_page(Image.new("RGB", (300, 100), "white"), 1)

    assert result.regions[0].state == "disagreement"
    assert result.regions[0].selected_prediction is None
    assert result.to_ocr_page_result().full_text == ""


def test_partial_provider_failure_is_safe_and_other_provider_is_used() -> None:
    result = HybridOCREngine([StaticProvider("paddleocr", [("Examplemed", _polygon())]), FailingProvider()]).recognize_page(
        Image.new("RGB", (300, 100), "white"), 1
    )

    assert result.failures[0].engine_name == "failing"
    assert result.failures[0].code == "UNAVAILABLE"
    assert result.to_ocr_page_result().full_text == "Examplemed"


def test_trocr_receives_deduplicated_detection_crops() -> None:
    result = HybridOCREngine(
        [StaticProvider("paddleocr", [("Examplemed 10 mg", _polygon())]), StaticProvider("easyocr", [("Examplemed 10 mg", _polygon())])],
        handwritten_provider=FakeTrOCR(),
    ).recognize_page(Image.new("RGB", (300, 100), "white"), 1)

    assert len(result.predictions) == 3
    assert any(prediction.engine_name == "trocr_base_handwritten" for prediction in result.predictions)


def test_cloud_provider_is_disabled_without_explicit_opt_in() -> None:
    with pytest.raises(CloudOCRDisabledError):
        AwsTextractProvider().recognize(Image.new("RGB", (20, 20), "white"), 1, 1.0)


def test_aws_textract_adapter_maps_injected_response_without_network() -> None:
    class Transport:
        def detect_document_text(self, _image_bytes: bytes, _timeout_seconds: float):
            return {"Blocks": [{"BlockType": "LINE", "Text": "Examplemed", "Confidence": 98, "TextType": "PRINTED", "Geometry": {"Polygon": [{"X": 0, "Y": 0}, {"X": 1, "Y": 0}, {"X": 1, "Y": 1}]}}]}

    result = AwsTextractProvider(enabled=True, transport=Transport()).recognize(Image.new("RGB", (20, 20), "white"), 1, 1.0)
    assert result[0].text == "Examplemed"
    assert result[0].raw_confidence == 0.98
    assert result[0].content_style == "printed"
    assert result[0].model_provenance == "aws-textract-detect-document-text"


def test_textract_transport_uses_bytes_and_sanitizes_permission_failure() -> None:
    calls: list[dict[str, object]] = []

    class Client:
        def detect_document_text(self, **request):
            calls.append(request)
            return {"Blocks": []}

    transport = Boto3TextractTransport(region="ap-south-1", client=Client())
    assert transport.detect_document_text(b"png", 2.0) == {"Blocks": []}
    assert calls == [{"Document": {"Bytes": b"png"}}]

    class ProviderFailure(Exception):
        response = {"Error": {"Code": "AccessDeniedException", "Message": "private provider detail"}}

    class DeniedClient:
        def detect_document_text(self, **_request):
            raise ProviderFailure("credential detail")

    denied = Boto3TextractTransport(region="ap-south-1", client=DeniedClient())
    with pytest.raises(CloudOCRPermissionError, match="permission was denied") as error:
        denied.detect_document_text(b"png", 2.0)
    assert "credential" not in str(error.value)
    assert "private provider" not in str(error.value)


def test_textract_transport_safely_classifies_throttling_and_timeout() -> None:
    class Throttled(Exception):
        response = {"Error": {"Code": "ThrottlingException", "Message": "private detail"}}

    class ThrottledClient:
        def detect_document_text(self, **_request):
            raise Throttled("provider detail")

    with pytest.raises(CloudOCRThrottledError, match="throttled"):
        Boto3TextractTransport(region="ap-south-1", client=ThrottledClient()).detect_document_text(b"png", 1.0)

    ReadTimeoutError = type("ReadTimeoutError", (Exception,), {})

    class TimedOutClient:
        def detect_document_text(self, **_request):
            raise ReadTimeoutError("private endpoint")

    with pytest.raises(CloudOCRTimeoutError, match="timed out"):
        Boto3TextractTransport(region="ap-south-1", client=TimedOutClient()).detect_document_text(b"png", 1.0)


def test_textract_only_and_hybrid_disagreement_preserve_evidence() -> None:
    class Transport:
        def detect_document_text(self, _image_bytes: bytes, _timeout_seconds: float):
            return {"Blocks": [{
                "BlockType": "LINE", "Text": "Examplemed 10 mg", "Confidence": 99,
                "TextType": "PRINTED", "Geometry": {"Polygon": [
                    {"X": 0.03, "Y": 0.1}, {"X": 0.67, "Y": 0.1},
                    {"X": 0.67, "Y": 0.3}, {"X": 0.03, "Y": 0.3},
                ]},
            }]}

    textract = AwsTextractProvider(enabled=True, transport=Transport())
    image = Image.new("RGB", (300, 100), "white")
    only = HybridOCREngine([textract]).recognize_page(image, 1)
    assert only.to_ocr_page_result().full_text == "Examplemed 10 mg"
    assert only.predictions[0].engine_name == "aws_textract"

    local = StaticProvider("easyocr", [("Othermed 40 mg", ((9.0, 10.0), (201.0, 10.0), (201.0, 30.0), (9.0, 30.0)))])
    combined = HybridOCREngine([textract, local]).recognize_page(image, 1)
    assert len(combined.predictions) == 2
    assert combined.regions[0].state == "disagreement"
    assert combined.to_ocr_page_result().full_text == ""


def test_textract_malformed_response_is_a_safe_independent_failure() -> None:
    class Transport:
        def detect_document_text(self, _image_bytes: bytes, _timeout_seconds: float):
            return {"Blocks": "not-a-list"}

    provider = AwsTextractProvider(enabled=True, transport=Transport())
    with pytest.raises(CloudOCRMalformedResponseError):
        provider.recognize(Image.new("RGB", (20, 20), "white"), 1, 1.0)
    result = HybridOCREngine([provider]).recognize_page(Image.new("RGB", (20, 20), "white"), 1)
    assert result.predictions == ()
    assert result.failures[0].code == "MALFORMED_RESPONSE"


def test_textract_empty_result_is_preserved_without_invented_text() -> None:
    class Transport:
        def detect_document_text(self, _image_bytes: bytes, _timeout_seconds: float):
            return {"Blocks": []}

    result = HybridOCREngine(
        [AwsTextractProvider(enabled=True, transport=Transport())]
    ).recognize_page(Image.new("RGB", (20, 20), "white"), 1)
    assert result.predictions == ()
    assert result.failures == ()
    assert result.to_ocr_page_result().full_text == ""


def test_google_vision_adapter_maps_injected_response_without_network() -> None:
    word = SimpleNamespace(
        symbols=[SimpleNamespace(text="Example"), SimpleNamespace(text="med")],
        bounding_box=SimpleNamespace(vertices=[SimpleNamespace(x=0, y=0), SimpleNamespace(x=1, y=0), SimpleNamespace(x=1, y=1)]),
        confidence=0.7,
    )
    response = SimpleNamespace(full_text_annotation=SimpleNamespace(pages=[SimpleNamespace(blocks=[SimpleNamespace(paragraphs=[SimpleNamespace(words=[word])])])]))

    class Transport:
        def document_text(self, _image_bytes: bytes, _timeout_seconds: float):
            return response

    result = GoogleVisionProvider(enabled=True, transport=Transport()).recognize(Image.new("RGB", (20, 20), "white"), 1, 1.0)
    assert result[0].text == "Examplemed"
    assert result[0].raw_confidence == 0.7


def test_aws_google_and_local_predictions_reconcile_without_losing_engine_identity() -> None:
    class TextractTransport:
        def detect_document_text(self, _image_bytes: bytes, _timeout_seconds: float):
            return {"Blocks": [{
                "BlockType": "LINE", "Text": "Examplemed 10 mg", "Confidence": 98,
                "TextType": "PRINTED", "Geometry": {"Polygon": [
                    {"X": 0.03, "Y": 0.1}, {"X": 0.67, "Y": 0.1},
                    {"X": 0.67, "Y": 0.3}, {"X": 0.03, "Y": 0.3},
                ]},
            }]}

    word = SimpleNamespace(
        symbols=[SimpleNamespace(text=value) for value in "Examplemed 10 mg"],
        bounding_box=SimpleNamespace(vertices=[
            SimpleNamespace(x=9, y=10), SimpleNamespace(x=201, y=10),
            SimpleNamespace(x=201, y=30), SimpleNamespace(x=9, y=30),
        ]),
        confidence=0.97,
    )
    response = SimpleNamespace(
        error=SimpleNamespace(message=""),
        full_text_annotation=SimpleNamespace(pages=[SimpleNamespace(
            blocks=[SimpleNamespace(paragraphs=[SimpleNamespace(words=[word])])]
        )]),
    )

    class VisionTransport:
        def document_text(self, _image_bytes: bytes, _timeout_seconds: float):
            return response

    providers = [
        AwsTextractProvider(enabled=True, transport=TextractTransport()),
        GoogleVisionProvider(enabled=True, transport=VisionTransport()),
        StaticProvider("easyocr", [("Examplemed 10 mg", ((9.0, 10.0), (201.0, 10.0), (201.0, 30.0), (9.0, 30.0)))]),
    ]
    result = HybridOCREngine(providers, max_parallel_providers=3).recognize_page(
        Image.new("RGB", (300, 100), "white"), 1
    )
    assert {prediction.engine_name for prediction in result.predictions} == {
        "aws_textract", "google_cloud_vision", "easyocr"
    }
    assert result.regions[0].state == "agreement"
    assert len(result.regions[0].predictions) == 3
    assert result.to_ocr_page_result().full_text == "Examplemed 10 mg"


def test_google_failure_does_not_stop_available_local_provider() -> None:
    class FailingVisionTransport:
        def document_text(self, _image_bytes: bytes, _timeout_seconds: float):
            raise RuntimeError("private provider detail")

    result = HybridOCREngine([
        StaticProvider("easyocr", [("Examplemed", _polygon())]),
        GoogleVisionProvider(enabled=True, transport=FailingVisionTransport()),
    ]).recognize_page(Image.new("RGB", (300, 100), "white"), 1)
    assert result.to_ocr_page_result().full_text == "Examplemed"
    assert any(
        failure.engine_name == "google_cloud_vision" and failure.code == "UNAVAILABLE"
        for failure in result.failures
    )


def test_easyocr_and_trocr_adapters_map_injected_local_engines(tmp_path: Path) -> None:
    class EasyReader:
        def readtext(self, _image, detail: int, paragraph: bool):
            assert detail == 1 and not paragraph
            return [([[0, 0], [1, 0], [1, 1]], "Examplemed", 0.8)]

    easy = EasyOCRProvider(model_storage_directory=tmp_path, reader=EasyReader())
    assert easy.recognize(Image.new("RGB", (20, 20), "white"), 1, 1.0)[0].text == "Examplemed"

    class Processor:
        def __call__(self, *, images, return_tensors: str):
            assert len(images) == 1 and return_tensors == "pt"
            return SimpleNamespace(pixel_values="pixels")

        def batch_decode(self, _generated, *, skip_special_tokens: bool):
            assert skip_special_tokens
            return ["Examplemed"]

    class Model:
        def generate(self, pixels):
            assert pixels == "pixels"
            return [1]

    trocr = TrOCRHandwrittenProvider(model_directory=tmp_path, processor=Processor(), model=Model())
    regions = [OCRRegion(_polygon(), Image.new("RGB", (20, 20), "white"))]
    assert trocr.recognize_regions(regions, 1, 1.0)[0].text == "Examplemed"


def test_easyocr_initializes_reader_once_under_concurrency_and_reports_timings(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reader_options: list[dict[str, object]] = []

    class EasyReader:
        def readtext(self, _image, detail: int, paragraph: bool):
            assert detail == 1 and not paragraph
            return [([[0, 0], [1, 0], [1, 1]], "Examplemed", 0.9)]

    def create_reader(languages: list[str], **options: object) -> EasyReader:
        reader_options.append({"languages": languages, **options})
        sleep(0.02)
        return EasyReader()

    monkeypatch.setitem(sys.modules, "easyocr", SimpleNamespace(Reader=create_reader))
    provider = EasyOCRProvider(model_storage_directory=tmp_path)
    image = Image.new("RGB", (20, 20), "white")

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda page: provider.recognize(image, page, 1.0), (1, 2)))

    assert [result[0].text for result in results] == ["Examplemed", "Examplemed"]
    assert provider.initialization_elapsed_ms is not None
    assert provider.last_inference_elapsed_ms is not None
    assert len(reader_options) == 1
    assert reader_options[0]["gpu"] is False
    assert reader_options[0]["download_enabled"] is False


def test_timeout_is_reported_without_suppressing_available_provider_output() -> None:
    class SlowProvider:
        engine_name = "slow"

        def recognize(self, _image: Image.Image, _page_number: int, _timeout_seconds: float) -> list[OCRPrediction]:
            sleep(0.03)
            return []

    result = HybridOCREngine(
        [StaticProvider("paddleocr", [("Examplemed", _polygon())]), SlowProvider()],
        per_engine_timeout_seconds=0.001,
    ).recognize_page(Image.new("RGB", (300, 100), "white"), 1)
    assert any(failure.engine_name == "slow" and failure.code == "TIMEOUT" for failure in result.failures)
    assert result.to_ocr_page_result().full_text == "Examplemed"


def test_local_model_providers_fail_closed_when_assets_are_missing(tmp_path: Path) -> None:
    config = PaddleOCRLocalModelConfig(tmp_path / "missing-det", tmp_path / "missing-rec")
    with pytest.raises(ValueError):
        config.validate()
    with pytest.raises(OCRProviderError):
        EasyOCRProvider(model_storage_directory=tmp_path / "missing").recognize(Image.new("RGB", (20, 20), "white"), 1, 1.0)
    with pytest.raises(OCRProviderError):
        TrOCRHandwrittenProvider(model_directory=tmp_path / "missing").recognize_regions(
            [OCRRegion(_polygon(), Image.new("RGB", (20, 20), "white"))], 1, 1.0
        )


def test_easyocr_pipeline_imports_without_paddleocr() -> None:
    project_root = Path(__file__).resolve().parents[2]
    script = """
import builtins
import tempfile
import sys
from pathlib import Path
from PIL import Image
real_import = builtins.__import__
def import_without_paddle(name, *args, **kwargs):
    if name == "paddleocr" or name.startswith("paddleocr."):
        raise ImportError("PaddleOCR is unavailable.")
    return real_import(name, *args, **kwargs)
builtins.__import__ = import_without_paddle
from app.layer1_document_processing.ocr_engine import PaddleOCRLocalModelConfig
from app.layer1_document_processing.hybrid_ocr import EasyOCRProvider, HybridOCREngine, TrOCRHandwrittenProvider
from app.integration.local_pdf_pipeline import process_local_pdf_with_hybrid_ocr_to_contract_v1
assert EasyOCRProvider is not None
assert PaddleOCRLocalModelConfig is not None
assert process_local_pdf_with_hybrid_ocr_to_contract_v1 is not None
sys.modules["transformers"] = None
class EasyReader:
    def readtext(self, _image, detail, paragraph):
        assert detail == 1 and not paragraph
        return [([[10, 10], [200, 10], [200, 30], [10, 30]], "Examplemed", 0.9)]
with tempfile.TemporaryDirectory() as model_directory:
    easy = EasyOCRProvider(model_storage_directory=Path(model_directory), reader=EasyReader())
    trocr = TrOCRHandwrittenProvider(model_directory=Path(model_directory))
    result = HybridOCREngine([easy], handwritten_provider=trocr).recognize_page(Image.new("RGB", (300, 100), "white"), 1)
    assert result.to_ocr_page_result().full_text == "Examplemed"
    assert any(failure.engine_name == "trocr_base_handwritten" and failure.code == "UNAVAILABLE" for failure in result.failures)
"""
    subprocess.run(
        [sys.executable, "-c", script],
        cwd=project_root,
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
    )


def test_hybrid_pdf_path_maps_agreed_fictional_text_to_contract_v1(tmp_path: Path) -> None:
    lines = [
        ("Rx", _polygon(10)),
        ("Tab Examplemed 10 mg", _polygon(40)),
        ("1-0-0 for 3 days", _polygon(70)),
    ]
    providers = [StaticProvider("paddleocr", lines), StaticProvider("easyocr", lines)]
    response, evidence = process_local_pdf_with_hybrid_ocr_to_contract_v1(
        pdf_path=_pdf(tmp_path / "fictional.pdf"),
        job_id=JOB_ID,
        prescription_id=PRESCRIPTION_ID,
        hybrid_ocr=HybridOCREngine(providers),
        render_dpi=72,
    )

    assert providers[0].image_sizes == [(595, 842)]
    assert evidence[0].regions[1].state == "agreement"
    assert response["status"] == "completed_with_warnings"
    assert response["medicines"][0]["medicine_match"]["brand_name"] == "Examplemed"


def test_medicine_label_from_easyocr_reaches_contract_match(tmp_path: Path) -> None:
    lines = [
        ("Rx", _polygon(10)),
        ("Medicine: Examplemed 10 mg", _polygon(40)),
        ("One tablet once daily for 3 days", _polygon(70)),
    ]
    response, evidence = process_local_pdf_with_hybrid_ocr_to_contract_v1(
        pdf_path=_pdf(tmp_path / "medicine-label.pdf"),
        job_id=JOB_ID,
        prescription_id=PRESCRIPTION_ID,
        hybrid_ocr=HybridOCREngine([StaticProvider("easyocr", lines)]),
        render_dpi=72,
    )

    assert evidence[0].to_ocr_page_result().full_text.splitlines()[1] == "Medicine: Examplemed 10 mg"
    assert response["medicines"][0]["extraction"]["medicine_name"] == "Examplemed"
    assert response["medicines"][0]["medicine_match"]["brand_name"] == "Examplemed"


def test_paddle_provider_maps_existing_engine_result_without_loading_models(tmp_path: Path) -> None:
    class Engine:
        def process_page(self, _image: Image.Image) -> OCRPageResult:
            return OCRPageResult("Examplemed", [OCRBlock("Examplemed", 0.8, [[0, 0], [1, 0], [1, 1]])])

    provider = PaddleOCRProvider(PaddleOCRLocalModelConfig(tmp_path, tmp_path), engine=Engine())
    result = provider.recognize(Image.new("RGB", (20, 20), "white"), 1, 1.0)
    assert result[0].text == "Examplemed"
