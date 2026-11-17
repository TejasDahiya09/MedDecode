# Codex Phase 2.5 - Staged Three-Provider OCR Integration

Date: 2026-11-15
Branch: `integration/full-project`

## Outcome

A real sequential EasyOCR/PaddleOCR -> process exit -> isolated TrOCR architecture is implemented behind the existing adaptive/TrOCR feature gates. Genuine local inference invoked all three providers. The measured descendant-tree peak was **3,214,577,664 bytes (2.99 GiB)**, so the unchanged **2,147,483,648-byte (2 GiB)** supervisor limit correctly prevents live TrOCR activation. The verified EasyOCR/PaddleOCR path remains available and unchanged by default.

No hosted worker, database mutation, cloud OCR, model download, Contract v1 change, or Layer 2/3 edit occurred.

## Architecture implemented

1. `staged_primary_ocr_worker.py` validates/renders the document, runs EasyOCR and bounded PaddleOCR fallback, emits a bounded versioned JSON/PNG evidence envelope, and exits.
2. `staged_local_pdf_worker.py` waits for that process to exit before constructing the isolated TrOCR subprocess.
3. Only at most four existing uncertain line crops are passed through bounded JSON/base64 PNG IPC. No source path is accepted from OCR content and pickle is not used.
4. TrOCR exits before catalogue access and Layers 2-5 begin.
5. Evidence is reconciled by the existing conservative `_reconcile` behavior. Conflicting evidence remains withheld from extraction; raw provider confidence values are not treated as calibrated cross-provider probabilities.
6. The original `ProcessingSupervisor` remains the owner of the coordinator and all descendants. Its timeout, cancellation, process-tree termination, response-size limit, and 2 GiB memory monitor remain authoritative.

TrOCR is selected only when adaptive routing marks handwriting as possible and bounded fallback regions exist. `MEDDECODE_TROCR_ENABLED=true` remains inert unless adaptive OCR is also enabled and runtime assets validate.

## Exact files changed in Phase 2.5

Added:

- `intelligence/app/integration/staged_ocr_protocol.py`
- `intelligence/app/integration/staged_primary_ocr_worker.py`
- `intelligence/app/integration/staged_local_pdf_worker.py`
- `intelligence/app/integration/staged_ocr_benchmark.py`
- `intelligence/tests/integration/test_staged_ocr_protocol.py`
- `intelligence/docs/CODEX_PHASE2_5_STAGED_THREE_PROVIDER_INTEGRATION.md`

Updated:

- `intelligence/app/integration/process_supervisor.py`
- `intelligence/app/layer1_document_processing/trocr_ipc.py`
- `intelligence/tests/layer1/test_trocr_ipc.py`
- `intelligence/tests/integration/test_catalogue_connection_diagnostic.py` (mock corrected to psycopg3 `pgconn.ssl_in_use`)

Copilot-owned Layers 2 and 3 and the TrOCR provider implementation in `hybrid_ocr.py` were not edited.

## Process lifecycle and cancellation

- Primary OCR is a child process in its own Windows process group.
- A provider timeout or coordinator cancellation invokes recursive process-tree termination.
- The coordinator requires the primary process to return and validates a final versioned marker before TrOCR can start.
- Native library stdout preceding that marker is never forwarded or parsed as evidence.
- TrOCR uses the existing offline-only IPC worker, output limits, crop limits, timeout, and recursive termination.
- Cancellation of the outer request terminates the coordinator and descendants with Windows `taskkill /T /F` through the existing supervisor.
- No persistent or detached OCR process was introduced.

## Genuine inference evidence

Existing fictional fixtures and existing offline model caches were used.

| Document | EasyOCR | PaddleOCR | Result |
|---|---:|---:|---|
| `synthetic-prescription-001.pdf` | 20 | 1 | primary stage completed |
| `synthetic-prescription-001.jpg` | 20 | 0 | primary stage completed |
| `synthetic-prescription-001.png` | 19 | 2 | primary stage completed |

