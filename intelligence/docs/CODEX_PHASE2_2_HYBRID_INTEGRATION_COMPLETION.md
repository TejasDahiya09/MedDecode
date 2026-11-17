# MedDecode Codex Phase 2.2 Hybrid Integration Completion

Date: 2026-11-14

## Scope and coordination

Codex completed the EasyOCR/PaddleOCR FastAPI integration under the approved
Phase 2.2 ownership exception. Copilot's active TrOCR implementation was not
edited. In particular, `hybrid_ocr.py` was treated as a shared read-only
dependency and retained SHA-256
`0f1db132f1c0dd5fe73db45af4a16b535dc571fdb7f9712951d5d6f7cabe3cd6`
through this work. TrOCR remains absent from the live processing composition.

No hosted worker, hosted prescription, database schema, database grant, cloud
OCR provider, model download, Contract v1 field, commit, or push was involved.

## Files changed

- `intelligence/app/layer1_document_processing/adaptive_ocr_integration.py` (new)
- `intelligence/app/integration/ocr_runtime_config.py` (new)
- `intelligence/app/integration/http_service.py`
- `intelligence/app/integration/process_supervisor.py`
- `intelligence/app/integration/local_pdf_worker.py`
- `intelligence/app/integration/local_pdf_pipeline.py`
- `intelligence/app/integration/fictional_document_harness.py`
- `intelligence/app/layer2_information_extraction/pipeline.py`
- `intelligence/.env.example`
- `scripts/dev-launcher.cjs`
- `scripts/dev-launcher.test.cjs`
- `intelligence/tests/layer1/test_adaptive_ocr_integration.py` (new)
- `intelligence/tests/integration/test_ocr_runtime_config.py` (new)
- `intelligence/tests/integration/test_http_service.py`
- `intelligence/tests/integration/test_process_supervisor.py`
- `intelligence/tests/integration/test_local_pdf_worker.py`
- `intelligence/tests/integration/test_local_pdf_pipeline.py`
- `intelligence/tests/layer2/test_pipeline.py`
- `intelligence/docs/CODEX_PHASE2_2_HYBRID_INTEGRATION_COMPLETION.md` (new)

## Integration architecture

The production-shaped route remains:

1. FastAPI authenticates the internal bearer token.
2. It stages and validates the exact document bytes.
3. `ProcessingSupervisor` starts one killable child process.
4. The child performs all rendering, EasyOCR/PaddleOCR, Layers 2-5, restricted
   catalogue reads, and Contract v1 mapping.
5. The parent bounds time, process-tree RSS, stdout/stderr, cancellation, and
   shutdown and accepts only a correlation-matching response.

No OCR model executes in the FastAPI parent process.

## Feature flag

Adaptive mode is disabled by default:

```text
MEDDECODE_ADAPTIVE_OCR_ENABLED=false
MEDDECODE_PADDLEOCR_DETECTION_MODEL_DIRECTORY=
MEDDECODE_PADDLEOCR_RECOGNITION_MODEL_DIRECTORY=
```

The flag parser accepts only explicit boolean values. When enabled, both local
Paddle directories and the installed PaddleOCR package are mandatory. Missing
or malformed configuration makes readiness fail closed. The root launcher now
passes only these non-secret OCR settings into the Python service; worker and
backend credentials remain excluded.

With the flag disabled, the established EasyOCR-only `HybridOCREngine` path is
used. With it enabled, the supervised child constructs
`AdaptiveEasyPaddleOCREngine`: EasyOCR runs first, only bounded uncertain regions
(or the narrowly defined empty/skew case) reach cached PaddleOCR, and TrOCR is
explicitly `None`.

PaddleX model-source discovery is disabled in the child. No implicit model
download or cloud fallback is possible.

## Evidence selection and warnings

- Primary and fallback predictions retain provider, version, provenance,
  confidence, page, and polygon evidence.
- Crop coordinates are restored to the processed page.
- Agreements retain one conservative selected observation.
- Numeric, unit, frequency, and generic disagreements remain unselected.
- Paddle-only evidence below `0.55` is retained internally but withheld from
  medicine extraction.
- A Paddle failure keeps usable EasyOCR evidence and adds a safe warning.
- Routing decisions are available only in the explicitly fictional diagnostic
  harness as provider counts; prescription text is not logged.

## Resource behavior

The existing 2 GiB process-tree limit was not raised. A real 1191x1684 JPEG
initially exceeded it even on the EasyOCR baseline. The staged original remains
unchanged, but OCR input pages are now aspect-ratio normalized to at most one
million pixels. This matches the approximate rendered size of the passing PDF
path and avoids retaining unnecessary native tensors.

Adaptive mode also releases the EasyOCR reader before a possible Paddle model
initialization. Paddle remains cached inside the single supervised child so it
is not reinitialized per crop.

Observed supervised peaks:

| Case | Mode | Result | Elapsed | Peak child-tree RSS | Providers |
| --- | --- | --- | ---: | ---: | --- |
| fictional PDF, 1,230 bytes | adaptive | completed with warnings, 1 medicine | 16.156 s | 1,620,914,176 bytes | EasyOCR evidence |
| fictional JPEG, 153,001 bytes | Easy-only | completed with warnings, 1 medicine | 16.219 s | 1,331,253,248 bytes | EasyOCR |
| same JPEG | adaptive | completed with warnings, 1 medicine | 9.672 s | 1,359,527,936 bytes | EasyOCR 20, PaddleOCR 0 |
| fictional PNG, 93,814 bytes | adaptive | completed with warnings, 1 medicine | 23.218 s | 1,333,780,480 bytes | EasyOCR 19, PaddleOCR 2 |

