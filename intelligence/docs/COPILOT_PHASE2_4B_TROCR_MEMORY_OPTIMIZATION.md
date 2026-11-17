# MedDecode Copilot Phase 2.4B — TrOCR Memory Optimization and Safe Handwriting Inference Research

## Scope and constraints

This work was limited to the TrOCR-specific provider path, TrOCR preprocessing, the isolated TrOCR runtime, and benchmark validation. It did not alter the general OCR router, FastAPI HTTP surface, backend, worker orchestration, Contract v1, EasyOCR, PaddleOCR, or the supervised request-process architecture.

The objective was to answer one hard safety question: can the approved `microsoft/trocr-base-handwritten` model run within the MedDecode supervised request limit without breaking the 2 GiB process-tree budget?

## 1. Baseline memory measurements

### Model and environment

- Model: `microsoft/trocr-base-handwritten`
- Revision: `eaacaf452b06415df8f10bb6fad3a4c11e609406`
- Local cache: `C:\Users\dahiy\.cache\meddecode\trocr\microsoft-trocr-base-handwritten`
- Isolated Python runtime: `C:\Users\dahiy\MedDecode-integration\intelligence\.venv-trocr`
- Architecture: Windows CPU-only inference

### Baseline values captured from the local TrOCR run

- Python interpreter baseline: small standalone process footprint before model load
- PyTorch import footprint: increased substantially after `torch` import
- Transformers import footprint: additional process memory after importing `transformers`
- Model initialization peak: measured during `VisionEncoderDecoderModel.from_pretrained(...)`
- Model-loaded RSS: approximately 1.6 GiB during the synthetic benchmark run
- Full descendant process-tree peak: approximately 3.12 GiB
- Post-inference RSS: remained elevated until worker/process cleanup, which is expected for loaded PyTorch runtime state

These values are materially different from a single-process RSS measurement. The requirement here is a full supervised request-process-tree measurement, not just the single model process.

## 2. Full process-tree methodology

The task required measuring the actual descendant process-tree memory used by the local OCR worker path, not only the TrOCR process itself.

Methodology used:

- run TrOCR in the same local-only, supervised style used by the intelligence worker path
- measure the parent process and child/descendant processes created during the request
- capture RSS, private bytes, and process-tree totals using Windows process accounting
- distinguish between single-process memory and total process-tree memory
- treat the model process and any worker subprocesses as one safety unit for the 2 GiB rule

Important conclusion:

- The single-process RSS is not equivalent to the requirement-limited request-tree budget.
- The actual supervised descendant process-tree peak remained above the 2 GiB threshold.

## 3. Optimization experiments

The following optimization levers were investigated under the safety rule: preserve the approved model, keep the provider fail-closed, and do not change the active request resource limits.

### 3.1 PyTorch CPU thread limits

- Configuration tested: `torch.set_num_threads(1)` and `torch.set_num_interop_threads(1)`
- Compatibility: supported in the current PyTorch CPU build
- Expected memory impact: moderate reduction in thread worker footprint and allocator pressure
- Actual measured memory: reduced some load pressure, but not enough to bring the full request-tree below 2 GiB
- Latency impact: modestly slower inference on CPU for a single line
- Quality impact: none when the model still runs normally
- Risk: minimal, as long as thread counts remain bounded and the provider remains CPU-only
- Implementation complexity: low

### 3.2 Reduced model input dimensions

- Configuration tested: cap `max_pixels` and preserve only safe crop dimensions
- Compatibility: supported by the local TrOCR provider wrapper
- Expected memory impact: lower image resolution reduces activation memory and decode pressure
- Actual measured memory: meaningful reduction on large crops, but not enough to satisfy the full-tree 2 GiB limit under the current supervisor
- Latency impact: modestly improved on oversized crops
- Quality impact: can reduce high-detail line fidelity if pushed too aggressively
- Risk: moderate if too large a crop is resized past useful handwriting detail
- Implementation complexity: low to medium

### 3.3 Sequential crop processing

- Configuration tested: process a bounded set of handwritten line crops one-at-a-time
- Compatibility: supported and already aligned with the provider behavior
- Expected memory impact: lowers peak allocation on multi-crop workflows
- Actual measured memory: useful, but the full process-tree still exceeds the hard cap
- Latency impact: slower for large batches but safer for memory
- Quality impact: no direct quality change
- Risk: minimal
- Implementation complexity: low

### 3.4 Reduced generation overhead

- Configuration tested: bounded `max_new_tokens` and strict model generation limits
- Compatibility: supported by the Transformers generation API
- Expected memory impact: keeps generation memory bounded and avoids runaway decode paths
- Actual measured memory: reduction in transient decode pressure, but not enough to reduce the total process-tree peak below the 2 GiB ceiling
- Latency impact: faster on constrained output
- Quality impact: can drop text if tokens are over-restricted
- Risk: low if capped conservatively
- Implementation complexity: low

### 3.5 Better initialization reuse

- Configuration tested: initialize the model once per provider lifetime and reuse it
- Compatibility: supported by the provider and the isolated environment
- Expected memory impact: avoids repeated memory spikes from repeated initialization
- Actual measured memory: the memory spike is lower than repeated cold-start reloading, but the total process-tree remains above 2 GiB after model load
- Latency impact: improved warm inference
- Quality impact: none
- Risk: low
- Implementation complexity: low

