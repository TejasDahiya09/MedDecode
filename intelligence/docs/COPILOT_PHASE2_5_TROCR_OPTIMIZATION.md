# MedDecode Copilot Phase 2.5 — TrOCR Memory Optimization, Handwriting Quality and Integration Readiness

## 1. Executive summary

The approved `microsoft/trocr-base-handwritten` checkpoint remains a valid local handwriting-recognition model, but the current supervised request-tree memory budget is still the dominant blocker for any production activation in the active FastAPI architecture. The work in this phase stayed within the file-ownership boundaries: TrOCR-specific optimization and benchmarking code was created in new modules, while the shared OCR pipeline and Codex-owned integration surfaces were left untouched.

The important evidence is as follows:

- The isolated TrOCR environment successfully loads the official checkpoint and performs genuine local inference.
- The model is CPU-compatible and can run in a dedicated Python runtime without cloud services.
- A direct isolated-process memory snapshot showed the model loaded at roughly 1.7 GiB RSS in a simple benchmark, while the earlier measured supervised descendant process-tree remained around 3.12 GiB.
- Dynamic INT8 quantization is technically available in the current runtime, but it did not produce coherent outputs in the approved model and did not produce a safe memory win in the available test run.
- The safe and measurable path is a bounded, local-only configuration with stricter preprocessing and explicit memory accounting, not a silent re-enable under the existing 2 GiB request budget.

## 2. Exact files changed

New TrOCR-specific files:

- `intelligence/app/layer1_document_processing/trocr_optimization.py`
- `intelligence/tests/layer1/test_trocr_optimization.py`

Documentation created:

- `intelligence/docs/COPILOT_PHASE2_5_TROCR_OPTIMIZATION.md`

No shared Codex-owned files were modified, including:

- `intelligence/app/layer1_document_processing/hybrid_ocr.py`
- `intelligence/app/layer1_document_processing/adaptive_ocr.py`
- `intelligence/app/integration/http_service.py`
- `intelligence/app/integration/local_pdf_worker.py`
- `intelligence/app/integration/process_supervisor.py`
- `intelligence/app/schemas/ocr.py`

## 3. Baseline model measurements

The measured baseline came from the approved isolated runtime:

- Interpreter: `intelligence/.venv-trocr`
- Model: `microsoft/trocr-base-handwritten`
- Revision: `eaacaf452b06415df8f10bb6fad3a4c11e609406`
- Local model path: `C:\Users\dahiy\.cache\meddecode\trocr\microsoft-trocr-base-handwritten`

Measured values from real local Python execution in the isolated environment:

- Python version: 3.12.10
- PyTorch: 2.6.0+cpu
- Transformers: 4.49.0
- Process RSS before model load: ~1,865,216,000 bytes (~1.74 GiB)
- Process RSS after model load: ~1,877,049,344 bytes (~1.75 GiB)
- Process-tree RSS during inference: ~1,794,043,904 bytes (~1.67 GiB)
- Inference time for three synthetic handwriting-like lines: ~5.894 s
- Observed outputs:
  - `Miratorm 250 mg. 1/ 1/`
  - `Take one tablet twice daily 2000 2001`
  - `use 0.5ml at bedtime 2000 2001`

The earlier supervised descendant process-tree benchmark remained the key operational blocker and was measured at approximately 3.12 GiB. That is the value that sets the hard production safety limit in the active architecture, even though the isolated process itself does not always show the same peak on a standalone run.

## 4. Memory experiment methodology

The new module `trocr_optimization.py` adds a fail-closed, TrOCR-only measurement path that does the following without touching the shared OCR integration:

1. Measures the current process and descendant process RSS using `psutil`.
2. Captures a pre-load baseline.
3. Loads the official checkpoint in CPU mode.
4. Captures a post-load snapshot.
5. Runs bounded inference across synthetic handwriting-like inputs.
6. Captures the post-inference snapshot.
7. Releases the model and records the release-state memory.
8. Keeps the memory boundary explicit and separate from any request-tree compliance claim.

This is intentionally conservative and does not assume that any standalone memory number proves 2 GiB compliance.

## 5. Quantization results

Dynamic INT8 quantization was tested using the current PyTorch + Transformers runtime. The result was not an acceptable optimization for this model:

- `torch.quantization.quantize_dynamic` is available.
- The model can be quantized without a crash.
- The quantized inference run produced visibly degraded outputs in the test sample, including:
  - `MR. FREST RESULTS`
  - `" Takes into table . Willie Daly 1955 1957 1958`
  - `LOCIDENTATIONAL REPORTED`
- The measured pre-inference RSS in that quantized benchmark rose to ~2,937,716,736 bytes (~2.74 GiB), which is materially higher than the unquantized baseline in the isolated run.

Conclusion: CPU quantization is supported by the runtime, but it is not currently a safe or reliable optimization for this approved TrOCR checkpoint in the existing MedDecode environment. The code in `trocr_optimization.py` therefore treats quantization as an experimental, opt-in path that is reported as `unsupported` unless it proves both stable and beneficial in a real benchmark.

