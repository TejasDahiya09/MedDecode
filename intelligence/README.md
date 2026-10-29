# Intelligence execution notes

Use `intelligence/` as the working directory for service commands, test discovery, and manual scripts. The relocated service retains its original `app/` package, `tests/` tree, `requirements.txt`, and `test_ocr_manual.py` contents.

Source and tests use imports such as `from app.schemas...`. Keeping this directory as the service root preserves that convention without changing Python imports or adding a new packaging configuration. Repository-root execution is not configured by this integration.

Dependencies are listed in `requirements.txt`. OCR source also imports NumPy and PaddleOCR, which are not explicitly declared there; the intelligence owner must confirm the complete dependency set. No dependencies were installed or changed during structural integration.

`tests/layer1/`, `tests/layer2/`, and `tests/layer3/` contain the existing tests. `test_ocr_manual.py` creates a synthetic image and invokes the OCR engine; it was not executed. Do not treat structural or syntax validation as a runtime test result.

`app/main.py` and the layer 4/5 initialization files are empty. This snapshot does not establish a running intelligence HTTP service. Runtime tests and service startup remain unverified.
