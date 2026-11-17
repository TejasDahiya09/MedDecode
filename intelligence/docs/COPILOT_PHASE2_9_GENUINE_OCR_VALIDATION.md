# Copilot Phase 2.9 — Genuine OCR Validation

## Summary

This phase measured the existing EasyOCR and PaddleOCR providers on 14
fictional documents, comparing the original raster path with the Phase 2.8
preprocessing adapter. Both engines used local cached models; no model was
downloaded and no patient data, hosted OCR, TrOCR, or cloud OCR was used.

The results support the conservative adapter on this synthetic set, not a
claim of clinical or real-world accuracy. EasyOCR improved text error rates
and recovered the adversarial sheet's duration phrases after preprocessing.
PaddleOCR was effectively unchanged. Neither engine made a scored critical
numeric substitution. Resource measurements are not sufficient to certify
the existing 2 GiB request budget.

## Files changed

- `intelligence/tests/layer1/ocr_accuracy_fixtures.py`
  - Generates deterministic fictional image, scanned-PDF, searchable-PDF,
    and mixed-PDF fixtures with ground truth.
- `intelligence/tests/layer1/run_ocr_preprocessing_benchmark.py`
  - Runs sequential local inference, computes text/field/numeric metrics,
    samples process-tree RSS, and supports rescoring saved output without
    another inference run.
- `intelligence/tests/layer1/test_ocr_accuracy_fixtures.py`
  - Covers fixture construction, numeric-substitution boundaries, and
    page-specific field scoring for mixed PDFs.
- `intelligence/data/ocr_benchmark/phase2_9_easyocr_results.json`
- `intelligence/data/ocr_benchmark/phase2_9_paddleocr_results.json`
- `intelligence/docs/COPILOT_PHASE2_9_GENUINE_OCR_VALIDATION.md`

No production provider, OCR orchestration, Layer 2/3, FastAPI, backend,
frontend, database, or Contract v1 implementation was changed.

## Dataset and methodology

The 14 reproducible fixtures cover clean printed text, a typed three-medicine
list, a searchable two-page PDF, a two-page scanned PDF, a mixed native/scanned
PDF, JPEG and PNG inputs, EXIF rotation, slight skew, low contrast, uneven
lighting, small print, blur, multiple medicines, decimal strengths, unit and
schedule adversarial pairs, and Romanized-Hindi instructions. The script-font
sample is explicitly synthetic handwriting-like text, not genuine
handwriting. There are 13 ordinary printed samples and one script-font sample.

For each engine, the same provider configuration and normalized ground truth
were used for both sides of the comparison:

1. Original images/PDF pages through the existing provider path.
2. The same document through
   `process_document_with_preprocessing`, which may select safe raster
   preprocessing, native PDF text, or the existing raster OCR fallback.

Only pages routed to raster OCR contribute to the original-versus-preprocessed
OCR metrics. Searchable-PDF native extraction is scored separately and is
not represented as OCR inference. Field metrics are page-specific for mixed
PDFs. The runner's `--rescore-existing` option refreshes the field/numeric
metrics from saved inference output without calling an OCR model.

Reproduce the genuine runs from `intelligence/` with cached model files:

```powershell
.\.venv\Scripts\python.exe tests\layer1\run_ocr_preprocessing_benchmark.py --engine easyocr --output data\ocr_benchmark\phase2_9_easyocr_results.json
.\.venv\Scripts\python.exe tests\layer1\run_ocr_preprocessing_benchmark.py --engine paddleocr --output data\ocr_benchmark\phase2_9_paddleocr_results.json
```

The runner fails rather than downloading missing weights. It defaults to
local EasyOCR and PaddleOCR cache locations under the user's home directory;
alternate cached directories can be supplied with its model-directory
options.

## Genuine OCR results

Installed versions were EasyOCR 1.7.2, PaddleOCR 3.7.0, and PaddlePaddle
3.2.2. Each engine processed 14 raster pages in the metric set and made 31
inference calls across baseline and adapter paths.

| Engine | Raster OCR metric | Original | Preprocessed |
|---|---|---:|---:|
| EasyOCR | Character error rate (CER) | 1.9911% | 1.4331% |
| EasyOCR | Word error rate (WER) | 1.9133% | 1.1990% |
| EasyOCR | Exact page text | 12/14 (85.71%) | 12/14 (85.71%) |
| PaddleOCR | CER | 0.0279% | 0.0279% |
| PaddleOCR | WER | 0.1786% | 0.1786% |
| PaddleOCR | Exact page text | 13/14 (92.86%) | 13/14 (92.86%) |

Across both outputs, native text from searchable pages was scored separately:
3/3 pages had exact text (CER/WER 0). This is native PDF extraction, not OCR.

### Field and numeric results

Counts below are synthetic ground-truth token matches, not clinical
extraction accuracy.

