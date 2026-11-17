from __future__ import annotations

from types import SimpleNamespace

import pytest
from PIL import Image

from app.layer1_document_processing.google_vision_provider import (
    GoogleVisionProvider,
    GoogleVisionTimeoutError,
)
from app.layer1_document_processing.hybrid_ocr import (
    CloudOCRDisabledError,
    OCRPrediction,
    OCRProviderError,
)


def _word(
    text: str,
    *,
    confidence: float | None = 0.9,
    offset: int = 0,
) -> SimpleNamespace:
    symbols = [SimpleNamespace(text=character) for character in text]
    return SimpleNamespace(
        symbols=symbols,
        confidence=confidence,
        bounding_box=SimpleNamespace(
            vertices=[
                SimpleNamespace(x=offset, y=0),
                SimpleNamespace(x=offset + 10, y=0),
                SimpleNamespace(x=offset + 10, y=5),
                SimpleNamespace(x=offset, y=5),
            ]
        ),
    )


def _response(*words: SimpleNamespace) -> SimpleNamespace:
    return SimpleNamespace(
        full_text_annotation=SimpleNamespace(
            pages=[
                SimpleNamespace(
                    blocks=[
                        SimpleNamespace(
                            paragraphs=[SimpleNamespace(words=list(words))]
                        )
                    ]
                )
            ]
        )
    )


class FakeTransport:
    def __init__(self, response: object | Exception) -> None:
        self.response = response
        self.calls: list[tuple[bytes, float]] = []

    def document_text(self, image_bytes: bytes, timeout_seconds: float) -> object:
        self.calls.append((image_bytes, timeout_seconds))
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def test_recognizes_document_text_and_preserves_common_prediction_schema() -> None:
    transport = FakeTransport(_response(_word("Examplemed", confidence=0.87)))
    provider = GoogleVisionProvider(enabled=True, transport=transport)

    result = provider.recognize(Image.new("RGB", (20, 10), "white"), 3, 4.0)

    assert len(transport.calls) == 1
    assert transport.calls[0][1] == 4.0
    assert transport.calls[0][0].startswith(b"\x89PNG\r\n\x1a\n")
    assert result == [
        OCRPrediction(
            engine_name="google_cloud_vision",
            engine_version="document-text-detection",
            page_number=3,
            text="Examplemed",
            polygon=((0.0, 0.0), (10.0, 0.0), (10.0, 5.0), (0.0, 5.0)),
            raw_confidence=0.87,
            model_provenance="google-cloud-vision-document-text-detection",
        )
    ]


def test_preserves_handwritten_like_words_and_multiple_regions() -> None:
    handwritten_response = _response(
        _word("Medicine:", confidence=0.62),
        _word("Examplemed", confidence=None, offset=20),
    )
    result = GoogleVisionProvider(
        enabled=True,
        transport=FakeTransport(handwritten_response),
    ).recognize(Image.new("RGB", (40, 10), "white"), 1, 2.0)

    assert [item.text for item in result] == ["Medicine:", "Examplemed"]
    assert result[0].raw_confidence == 0.62
    assert result[1].raw_confidence is None
    assert all(item.page_number == 1 for item in result)
    assert all(item.polygon is not None for item in result)
    assert all(item.model_provenance.startswith("google-cloud-vision") for item in result)


def test_empty_document_returns_no_predictions() -> None:
    response = SimpleNamespace(full_text_annotation=None)
    assert GoogleVisionProvider(
        enabled=True,
        transport=FakeTransport(response),
    ).recognize(Image.new("RGB", (10, 10)), 1, 1.0) == []


def test_missing_annotation_returns_empty_document() -> None:
    assert GoogleVisionProvider(
        enabled=True,
        transport=FakeTransport(SimpleNamespace()),
    ).recognize(Image.new("RGB", (10, 10)), 1, 1.0) == []


def test_disabled_provider_does_not_invoke_transport() -> None:
    transport = FakeTransport(_response(_word("Examplemed")))
    provider = GoogleVisionProvider(transport=transport)

    with pytest.raises(CloudOCRDisabledError):
        provider.recognize(Image.new("RGB", (10, 10)), 1, 1.0)

    assert transport.calls == []


