# MedDecode Phase 2.1 Hybrid OCR Completion

Date: 2026-11-14
Implementer: Codex under the user's explicit temporary Phase 2.1 ownership exception
Branch: `integration/full-project`

## Scope and safety

This phase changed only intelligence Layer 1 implementation, intelligence-specific tests, benchmark tooling/data, and this document. It did not change FastAPI transport, process supervision, backend/worker code, hosted database objects, shared Contract v1, cloud OCR configuration, or automatic-worker state. No model was downloaded and neither AWS Textract nor Google Cloud Vision was called.

The temporary ownership exception ends with this completion. Original Codex/Copilot file boundaries resume afterward.

## 1. Files changed

- `intelligence/app/layer1_document_processing/adaptive_ocr.py`
- `intelligence/app/layer1_document_processing/hybrid_ocr.py`
- `intelligence/app/evaluation/__init__.py` (new)
- `intelligence/app/evaluation/ocr_benchmark.py` (new)
- `intelligence/data/ocr_benchmark/phase2_1_manifest.json` (new)
- `intelligence/data/ocr_benchmark/phase2_1_printed_results.json` (new)
- `intelligence/tests/layer1/test_adaptive_ocr.py`
- `intelligence/tests/layer1/test_hybrid_ocr.py`
- `intelligence/tests/evaluation/test_ocr_benchmark.py` (new)
- `intelligence/docs/COPILOT_PHASE2_1_COMPLETION.md` (new)

## 2. Corrected quality metrics

The saved implementation divided grayscale standard deviation by mean intensity, producing a dimensionless coefficient, then compared it with `25`. This made ordinary pages look low-contrast. It is corrected as follows:

| Signal | Unit/range | Conservative default | Interpretation |
| --- | --- | --- | --- |
| Contrast | grayscale standard deviation, `0..127.5` intensity levels | low below `18` | tonal separation only |
| Sharpness (`blur_score`) | variance of discrete Laplacian, intensity squared, `>=0` | low below `35` | larger values are sharper; not semantic quality |
| Resolution | source pixels | reported, not independently routed | source image area |
| Skew | median OCR top-edge angle, `-45..45` degrees | route beyond absolute `4°` | depends on available OCR polygons |
| Text density | OCR polygon area / page area, `0..1` | low below `0.005` | detection coverage, not handwriting proof |
| Layout irregularity | robust line-gap dispersion, `0..1` | route above `0.35` | sparse/mixed layouts can trigger it |
| Low confidence | provider-local score count | below `0.55` | only compared within a provider |
| Unrecognized regions | `0` or `1` page-level marker | route when `1` | no text recognized; cause unknown |
| Possible handwriting | heuristic `0..1` plus `unknown/possible` label | possible at `>=0.5` | explicitly unverified and never called confirmed handwriting |

Tests cover clean, low-contrast, blurred, skewed, empty, low-confidence, coordinate-boundary, and invalid-limit cases. Thresholds are safe defaults, not clinically calibrated operating points.

## 3. Region-level fallback

`AdaptiveOCRRouter` now:

- selects only predictions below the provider-local confidence threshold;
- expands crops by bounded configurable padding;
- clamps to the source image;
- rejects empty crops;
- merges overlapping/same-line fragments;
- deduplicates overlapping provider boxes;
- caps regions (default 12) and total fallback pixels (default 20 million);
- preserves source-page polygons;
- calls `recognize_regions` when the secondary provider supports it;
- withholds full-page fallback for a local uncertainty when the provider lacks region support;
- permits full-page fallback only for no recognized text or significant page skew;
- gives TrOCR only line crops, never arbitrary whole pages.

EasyOCR and PaddleOCR now expose region recognition that translates crop-local polygons back to page coordinates. Genuine Paddle region inference recognized `Examplemed 10 mg` and preserved the offset.

## 4. PaddleOCR validation and lifecycle

The adapter was tested with genuine cached PP-OCRv6 medium detection/recognition models. It preserved text, confidence, page ID, polygon, provider ID, and provenance on full pages and crops.