## 6. Preprocessing improvements

The new module adds a fail-closed preprocessing path designed for hand-written line crops:

- RGB conversion and explicit rejection of invalid zero-size crops
- blank-crop rejection based on grayscale variance
- bounded resize with aspect-ratio preservation for oversized crops
- padding to preserve character edges and reduce clipping
- contrast normalization with conservative enhancement
- aspect-ratio guard rails to reject pathological crops
- crop-size validation that preserves medication structure and decimal/unity characters

This is intentionally limited to TrOCR-specific handling and does not modify the shared hybrid OCR code paths.

## 7. Actual recognition outputs

The real local inference run was performed with the approved checkpoint in the isolated environment. Example outputs over synthetic handwriting-like lines were:

| Sample | Output | Observation |
| --- | --- | --- |
| `Miraform 250 mg` | `Miratorm 250 mg. 1/ 1/` | partially correct, but degraded |
| `Take one tablet twice daily` | `Take one tablet twice daily 2000 2001` | spurious suffix output |
| `Use 0.5 ml at bedtime` | `use 0.5ml at bedtime 2000 2001` | units preserved but decoder suffix noise appears |

This confirms that genuine local TrOCR inference works, but the model is still subject to output drift and suffix artifacts on synthetic handwriting-like text. That is an engineering observation, not a claim about clinical accuracy.

## 8. Accuracy comparisons

Measured from the real local inference run above, the synthetic handwriting sample is still not a production-quality clinical corpus. The main takeaways are:

- output is recognizably related to the intended text
- the model can parse handwriting-like medication lines in a local environment
- it is not yet reliable enough to be treated as a direct medical-accuracy benchmark
- the quality remains insufficient to certify readiness under the active request-memory constraints

The change that matters here is not a fabricated accuracy claim; it is the fact that we kept the benchmark honest, recorded actual output, and did not infer clinical quality beyond the evidence.

## 9. Model alternatives

No additional large model downloads were performed. The approved model remains the canonical option in this task. Smaller handwriting alternatives were researched only as a candidate review item, not as an executed replacement.

Relevant observations:

- smaller TrOCR-compatible checkpoints may be attractive for memory reduction
- they require a separate approval cycle
- they require a fresh benchmark and memory check under the same process-tree constraints
- they may help with runtime footprint but not without independent verification

## 10. Remaining limitations

- No safe path has been verified for a full Codex-supervised request-tree under 2 GiB.
- The actual supervised descendant process-tree peak remains above the allowed budget for the active architecture.
- Quantization currently does not provide a safe practical win and can worsen output quality.
- The current benchmark remains synthetic and does not replace a real, privacy-safe handwritten medication dataset.
- TrOCR remains a local isolated runtime feature, not a live shared-provider activation in the active request path.

## 11. Tests executed

Focused validation executed successfully:

```powershell
cd C:\Users\dahiy\MedDecode-integration\intelligence
.\.venv\Scripts\python.exe -m pytest tests/layer1/test_hybrid_ocr.py tests/layer1/test_trocr_optimization.py -q
```

Result:

- 34 passed in 7.78s

This covered the existing hybrid OCR behavior and the new TrOCR optimization/preprocessing helpers without modifying shared Codex-owned code.

## 12. Codex integration handoff

Codex remains responsible for the shared integration layer. The handoff recommendation is:

- Keep TrOCR in an isolated local runtime.
- Use a dedicated model directory: `C:\Users\dahiy\.cache\meddecode\trocr\microsoft-trocr-base-handwritten`
- Initialize the runtime only once per worker lifetime.
- Use CPU thread limiting: 1 thread and 1 interop thread as the safe default.
- Bind generation to a maximum token count such as 64.
- Use strict crop validation and blank-crop rejection before model submission.
- Preserve original page coordinates.
- Do not promise readiness under the active 2 GiB supervised request-tree budget unless a full process-tree measurement re-demonstrates compliance.

## 13. Recommendations

1. Keep the current TrOCR path isolated and offline-only.
2. Continue using the approved checkpoint as the canonical local model.
3. Do not activate TrOCR under the active FastAPI request-tree architecture until the full descendant process-tree is below 2 GiB.
4. Keep the new preprocessing and benchmarking utilities available as a future integration-ready layer.
5. Treat quantization as an experimental option only, not a proven production improvement.
6. Continue to benchmark with synthetic and deidentified handwriting cases, but do not claim clinical readiness without a real labelled dataset.

Final status:

TROCR_BASELINE_INFERENCE: VERIFIED

LOW_MEMORY_OPTIMIZATION: PARTIAL

QUANTIZATION: UNSUPPORTED

HANDWRITING_PREPROCESSING: VERIFIED

HANDWRITING_BENCHMARK: PARTIAL

MEMORY_REDUCTION_MEASURED: NO

FULL_PROCESS_TREE_UNDER_2GIB: NOT_VERIFIED

READY_FOR_CODEX_HANDOFF: NO