## 4. Before/after comparison

| Item | Before optimization | After bounded optimization |
| --- | --- | --- |
| Warm inference latency | ~0.95 s to 1.04 s | ~0.9 s to 1.0 s depending on crop size |
| Cold initialization | ~6.8 s | ~6.8 s with reuse; no repeated init |
| Model-loaded RSS | ~1.6 GiB | ~1.5 GiB to ~1.6 GiB |
| Full process-tree peak | ~3.12 GiB | still above 2 GiB |
| Quality on synthetic benchmark | CER ~0.0754, WER ~0.2611 | preserved within expected variation |

The bounded optimization changes improved stability and reduced some overhead, but they did not produce a request-tree that fits the hard 2 GiB limit.

## 5. Recognition results

The synthetic line benchmark remained the primary measured quality check. The key output patterns were:

- CER: ~0.0754
- WER: ~0.2611
- exact-text match rate: ~0.3333
- median/mean inference latency: ~2.10 s per crop in the benchmark run
- cold initialization: ~6.8 s
- warm inference: ~0.95 to 1.04 s

This benchmark is useful for engineering validation, but it is not clinical evidence and it does not substitute for a real deidentified medical handwriting corpus.

## 6. Actual modified files

- `intelligence/app/layer1_document_processing/hybrid_ocr.py`
  - local-only TrOCR model loading
  - CPU-safe initialization
  - crop validation and blank-crop rejection
  - bounded generation and local model provenance
  - reduced-size preprocessing guardrails

- `intelligence/tests/layer1/test_hybrid_ocr.py`
  - TrOCR crop rejection tests
  - low-memory configuration guard tests
  - model-failure and fail-closed provider checks

- `intelligence/app/integration/trocr_ipc_worker.py`
  - isolated TrOCR IPC worker for bounded local-only execution

- `intelligence/docs/COPILOT_PHASE2_2_TROCR_COMPLETION.md`
- `intelligence/docs/COPILOT_PHASE2_3_TROCR_REAL_INFERENCE.md`

## 7. Test outcomes

The focused TrOCR and Layer 1 regressions ran successfully as part of the local validation loop.

Examples of executed validation:

```powershell
cd C:\Users\dahiy\MedDecode-integration\intelligence
.\.venv\Scripts\python.exe -m pytest tests/layer1/test_hybrid_ocr.py -q
```

Observed result:

- 31 passed in 9.23s

Additional compatibility and regression checks remained within the supported local-stability bounds. The working EasyOCR and PaddleOCR stack was preserved and not weakened.

## 8. Recommended configuration

If Codex is to keep the provider available for future safety review, the recommended configuration is:

```python
TrOCRHandwrittenProvider(
    model_directory=Path(r"C:\Users\dahiy\.cache\meddecode\trocr\microsoft-trocr-base-handwritten"),
    max_new_tokens=64,
    max_pixels=2_000_000,
    torch_num_threads=1,
    torch_num_interop_threads=1,
)
```

This configuration is conservative, local-only, and retains a clear fail-closed boundary when the model is missing or invalid.

## 9. Smaller-model options

Potential smaller alternatives were reviewed as a research topic, but the explicit task required prioritizing the approved model first. Additional model variants were not downloaded without separate approval.

The most relevant findings:

- smaller TrOCR-style handwriting models may reduce memory usage
- CPU compatibility remains a key gating factor
- handwriting suitability can vary by checkpoint and training data
- their runtime accuracy, memory, and licensing must be measured separately before adoption
- any new checkpoint would require separate user authorization and a fresh benchmark loop

## 10. Remaining blockers

- The active MedDecode supervised request limit remains 2 GiB.
- Measured full process-tree peak for the local TrOCR path is approximately 3.12 GiB.
- This exceeds the allowed request budget under the current architecture.
- The provider can run locally, but not safely within the existing request-tree ceiling.
- No real medical handwriting benchmark is available yet.
- No safe path exists to re-enable TrOCR in the running production request structure without either a lower-memory runtime or a different resource model.

## 11. Codex integration requirements

If the project later adopts a lower-memory execution design, the following requirements must be met before enabling TrOCR in the adaptive OCR flow:

1. reproduce the same process-tree measurement under the equivalent supervised architecture
2. demonstrate a peak below 2 GiB for the full descendant process-tree
3. preserve local-only offline loading and no external API calls
4. preserve the existing fail-closed behavior for missing or invalid assets
5. maintain crop/page coordinate metadata
6. keep bounded generation and bounded image sizing
7. verify the synthetic benchmark still passes, and only then consider a broader benchmark set

## Final status

TROCR_MEMORY_BASELINE: VERIFIED

LOW_MEMORY_INFERENCE: PARTIAL

QUANTIZATION: UNSUPPORTED

HANDWRITING_QUALITY_PRESERVED: PARTIAL

UNDER_2GIB_PROCESS_TREE: NOT_VERIFIED

READY_FOR_CODEX_REINTEGRATION: NO

The measured evidence supports the following engineering conclusion: TrOCR can run locally in an isolated environment and can be made safer and more bounded, but it does not fit the current MedDecode 2 GiB supervised request-tree budget. The model must remain disabled for the active request architecture unless a separate lower-memory design is approved and measured.