The genuine staged PNG run then invoked TrOCR on two bounded crops:

- TrOCR predictions: 2
- TrOCR status: `ok`
- elapsed: 47.038 seconds
- peak descendant-tree RSS: 3,214,577,664 bytes
- configured limit: 2,147,483,648 bytes
- within limit: false

This was actual local model inference, not a mock. It is evidence that the IPC and staged routing work, but also evidence that enabling this checkpoint inside the present 2 GiB request budget is unsafe.

## Memory decision

After the real measurement, the production preflight reserve was set to 3,300,000,000 bytes. Under the unchanged 2 GiB limit TrOCR is therefore withheld before expensive model loading. The outer memory monitor remains in place as a second independent guard.

A candidate future budget would need at least the measured peak plus operational headroom. A 25% margin is approximately **4,018,222,080 bytes (3.74 GiB)**; a practical rounded candidate is **4 GiB with concurrency one**. Host physical/free RAM could not be queried from the current restricted execution identity, so this is not an activation recommendation. Raising the limit requires separate approval, host-memory verification, another full-tree benchmark, and timeout/cancellation regression at the proposed limit.

## Catalogue and five-layer compatibility

The staged coordinator opens the restricted official catalogue only after all OCR model processes have exited, then calls the existing Layers 2-5 and Contract v1 mapper. No layer interfaces or Contract v1 fields changed. The corrected catalogue diagnostic still checks `connection.pgconn.ssl_in_use`, verify-full TLS, restricted role, read-only transaction state, and a parameterized query.

The current Codex environment cannot reliably prove the live direct catalogue query because its outbound network sandbox may reject the socket. Therefore a genuine three-provider **FastAPI-to-catalogue-to-Contract** success is not claimed in this report. Existing host-side catalogue evidence remains separate from this run.

## Tests

- Focused staged protocol/IPC/supervisor: **21 passed**.
- Full Python suite: **383 passed**, one Starlette deprecation warning.
- Backend tests: **503 passed**.
- Backend typecheck: passed.
- Backend build: passed.
- Root launcher tests: **6 passed**.
- `git diff --check`: passed; only pre-existing line-ending warnings were printed.

The focused tests cover bounded evidence round trips, invalid image rejection, explicit memory reserve fail-closed behavior, primary-stage timeout tree termination, IPC identity/coordinates, TrOCR timeout cleanup, supervisor timeout/cancellation, and output limits.

## Feature flags

- Adaptive false / TrOCR false: existing EasyOCR baseline.
- Adaptive true / TrOCR false: verified EasyOCR + PaddleOCR path.
- Adaptive true / TrOCR true: staged path selected, but TrOCR launch is currently rejected by the measured resource preflight under 2 GiB.
- Adaptive false / TrOCR true: rejected by configuration.

Both flags remain disabled by default. No hosted processing was activated.

## Rollback

To revert only Phase 2.5, remove the four `staged_*` integration modules and their focused test, restore `process_supervisor.py` to always use `self._worker_module`, and remove the configurable `memory_reserve_bytes` field from `TrOCRSubprocessConfig`. Do not alter the Phase 2.3 IPC worker, Copilot TrOCR provider, Contract v1, or Layers 2/3. With both feature flags false, the runtime already follows the pre-Phase-2.5 EasyOCR baseline without any rollback.

## Final status

STAGED_OCR_ARCHITECTURE: VERIFIED

EASYOCR_INTEGRATION: VERIFIED

PADDLEOCR_INTEGRATION: VERIFIED

TROCR_INTEGRATION: PARTIAL

THREE_PROVIDER_FASTAPI: BLOCKED

PROCESS_TREE_MEMORY: BLOCKED

CANCELLATION_AND_TIMEOUT: VERIFIED

FIVE_LAYER_COMPATIBILITY: PARTIAL

CONTRACT_V1: VERIFIED

BACKEND_COMPATIBILITY: VERIFIED

READY_FOR_THREE_PROVIDER_LOCAL_ROLLOUT: NO
