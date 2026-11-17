# MedDecode Copilot Phase 2.2 TrOCR Completion

## 1. Model selection rationale

Candidate reviewed: `microsoft/trocr-base-handwritten`.

This was selected as the most appropriate approved starting point for a handwritten line provider because:

- it is explicitly designed for handwritten text recognition, not a generic printed-text model;
- it is a line-level recognition model suited to cropped prescription fields rather than whole-page OCR;
- it uses the Hugging Face `transformers` stack with a standard `TrOCRProcessor` and `VisionEncoderDecoderModel` interface;
- it is CPU-capable in a local runtime when installed with a compatible `transformers`/PyTorch stack;
- the architecture is compatible with the repo's crop-to-line provider pattern and local-only asset loading;
- it is not being promoted as Indian-medical handwriting-specialized; the project has no evidence for a domain-specific medical handwriting claim.

Important boundaries:

- no medical claim was made that the model is specialized for Indian prescription handwriting;
- the selection was made from technical fit and practical local runtime constraints, not popularity;
- the actual checkpoint still requires explicit approval before download due the model size and local asset policy.

## 2. Dependencies

The active intelligence environment currently reports:

- Python: 3.12.10
- PyTorch: 2.6.0+cpu
- EasyOCR: 1.7.2
- PaddleOCR: 3.7.0
- PaddlePaddle: 3.2.2
- `transformers`: missing in the active environment
- `safetensors`: missing in the active environment
- `tokenizers`: missing in the active environment
- `huggingface_hub`: not yet installed in the pinned runtime path

The repository-specific requirement is to keep the working OCR baseline stable and avoid destabilizing EasyOCR or PaddleOCR while the handwriting provider remains approval-gated.

The intended dependency path, when approved, is a lightweight pinned install for the local-only handwritten path:

```powershell
cd C:\Users\dahiy\MedDecode-integration\intelligence
.\.venv\Scripts\python.exe -m pip install "transformers==4.49.0" "safetensors==0.5.3" "tokenizers==0.21.4" "huggingface-hub==1.0.0"
```

This is a local CPU-only installation and is intentionally not executed without explicit approval.

## 3. Required model assets

Required model assets for the provider:

- `microsoft/trocr-base-handwritten`
- the processor config files (`tokenizer.json`, `preprocessor_config.json`, `config.json`)
- the model weight file (`model.safetensors` or a compatible checkpoint format)
- no remote download at runtime; this provider is intentionally `local_files_only=True`

Recommended local asset layout:

- a local model directory such as `C:\Users\dahiy\MedDecode-integration\intelligence\artifacts\trocr\microsoft-trocr-base-handwritten`
- the directory must contain the exact Hugging Face checkpoint contents required by the model repo and processor

Approximate known footprint:

- model weights: ~1.33 GB
- full repository payload and metadata can exceed 2 GB depending on the exact artifact set
- CPU memory requirement: roughly 2–5 GB depending on batch, image dimensions, and PyTorch overhead

This was reviewed as a practical local runtime limit, not a medical-performance claim.

## 4. Actual model availability

Actual status in the current environment:

- no verified local TrOCR checkpoint was present;
- no local `transformers` installation was present;
- no explicit model-download approval was granted;
- no runtime implicit download was executed.

This means the handwritten provider remains safely fail-closed until approvals and assets are present.

## 5. Files changed

Changed or added under the authorized scope:

- `intelligence/app/layer1_document_processing/hybrid_ocr.py`
- `intelligence/tests/layer1/test_hybrid_ocr.py`
- `intelligence/docs/COPILOT_PHASE2_2_TROCR_COMPLETION.md`

No Codex-owned or shared-contract files were modified.

## 6. Adapter implementation

The TrOCR provider now includes the following safety and runtime protections:

- local-only model loading with `local_files_only=True`;
- explicit missing-model failure via `OCRProviderError`;
- CPU-only inference path;
- guarded generation with bounded `max_new_tokens`;
- unsupported image and blank-line rejection;
- minimum crop-size validation;
- maximum crop-area validation;
- parity with the provider lifecycle expected by the hybrid OCR engine;
- no external API calls;
- no unbounded thread pool usage;
- no change to the HTTP or contract layer; the integration remains an internal provider interface.

The adapter remains a handwritten line provider for single-line crops and preserves the original page coordinate polygon on output predictions.

## 7. Preprocessing

Implemented TrOCR-specific preprocessing logic includes:

- `RGB` conversion;
- crop rejection for empty or near-empty areas;
- minimum useful dimension guard;
- maximum dimension guard to prevent oversized CPU workloads;
- aspect-ratio-preserving pad for the processor path;
- basic whitespace padding to avoid clipping;
- no destructive normalization of medication names, decimals, units, or medicine characters.

Blank-crop detection is intentionally conservative: a nearly constant-value image is treated as absent handwriting and skipped instead of being force-decoded.

## 8. Test results

Targeted validation executed in the active environment:

