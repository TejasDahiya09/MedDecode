# MedDecode Codex Phase 2.3: Three-Provider Local OCR Integration

Date: 2026-11-15

## Executive summary

Phase 2.3 adds a bounded, isolated subprocess boundary for the Copilot-owned
TrOCR adapter while leaving its implementation untouched.  The adapter was
proven to load and infer through the new JSON IPC route on a fictional
handwriting-style line.  It is **not enabled for FastAPI processing**: measured
request-tree memory was 3,270,017,024 bytes (3,118.5 MiB), exceeding the
unchanged 2 GiB limit.  The implementation therefore rejects TrOCR before
native model loading and retains the established EasyOCR/PaddleOCR route.

No hosted worker, database, AWS resource, cloud OCR provider, Contract v1
field, model download, commit, or push was used.

## Files changed in this phase

- `intelligence/app/layer1_document_processing/trocr_ipc.py` (new parent-side
  bounded protocol and memory preflight)
- `intelligence/app/integration/trocr_ipc_worker.py` (new isolated interpreter
  entry point)
- `intelligence/app/integration/ocr_runtime_config.py`
- `intelligence/app/integration/http_service.py`
- `intelligence/app/integration/process_supervisor.py`
- `intelligence/app/integration/local_pdf_worker.py`
- `intelligence/app/integration/fictional_document_harness.py`
- `intelligence/app/layer1_document_processing/adaptive_ocr_integration.py`
- `intelligence/.env.example`
- `scripts/dev-launcher.cjs`
- `scripts/dev-launcher.test.cjs`
- `intelligence/tests/integration/test_ocr_runtime_config.py`
- `intelligence/tests/integration/test_process_supervisor.py`
- `intelligence/tests/layer1/test_adaptive_ocr_integration.py`
- `intelligence/tests/layer1/test_trocr_ipc.py` (new)
- this report.

`intelligence/app/layer1_document_processing/hybrid_ocr.py` was deliberately
not edited.  Its SHA-256 remains
`0f1db132f1c0dd5fe73db45af4a16b535dc571fdb7f9712951d5d6f7cabe3cd6`.

## Process and IPC architecture

FastAPI continues to run OCR only inside its existing killable supervised child.
When explicitly eligible, that child may launch one descendant using
`MEDDECODE_TROCR_PYTHON`; it is not a service, socket listener, daemon, or
detached process.  The descendant uses the isolated `.venv-trocr` interpreter
and calls Copilot's existing `TrOCRHandwrittenProvider`.

The IPC protocol is JSON version `1.0` over stdin/stdout. It includes a UUID
request ID, page number, four-point page coordinates, and base64 PNG crops.
It never accepts document-controlled file paths or arbitrary Python objects.

| Boundary | Limit |
| --- | ---: |
| request bytes | 8 MiB |
| response bytes | 1 MiB |
| stderr bytes | 64 KiB |
| crops/request | 4 |
| pixels/crop | 1,000,000 |
| aggregate crop pixels | 2,000,000 |
| crop dimension | 2,048 px |
| generated tokens | 64 |

The isolated worker validates request identity, schema, page/region shapes,
base64 data, decoded image bounds, PNG validity, and mandatory local artifacts.
It uses local-only Transformer loading, `HF_HUB_OFFLINE=1`,
`TRANSFORMERS_OFFLINE=1`, CPU-only execution, and no credentials.  The parent
uses argument-array execution with `shell=False`; timeout or unexpected failure
terminates the exact subprocess tree with `taskkill /T /F` on Windows.

## Configuration and integrity

Defaults remain disabled:

```text
MEDDECODE_ADAPTIVE_OCR_ENABLED=false
MEDDECODE_TROCR_ENABLED=false
```

TrOCR is effective only when *both* flags are true.  `MEDDECODE_TROCR_ENABLED`
alone is inert, so it cannot bypass the adaptive policy.  Effective activation
requires these local-only settings:

```text
MEDDECODE_TROCR_PYTHON=<isolated interpreter>
MEDDECODE_TROCR_MODEL_DIRECTORY=<local model directory>
MEDDECODE_TROCR_TIMEOUT_SECONDS=20
```

The checkpoint is streamed and SHA-256-verified at enabled-service startup;
the measured local `model.safetensors` hash is
`25a40cddc7e6120140a3d5b9e3dd3878a92ada7b4f312953ab22edc19c2a5acc`.
Missing interpreter/assets, invalid booleans/timeouts, or a hash mismatch fail
closed. The root launcher forwards only non-secret `MEDDECODE_TROCR_*` settings
to Python and continues to withhold backend/worker credentials.

## Routing and evidence behavior

EasyOCR remains primary. PaddleOCR receives only the pre-existing bounded,
uncertain regions. TrOCR is considered only after the existing non-diagnostic
`possible handwriting` uncertainty signal and a nonempty bounded region set.
Low confidence alone is not treated as proof of handwriting.

Before any TrOCR launch, the adaptive engine releases Paddle's cached engine
and forces garbage collection. The three-provider reconciliation then preserves
engine name, revision provenance, page, polygon, raw text, and TrOCR's absent
confidence. It does not compare provider confidence scales. Material textual,
numeric, unit, frequency, or medicine-name conflicts remain unselected and are
withheld from extraction; no dosage or medicine substitution is invented.

In the supported two-provider path, no TrOCR warning is added. If a future
deployment has a budget that permits it but the TrOCR boundary fails, retained
Easy/Paddle evidence is accompanied by one safe warning, with no crop text,
file path, token, credential, or provider exception logged.

