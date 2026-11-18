# Batch 7 Intelligence Hardening

Date: 2026-11-18

Branch: `main`

Starting Batch 7 commit: `0980f7c3a9bd702b954d49e18b7bc8847086244a`

## Outcome

The local-default Python dependency surface no longer installs either cloud OCR
SDK. AWS Textract and Google Cloud Vision remain explicit, optional transports;
normal FastAPI and supervised-worker execution remains local EasyOCR with
PaddleOCR available only through the existing adaptive flag and explicit local
model directories. No cloud request or model download occurred.

Genuine local EasyOCR was repeated sequentially against repository-generated,
fictional scanned PDF, JPEG, and PNG fixtures. Resource, cancellation, timeout,
input-boundary, clinical exclusion, and Contract v1 regressions pass. Genuine
adaptive PaddleOCR was not rerun because this checkout does not configure a
readable detection/recognition model-directory pair, and downloading models was
outside the authorization. Accordingly, `AUD-INT-003` is only partially closed.

## Files changed

- `intelligence/requirements.txt`
- `intelligence/requirements-cloud-aws.txt`
- `intelligence/requirements-cloud-google.txt`
- `intelligence/README.md`
- `intelligence/tests/test_dependency_profiles.py`
- `intelligence/tests/layer1/test_google_vision_provider.py`
- `intelligence/tests/layer1/test_hybrid_ocr.py`
- `intelligence/docs/BATCH_7_INTELLIGENCE_HARDENING.md`
- `backend/docs/PLATFORM_ISSUE_REGISTER.md`

## Dependency profiles and provider configuration

The verified environment used Python 3.12.10 with EasyOCR 1.7.2,
PaddleOCR 3.7.0, PaddlePaddle 3.2.2, PyMuPDF 1.28.2, and Pillow 12.3.0.
`pip check` reported no broken requirements.

`requirements.txt` is the local-default runtime. The two optional files contain
only their provider SDK (`boto3` or `google-cloud-vision`). Installing an SDK
does not enable a provider. Cloud transports retain lazy imports, explicit
provider selection, and sanitized missing-SDK errors. Tests prove that the base
and test profiles exclude both SDKs. This is dependency grouping, not a fully
locked environment; the pre-existing unpinned OCR packages remain a
reproducibility limitation.

## Genuine fictional OCR evidence

The existing `run_ocr_preprocessing_benchmark.py` harness generated inputs in a
private task-owned temporary directory. It ran the formats sequentially with
local EasyOCR weights and measured the current process plus descendants at
100 ms intervals. Each fixture is digitally generated and contains no patient
data. Each page was read once as baseline and once through preprocessing, so
the provider-call count is deliberately higher than the document page count.

| Format | Fixture | Pages | Provider calls | Elapsed | Peak tree RSS | Final tree RSS | Expected names | Expected strengths | Warnings |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| scanned PDF | `two_page_scanned_pdf` | 2 | 4 | 26.888 s | 1556.77 MiB | 1271.81 MiB | 2/2 | 2/2 | `no_native_text_layer_detected` |
| JPEG | `exif_rotated_jpeg` | 1 | 2 | 17.301 s | 1551.56 MiB | 1257.77 MiB | 1/1 | 1/1 | none |
| PNG | `clean_print_two_medicines` | 1 | 2 | 18.415 s | 1531.84 MiB | 1250.00 MiB | 2/2 | 2/2 | none |

All three observations had synthetic-set CER 0.0, WER 0.0, and zero critical
numeric substitutions. Recognized fictional identities were
`FictionalScan`, `FictionalScanB`, `FictionalRotate`, `FictionalMedA`, and
`FictionalMedB`. These results are harness evidence only, not clinical-accuracy
claims and not proof for handwriting or real-world photography.

## Resource and safety findings

The measured EasyOCR peak remained below the unchanged 2 GiB supervised request
limit, although available headroom is only about 491 MiB at the highest sampled
peak. The genuine benchmark exercised the same Layer 1 provider and
preprocessing code but did not itself wrap inference in the FastAPI supervisor;
supervisor enforcement is covered independently by integration tests.

The focused 96-test set verified corrupt images and PDFs, unsupported types,
image/PDF page and pixel bounds, aggregate rendered-pixel limits, response and
memory monitoring, timeout termination, cancellation, temporary-file cleanup,
adaptive routing budgets, and shutdown behavior. Tests assert that terminated
children are removed from the supervisor's active-process set. No orphan was
observed in the sequential genuine runs (final RSS reflects the benchmark
process retaining its loaded model, not a detached OCR child).

TrOCR remained disabled. PaddleOCR package availability alone was not treated
as model availability. No implicit source discovery or network download was
allowed, and no cloud OCR was invoked.

## Clinical regression evidence

The focused clinical suite confirms that unverified numbered rows remain out of
Contract v1 medicines; valid adjacent and multipage medicines remain eligible;
template/label-only identities are rejected; strength, dosage form, and liquid
concentration uncertainty remain separate from identity; and no excluded
identity reaches Layer 4. No missing medicine or clinical value is fabricated.

## Verification results

- Dependency and optional-provider focus: 67 passed.
- Resource, boundary, clinical, and Contract v1 focus: 96 passed, 1 third-party
  Starlette deprecation warning.
- Full Python suite: 451 passed, 1 third-party Starlette deprecation warning,
  in 33.42 seconds.
- Backend intelligence-contract focus: 50 passed in 14.22 seconds, including
  real offline Node-to-Python and Layers 2--5 contract round trips.
- Dependency consistency: `pip check` passed.
- No cloud calls, hosted mutations, uploads, workers, migrations, dataset
  changes, or MedDecode-dev changes occurred.

## Remaining limitations

- Genuine PaddleOCR adaptive fallback was not rerun without an explicitly
  configured, readable local model pair.
- The genuine benchmark does not replace an end-to-end supervised FastAPI run;
  process supervision remains verified by automated integration tests.
- Synthetic printed fixtures do not establish handwriting, photograph, or
  clinical accuracy.
- OCR/provider dependencies are not yet captured in a reproducible lockfile.
- The approximately 491 MiB headroom at the highest EasyOCR sample should be
  retained; the memory limit was not raised.

## Status

`AUD-DEP-001`: resolved by optional dependency profiles and negative tests.

`AUD-INT-003`: partially verified; local EasyOCR formats and resource controls
pass, while genuine adaptive PaddleOCR remains outstanding.