A concrete efficiency defect was fixed: `PaddleOCRProvider` previously constructed both models on every `recognize` call. It now lazily creates one engine under a lock and reuses it. A concurrent initialization regression test confirms one construction.

Genuine CPU inference covered clean print, multiline text, mixed font sizes, 7° rotation, poor contrast, small `0.5 mg` strength, a `5 mg + 50 mg` combination, and a region crop.

## 5. TrOCR assessment

Real TrOCR inference remains blocked:

- `transformers` is not installed;
- no TrOCR checkpoint exists in the local Hugging Face cache;
- no approved handwritten fixture exists;
- no package or model download was performed.

Reviewed candidate: `microsoft/trocr-base-handwritten`, a 0.3B-parameter single-line handwriting model fine-tuned on IAM. The model card declares MIT. The safetensors weight is approximately 1.33 GB; downloading the complete repository with duplicate PyTorch and safetensors weights would be about 2.67 GB. Estimated CPU working memory is approximately 2.5–5 GB depending on runtime overhead and batch size. This is not evidence of Indian medical-handwriting accuracy.

Proposed, **not executed**, dependency installation:

```powershell
cd C:\Users\dahiy\MedDecode-integration\intelligence
.\.venv\Scripts\python.exe -m pip install "transformers==4.49.0" "safetensors==0.5.3"
```

Proposed model acquisition should pin an approved revision and include only configuration/tokenizer files plus `model.safetensors`, excluding `pytorch_model.bin`. That requires separate approval because the weight is ~1.33 GB.

Rollback after a future approved installation:

```powershell
.\.venv\Scripts\python.exe -m pip uninstall transformers tokenizers huggingface-hub safetensors
```

Remove a downloaded checkpoint only after verifying the exact private cache/local-directory target. The current TrOCR adapter remains `local_files_only=True`, CPU-only, line-crop-only, and now runs generation under `torch.inference_mode()` with `max_new_tokens=64`.

References reviewed: `https://huggingface.co/microsoft/trocr-base-handwritten` and `https://huggingface.co/docs/transformers/model_doc/trocr`.

## 6. Benchmark inventory and metrics

The manifest covers all requested categories: clean print, neat handwriting, cursive handwriting, mixed print/handwriting, poor contrast, blur, skew, small strength, multiline instructions, similar medicine names, combination medicines, and abbreviated schedules.

Only independently known generated text is labelled. Neat, cursive, mixed handwriting, and similar-name image assets remain missing and are excluded from metrics. No patient prescription is present.

Metric implementation includes:

- CER and WER;
- raw and medicine-name exact match;
- strength, dosage-form, frequency, and duration accuracy;
- medicine extraction precision, recall, F1;
- false-positive count;
- unsafe medicine-substitution count;
- latency;
- Wilson 95% intervals for exact-match accuracy.

Normalization performs Unicode NFKC, case-folding, and whitespace compaction only. It preserves punctuation, decimals, and units, so `0.5 mg`, `5 mg`, and `5 mcg` remain different.

Machine-readable evaluation:

```powershell
cd C:\Users\dahiy\MedDecode-integration\intelligence
.\.venv\Scripts\python.exe -m app.evaluation.ocr_benchmark `
  --manifest data\ocr_benchmark\phase2_1_manifest.json `
  --observations C:\path\to\fictional-observations.json
```

### Genuine printed benchmark results

Seven identical generated fictional cases, CPU only:

| Provider | CER | WER | Exact | Mean latency | 95% Wilson exact interval |
| --- | ---: | ---: | ---: | ---: | ---: |
| EasyOCR 1.7.2 | 0.107143 | 0.095238 | 6/7 | 2684.9 ms | 0.4869–0.9743 |
| PaddleOCR 3.7.0 / PaddlePaddle 3.2.2 | 0 | 0 | 7/7 | 3774.1 ms | 0.6457–1.0 |

EasyOCR's only mismatch was ordering the rotated line as `10 mg Examplemed`. PaddleOCR retained the expected order. These seven controlled cases are runtime/behavior evidence, not representative handwriting or clinical-accuracy estimates. Field-level medical metrics are implemented but not reported for the seven OCR-only images because a separately verified extraction annotation/run was not performed.