def test_transport_failure_and_timeout_are_safe() -> None:
    image = Image.new("RGB", (10, 10))
    with pytest.raises(OCRProviderError, match="request failed"):
        GoogleVisionProvider(
            enabled=True,
            transport=FakeTransport(RuntimeError("sensitive provider details")),
        ).recognize(image, 1, 1.0)

    with pytest.raises(GoogleVisionTimeoutError):
        GoogleVisionProvider(
            enabled=True,
            transport=FakeTransport(TimeoutError()),
        ).recognize(image, 1, 0.1)


def test_google_transport_calls_document_text_detection_with_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.layer1_document_processing.google_vision_provider import GoogleVisionTransport

    calls: list[dict[str, object]] = []
    api_response = _response(_word("Examplemed"))

    class FakeVisionClient:
        def document_text_detection(self, **kwargs):
            calls.append(kwargs)
            return api_response

    fake_vision = SimpleNamespace(
        Image=lambda *, content: SimpleNamespace(content=content),
        ImageAnnotatorClient=FakeVisionClient,
    )
    real_import = __import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "google.cloud":
            return SimpleNamespace(vision=fake_vision)
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr("builtins.__import__", fake_import)
    encoded = b"rendered-page"
    assert GoogleVisionTransport().document_text(encoded, 3.5) is api_response
    assert calls == [{"image": SimpleNamespace(content=encoded), "timeout": 3.5}]


def test_missing_credentials_fail_safely_without_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class MissingCredentialsError(Exception):
        pass

    class UnauthenticatedVisionClient:
        def __init__(self) -> None:
            raise MissingCredentialsError("credential details must not escape")

    fake_vision = SimpleNamespace(ImageAnnotatorClient=UnauthenticatedVisionClient)
    real_import = __import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "google.cloud":
            return SimpleNamespace(vision=fake_vision)
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr("builtins.__import__", fake_import)
    with pytest.raises(OCRProviderError, match="request failed") as error:
        GoogleVisionProvider(enabled=True).recognize(Image.new("RGB", (10, 10)), 1, 1.0)
    assert "credential details" not in str(error.value)


def test_api_error_response_and_invalid_confidence_fail_safely() -> None:
    image = Image.new("RGB", (10, 10))
    api_error = SimpleNamespace(
        error=SimpleNamespace(message="sensitive API detail"),
        full_text_annotation=None,
    )
    with pytest.raises(OCRProviderError, match="OCR error"):
        GoogleVisionProvider(
            enabled=True,
            transport=FakeTransport(api_error),
        ).recognize(image, 1, 1.0)

    with pytest.raises(OCRProviderError, match="malformed response"):
        GoogleVisionProvider(
            enabled=True,
            transport=FakeTransport(_response(_word("Examplemed", confidence=float("nan")))),
        ).recognize(image, 1, 1.0)


def test_rejects_malformed_api_response_without_leaking_details() -> None:
    malformed = SimpleNamespace(
        full_text_annotation=SimpleNamespace(
            pages=[SimpleNamespace(blocks=[SimpleNamespace(paragraphs=[SimpleNamespace()])])]
        )
    )
    with pytest.raises(OCRProviderError, match="malformed response"):
        GoogleVisionProvider(
            enabled=True,
            transport=FakeTransport(malformed),
        ).recognize(Image.new("RGB", (10, 10)), 1, 1.0)


def test_module_import_and_default_provider_construction_do_not_load_google_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import builtins

    real_import = builtins.__import__

    def reject_google_import(name: str, *args, **kwargs):
        if name == "google" or name.startswith("google."):
            raise AssertionError("Google client import must be deferred until an enabled request.")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", reject_google_import)
    provider = GoogleVisionProvider()
    with pytest.raises(CloudOCRDisabledError):
        provider.recognize(Image.new("RGB", (10, 10)), 1, 1.0)