## Memory feasibility and actual inference evidence

The approved model hash and Copilot adapter hash were independently checked.
One fictional cursive-font line, `Miraform 250 mg`, executed through the new
IPC and returned `Miraform 250 mg.` with `status=ok` in 13.196 seconds in one
subprocess run (the earlier direct IPC run measured 21.63 seconds). This is
genuine local inference, not a claim about human prescription accuracy.

However, when process-tree RSS was measured from the supervised-side parent,
the same request peaked at **3,270,017,024 bytes (3,118.5 MiB)**. This exceeds
the request-tree maximum of **2,147,483,648 bytes (2 GiB)**. The result
includes isolated-interpreter/native child memory that a single-process TrOCR
measurement cannot represent.

The preflight reserve is consequently 3,400,000,000 bytes. With the production
2 GiB setting it returns `resource_budget_unavailable` before `Popen`; a real
local check completed in 0.059 seconds at 60.5 MiB and returned no TrOCR text.
An unavailable RSS probe also fails closed. The limit was not raised and no
unsafe concurrent model loading was attempted.

This means the new boundary is valid for a future independently measured
lower-memory architecture, but it intentionally cannot execute TrOCR as part
of the current FastAPI request tree.

## Timeout, cancellation, cleanup, and resource verification

- An actual IPC timeout returned the sanitized `timeout` code. The parent
  invoked its tree-termination path. Direct WMI process enumeration was denied
  to the sandbox after this test, so this report does not claim an independent
  OS-wide orphan scan.
- Existing `ProcessingSupervisor` cancellation, shutdown, timeout, output
  limit, and memory-limit tests passed; they kill the whole request child tree.
- New IPC tests cover timeout-to-tree-termination, malformed response rejection,
  response/request bounds, crop bounds, memory preflight, failed memory probe,
  and correlation/polygon preservation.
- Staged-document cleanup is retained by the existing `TemporaryDirectory`
  request boundary and covered by the established HTTP/document safety tests.

## Regression results

| Check | Actual result |
| --- | --- |
| focused IPC/config/router/supervisor/local-worker/FastAPI | 59 passed, 1 existing Starlette deprecation warning |
| complete Python suite | 356 passed, 1 existing Starlette deprecation warning |
| backend suite | 503 passed |
| backend TypeScript typecheck | passed |
| backend build | passed |
| root launcher tests | 6 passed |
| diff whitespace check | passed (only pre-existing line-ending warnings) |

The required fictional PDF/JPEG/PNG adaptive harness attempts were run with
TrOCR disabled and local Paddle paths configured. All three staged and reached
the supervised worker, then safely returned
`WORKER_CATALOGUE_CONNECTION_OPERATIONALERROR` before OCR because the restricted
catalogue connection was unavailable in this execution environment. Their
original bytes remained local; no result was fabricated. Therefore they are not
reported as successful end-to-end OCR evidence for this phase. Previous Phase
2.2 genuine two-provider evidence remains historical, not reasserted as a new
pass.

## Five-layer, Contract v1, and backend compatibility

No Contract v1 change was made. The full Python integration/layer suite,
Contract validation tests, local worker tests, and backend's 503-test suite
passed. Reconciliation continues to withhold material disagreement before the
five layers consume selected text. TrOCR cannot affect Contract v1 in the
current 2 GiB mode because it is rejected before inference.

## Rollback

No database rollback is needed. Keep or restore:

```powershell
$env:MEDDECODE_ADAPTIVE_OCR_ENABLED = 'false'
$env:MEDDECODE_TROCR_ENABLED = 'false'
Remove-Item Env:MEDDECODE_TROCR_PYTHON -ErrorAction SilentlyContinue
Remove-Item Env:MEDDECODE_TROCR_MODEL_DIRECTORY -ErrorAction SilentlyContinue
```

Restart only the local intelligence process. This returns to the existing
EasyOCR-only path. Adaptive EasyOCR/PaddleOCR remains independently opt-in.

## Remaining blockers and next phase

1. The measured 3.12 GiB process tree cannot run inside the mandatory 2 GiB
   request ceiling. A future architecture must be independently designed and
   measured under 2 GiB before enabling TrOCR live; raising the limit is outside
   this phase.
2. The restricted catalogue connection must be restored for a new real local
   PDF/JPEG/PNG all-five-layer run. This report records only the sanitized
   connection failure, not credentials or database details.
3. TrOCR must stay disabled in hosted processing. No hosted rollout is ready
   from this work.

## Final status

TROCR_ISOLATED_PROCESS: VERIFIED

TROCR_MODEL_LOADING: VERIFIED

TROCR_REAL_INFERENCE: VERIFIED

THREE_PROVIDER_ROUTING: PARTIAL

THREE_PROVIDER_FASTAPI: BLOCKED

PROCESS_TREE_CANCELLATION: PARTIAL

PROCESS_TREE_MEMORY_LIMIT: VERIFIED

OCR_EVIDENCE_FUSION: VERIFIED

FIVE_LAYER_COMPATIBILITY: VERIFIED

CONTRACT_V1: VERIFIED

BACKEND_COMPATIBILITY: VERIFIED

CLOUD_OCR_DISABLED: YES

HOSTED_WORKER_DISABLED: YES

READY_FOR_LOCAL_THREE_PROVIDER_ROLLOUT: NO