The final real fictional PDF through EasyOCR and Layers 1–5 produced `completed_with_warnings`, one medicine, two warnings, 16.609 seconds, and 1,613,262,848 bytes peak supervised child-tree RSS. This was local inference with read-only catalogue access, not hosted job processing.

## 7. Evidence fusion

Reconciled regions now retain:

- provider/version/model provenance;
- page, polygon, raw text, and raw provider-local confidence;
- all competing predictions;
- agreement/disagreement state;
- explicit selection rationale;
- numeric, unit, frequency, or generic text-conflict indicators.

Cross-provider confidences are no longer compared. When normalized text agrees, the primary observation is retained with a rationale. When text differs, no prediction is selected. Tests specifically withhold `0.5 mg` versus `5 mcg` and once-daily versus twice-daily conflicts. Catalogue matching is not used to overwrite OCR uncertainty.

The additional rationale/indicators remain internal; Contract v1 was not changed. A future evidence API would require a separately reviewed optional contract extension.

## 8. Five-layer and Contract v1 verification

The complete Python suite exercises Layers 1–5, unknown medicines, missing fields, duplicates, uncertainty, recommendations, and Contract mapping. The final real fictional PDF additionally traversed all five layers. Layer 5 continues withholding unsupported alternatives/recommendations.

Contract v1 compatibility was checked by the full Python suite and 25 focused backend Contract/HTTP/worker tests. No shared schema changed.

## 9. Test results

- Phase 2.1 adaptive/hybrid/benchmark focused tests: 42 passed.
- Complete Python suite: 318 passed, one existing Starlette deprecation warning.
- Focused backend Contract v1/HTTP/worker tests: 25 passed.
- Genuine EasyOCR: passed on seven controlled printed cases and the final PDF.
- Genuine PaddleOCR: passed on seven controlled printed cases plus a bounded crop.
- Genuine TrOCR: not run; dependency/model assets absent.
- Cloud OCR calls: zero.
- Hosted processing/data changes: zero.

## 10. Known limitations and Codex handoff

- Handwriting accuracy is unknown because no approved labelled handwriting corpus exists.
- Quality thresholds are conservative engineering defaults, not calibrated probabilities.
- Provider-specific confidence values remain non-comparable.
- Paddle's rotated-case latency was unusually high in this small run; the sample is too small for performance conclusions.
- The adaptive router is not connected to the live FastAPI/local worker composition. Per the Phase 2.1 boundary, Codex must separately review a configuration that constructs EasyOCR primary + cached Paddle secondary and passes `AdaptiveOCRRouter.route` output into the existing hybrid reconciliation path. It must remain inside the Phase 1 supervised child, concurrency, timeout, and memory limits.
- Activation should be explicit and disabled by default until a fictional PDF/JPEG/PNG regression passes. TrOCR must remain absent/disabled until its separately approved dependencies, model, and handwriting benchmark exist.

## 11. Next phase

1. Obtain/independently transcribe privacy-safe neat, cursive, mixed, and similar-name fixtures.
2. Calibrate routing thresholds on those fixtures and report confidence intervals.
3. Separately approve pinned TrOCR dependencies/model if local handwriting inference is still desired.
4. Codex reviews guarded FastAPI/local-worker adaptive routing integration without changing Contract v1.
5. Rerun supervised PDF/JPEG/PNG resource and cancellation regressions before enabling adaptive routing.

## Final status

QUALITY_ANALYZER: VERIFIED

REGION_LEVEL_FALLBACK: VERIFIED

EASYOCR_REAL_INFERENCE: VERIFIED

PADDLEOCR_REAL_INFERENCE: VERIFIED

TROCR_REAL_INFERENCE: BLOCKED

HANDWRITING_BENCHMARK: PARTIAL

OCR_EVIDENCE_FUSION: PARTIAL

FIVE_LAYER_COMPATIBILITY: VERIFIED

CONTRACT_V1_COMPATIBILITY: VERIFIED

READY_FOR_CODEX_FASTAPI_INTEGRATION: YES