| Engine / path | Medicine names | Strengths | Units | Frequencies | Timings | Durations |
|---|---:|---:|---:|---:|---:|---:|
| EasyOCR original | 16/16 | 23/23 | 23/23 | 22/22 | 7/8 | 16/18 |
| EasyOCR preprocessed | 16/16 | 23/23 | 23/23 | 22/22 | 7/8 | 18/18 |
| PaddleOCR original | 16/16 | 23/23 | 23/23 | 22/22 | 8/8 | 18/18 |
| PaddleOCR preprocessed | 16/16 | 23/23 | 23/23 | 22/22 | 8/8 | 18/18 |

Named medicine-entry recall in the OCR fixtures was 16/16 on each engine/path.
Separately, the existing Layer 2/3 fictional multi-medicine regression covers
30 prescriptions and 100 entries: entry precision and recall were both 100%,
with **0 cross-medicine instruction leaks** and 0 unsafe numeric substitutions.
This is a regression-suite result, not a Phase 2.9 OCR model metric.

The adversarial fixture includes `0.5 mg`/`5 mg`, `0.25 mg`/`25 mg`,
`500 mg`/`500 mcg`, `1-0-1`/`1-1-1`, `OD`/`BD`, `5 days`/`15 days`, and
`1/2 tablet`/`2 tablets`. The critical numeric substitution scorer recorded
zero substitutions for both engines on both paths. This does not mean every
line was recognized exactly: EasyOCR's adversarial-sheet CER improved from
8.20% to 0.39% as preprocessing recovered the two duration phrases, while
PaddleOCR's residual text difference was a fictional identifier character
(`I`/`l`), not a dose or unit. Two fixture fields were intentionally marked
unsupported/ambiguous and excluded from field accuracy.

EasyOCR continued to split the Romanized-Hindi timing instruction
`khane se pehle` across lines and did not match it as a complete field
(7/8 timings on both paths). PaddleOCR recognized it in this fixture. No
medicine knowledge or inferred value was used to fill missing text.

## Resource observations

The benchmark ran each engine sequentially with CPU/local inference and
sampled the process tree's RSS; the monitor did not enforce or terminate at a
memory threshold.

| Engine | Sampled peak process-tree RSS | Runtime |
|---|---:|---:|
| EasyOCR | 2,464,153,600 bytes (about 2.29 GiB) | 160.30 s |
| PaddleOCR | 2,118,270,976 bytes (about 1.97 GiB) | 1,101.38 s |

The 2 GiB ceiling is 2,147,483,648 bytes. EasyOCR exceeded it by about 302
MiB. PaddleOCR remained below it by only 27.9 MiB in this sampled run; that
small margin is not a safety guarantee. These standalone measurements do not
replace supervised-worker enforcement or prove the live request budget.
No memory limits were changed.

## Regression and validation

Commands were run from `intelligence/`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests\layer1
.\.venv\Scripts\python.exe -m pytest -q tests\layer2 tests\layer3
.\.venv\Scripts\python.exe -m pytest -q tests\integration\test_contract_v1_mapper.py tests\evaluation\test_ocr_benchmark.py
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m compileall -q app tests\layer1
```

Actual results:

- Layer 1 tests: **106 passed**.
- Layer 2/3 regression tests: **111 passed**.
- Contract v1 mapper and OCR evaluation tests: **12 passed**.
- Full Python suite: **415 passed, 1 warning** in 14.28 seconds. The warning
  is the environment's existing Starlette/AnyIO deprecation warning.
- Compile check: passed.
- `git diff --check`: passed; Git printed line-ending conversion notices for
  other concurrently modified files.

The regression suites preserve the existing multi-medicine behavior; no
Layer 2/3 algorithm or Contract v1 change was needed.

## Codex handoff and limitations

The exact safe entry point remains
`app.layer1_document_processing.pipeline.process_document_with_preprocessing`.
It accepts the existing local document path and an existing page processor.
The benchmark called this adapter directly; it did not alter or validate the
live FastAPI wiring. The Codex-owned caller should retain each
`PreprocessedOCRPage` wrapper, route, native-text evidence, and warnings, and
must not flatten page boundaries or present native PDF text as OCR evidence.

Recommended defaults are to retain the adapter's current conservative
transformation checks, preserve original pages as fallback, and continue
using the existing supervised provider-selection policy. EasyOCR's memory
peak must be resolved or constrained by the existing supervisor before any
claim that the 2 GiB request budget is satisfied. PaddleOCR's narrow observed
margin also needs supervised measurement. No accuracy claim should be
extended to genuine handwriting, real prescriptions, or illegible documents.

## Final status

GENUINE_EASYOCR_TESTS: VERIFIED

GENUINE_PADDLEOCR_TESTS: VERIFIED

SEARCHABLE_PDF_VALIDATION: VERIFIED

IMAGE_PREPROCESSING_BENCHMARK: VERIFIED

MEDICINE_NAME_ACCURACY: MEASURED

STRENGTH_UNIT_ACCURACY: MEASURED

NUMERIC_SAFETY: VERIFIED

MULTI_MEDICINE_REGRESSION: VERIFIED

RESOURCE_LIMITS: PARTIAL

FULL_PYTHON_TESTS: VERIFIED

READY_FOR_E2E_ACCEPTANCE: NO