- `pytest tests/layer1/test_hybrid_ocr.py -q` -> 30 passed
- `pytest tests/layer1 -q` -> 70 passed

These pass results were achieved with the local OCR baseline intact and without enabling hosted workers or changing contract v1 behavior.

The TrOCR-specific tests cover:

- processor input contract;
- RGB normalization and conversion;
- crop handling;
- blank and invalid crop rejection;
- page coordinate preservation;
- missing checkpoint fail-closed behavior;
- missing dependency behavior;
- bounded generation path;
- provider provenance and result schema.

## 9. Real inference evidence, if available

No real TrOCR inference was executed in the current environment.

Reason:

- `transformers` is not installed;
- the model checkpoint is not present locally;
- approval to download the model was not granted;
- the provider is intentionally blocked from implicit remote-model download.

Therefore, no genuine TrOCR handwriting recognition evidence is available from this environment yet.

## 10. Measured accuracy, if available

No labelled handwritten dataset was available for a genuine TrOCR measurement.

This means the repository still does not have:

- verified ground truth for medicine names;
- verified strength and frequency labels;
- a deidentified medical handwriting benchmark;
- measured CER/WER or exact-text accuracy for the handwritten model.

This remains unmeasured and is reported as missing rather than guessed.

## 11. Memory/runtime observations

Observed from the engineering layer and practical runtime review:

- the TrOCR checkpoint is large enough that a local CPU-only run is materially heavier than the current EasyOCR/PaddleOCR baseline;
- the candidate model is a single-line handwritten design, but still requires substantial CPU memory for model initialization and generation;
- the model should be initialized once per worker lifetime and re-used rather than reloading for every crop;
- the adapter keeps a single lazy initialization path and avoids uncontrolled repeated setup.

Observed current environment facts:

- EasyOCR and PaddleOCR are operational locally;
- TrOCR dependencies and checkpoint are not yet installed;
- no real TrOCR runtime latency or accuracy measurement is available because the model is not authorized to download.

## 12. Codex integration interface

The handwritten provider interface is intentionally documented but not activated in FastAPI or general adaptive routing.

Python module path:

- `intelligence.app.layer1_document_processing.hybrid_ocr.TrOCRHandwrittenProvider`

Constructor signature:

```python
TrOCRHandwrittenProvider(
    *,
    model_directory: Path,
    processor: Any | None = None,
    model: Any | None = None,
    max_new_tokens: int = 64,
    max_pixels: int = 2_000_000,
)
```

Recognition method:

```python
recognize_regions(regions: Sequence[OCRRegion], page_number: int, timeout_seconds: float) -> list[OCRPrediction]
```

Input shape:

- sequence of `OCRRegion` objects; each region contains a page-relative polygon and a cropped image

Output shape:

- list of `OCRPrediction` entries with `engine_name`, `page_number`, `text`, polygon, provenance, and style metadata

Local model path configuration:

- pass the approved local checkpoint directory via `model_directory`

Model initialization lifecycle:

- lazy initialization on first `recognize_regions` call;
- one-time local model setup per provider instance;
- CPU-only inference;
- fail-closed when assets are missing

Error types:

- `OCRProviderError` for absent model, missing dependency, invalid crop, bad local directory, or unsupported input

CPU/RAM requirements:

- CPU-only; estimate is high relative to EasyOCR/PaddleOCR; requires a local environment with enough memory for initialization and generation

Timeout assumptions:

- the provider accepts the same supervised-process timeout semantics as the rest of the intelligence layer; it does not bypass cancellation architecture

Region/page coordinate behavior:

- the original page polygons are preserved in the prediction output

Tests:

- implemented in `intelligence/tests/layer1/test_hybrid_ocr.py`
- pass in the current environment without a real model

## 13. Remaining blockers

- explicit user approval is required before installing the pinned `transformers` stack;
- explicit user approval is required before downloading the approved TrOCR checkpoint;
- no deidentified handwritten benchmark exists for validation;
- no real TrOCR accuracy measurement is available yet;
- the adapter remains ready but not active for live inference until those prerequisites are satisfied.

## 14. Exact actions requiring user approval

1. Approve the install of a pinned CPU-compatible `transformers` stack (`transformers`, `safetensors`, `tokenizers`, `huggingface-hub`).
2. Approve the local download of `microsoft/trocr-base-handwritten` into a controlled repository-local or user-local model directory.
3. Approve a small privacy-safe handwritten benchmark with independently verified transcription and medication-field labels.
4. Approve the final activation step for a local TrOCR inference smoke test after the model directory has been validated.

This task did not assume approval; no model download occurred.

TROCR_ADAPTER: VERIFIED
TROCR_DEPENDENCIES: PARTIAL
TROCR_CHECKPOINT: APPROVAL_REQUIRED
TROCR_REAL_INFERENCE: BLOCKED
HANDWRITING_EVALUATION: MISSING
CODEX_INTEGRATION_INTERFACE: READY