These are single controlled runs, not stable performance or clinical accuracy
estimates.

## Genuine fallback evidence

A genuine local 7-degree rotated fictional image caused EasyOCR to emit two
observations, including one at confidence 0.207. Bounded Paddle fallback emitted
one observation at confidence approximately 1.0. Reconciliation identified a
numeric disagreement and withheld that region. Total local runtime was about
12.6 seconds. A more severely blurred case produced low-confidence Paddle-only
text; the new guard withheld it rather than treating it as medicine evidence.

## FastAPI and five-layer evidence

A loopback-only real FastAPI POST using the fictional PNG returned HTTP 200,
`completed_with_warnings`, matching job and prescription IDs, one medicine, and
five warnings. It used the normal bearer-authenticated, staged-byte, supervised
child path and the existing restricted read-only catalogue repository.

The adaptive warnings exposed a pre-existing Layer 2 defect:
`ExtractionWarning` was referenced without being imported. This caused a real
five-layer NameError only when OCR processing warnings were present. The import
was fixed and a warning-propagation regression test was added. No Layer 3-5
algorithm or recommendation rule required a further change; the full suite
continues to cover missing fields, multiple medicines, strengths, units,
frequencies, durations, abbreviations, combinations, unknown catalogue matches,
and conservative recommendations.

## Direct catalogue

The genuine PDF/JPEG/PNG and HTTP runs used the existing
`connect_catalogue()`/`LocalOfficialCatalogueMedicineRepository` path. That path
retains direct PostgreSQL, verify-full TLS, the restricted reader configuration,
parameterized reads, explicit connection close, and no privileged fallback.
The fictional medicine remained conservatively unmatched where appropriate.
No hosted grant or data mutation occurred.

## Contract and backend compatibility

Contract v1 was not changed. The backend still sends staged bytes, validates
the response, fences persistence, rejects duplicate/conflicting results, and
keeps controlled failures terminal with no automatic retry.

Verification:

- Complete Python suite: 344 passed; one existing Starlette deprecation warning.
- Backend suite: 503 passed.
- Focused backend Contract/HTTP/worker suite: 26 passed.
- Backend typecheck: passed.
- Backend build: passed.
- Frontend typecheck/build: passed (existing Vite chunk-size warning only).
- Root launcher tests: 6 passed.
- Genuine fictional PDF/JPEG/PNG supervised runs: passed.
- Genuine loopback FastAPI PNG request: passed.

An additional real `npm run dev` startup attempt stopped at its existing safety
guard because loopback port 3000 was occupied (`EADDRINUSE`). The occupying
process was not identified or terminated. No partial launcher child remained;
the launcher contract itself is covered by the six passing tests.

The Python suite includes timeout, cancellation, child termination, repeated
failure, output overflow, memory overflow, PDF/page/pixel limits, malformed
input, temporary cleanup, and shutdown tests. The real large-image failure also
demonstrated that the existing memory limit terminates the child rather than
allowing unbounded model growth.

## TrOCR extension boundary

No TrOCR code, import, model path, dependency, or test was changed. The existing
handwritten-region provider contract already supplies line-region inputs,
provenance, local-only model loading, timeout-compatible invocation, and clean
failure. Phase 2.2 always constructs the adaptive router with no handwriting
provider. Live TrOCR activation requires Copilot's genuine inference report and
a separate CPU memory review because the current two-engine peaks already need
the established 2 GiB boundary.

## Rollback

Immediate runtime rollback requires no database or backend change:

```powershell
$env:MEDDECODE_ADAPTIVE_OCR_ENABLED = 'false'
Remove-Item Env:MEDDECODE_PADDLEOCR_DETECTION_MODEL_DIRECTORY -ErrorAction SilentlyContinue
Remove-Item Env:MEDDECODE_PADDLEOCR_RECOGNITION_MODEL_DIRECTORY -ErrorAction SilentlyContinue
```

Restart only the local intelligence service. The EasyOCR-only supervised path
then remains active. Source rollback, if separately requested, is limited to the
files listed above and must preserve concurrent Copilot changes.

## Remaining requirements

- Review Copilot's Phase 2.3 genuine TrOCR evidence and measured process-tree
  memory before any handwriting provider is composed.
- Keep adaptive mode disabled by default outside explicit local evaluation.
- Re-run the real root startup/shutdown check after the operator frees port
  3000; do not terminate an unidentified listener merely to run this check.
- Before a hosted rollout, repeat a controlled fictional document test with the
  deployment machine's exact model cache and memory limit.
- Continue treating all current metrics as engineering evidence, not clinical
  validation.

## Final status

ADAPTIVE_FASTAPI_INTEGRATION: VERIFIED

EASYOCR_BASELINE_PRESERVED: YES

PADDLEOCR_FALLBACK_LIVE: VERIFIED

FIVE_LAYER_EXECUTION: VERIFIED

DIRECT_CATALOGUE: VERIFIED

CONTRACT_V1: VERIFIED

RESOURCE_SAFETY: VERIFIED

BACKEND_COMPATIBILITY: VERIFIED

TROCR_INTEGRATION_READY: NO

READY_FOR_LOCAL_ADAPTIVE_OCR_ROLLOUT: YES
