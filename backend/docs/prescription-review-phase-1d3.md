# Prescription Review Phase 1D.3

## Implementation

Phase 1D.3 connects Copilot's existing preprocessing adapter to the supervised
local prescription worker behind the explicit, default-off setting:

`MEDDECODE_DOCUMENT_PREPROCESSING_ENABLED=false`

Changed files:

- `intelligence/app/integration/local_pdf_pipeline.py`
- `intelligence/app/integration/local_pdf_worker.py`
- `intelligence/app/integration/process_supervisor.py`
- `intelligence/app/integration/fictional_document_harness.py`
- `intelligence/tests/integration/test_process_supervisor.py`
- `intelligence/.env.example`
- this handoff

No preprocessing algorithm, frontend file, Contract v1 schema, hosted database
object or hosted worker was changed.

## Execution path

The supervisor now passes `--preprocessing` explicitly; it does not forward an
ambient feature flag into the restricted child. The child reuses
`process_document_with_preprocessing` for document validation, native searchable
PDF routing, safe raster preprocessing and OCR fallback. A small adapter invokes
the existing hybrid engine for raster pages and retains the raw provider evidence.
Native text and raster results then use the unchanged Layers 2-5 and Contract v1
mapper. TrOCR and cloud OCR remain disabled.

The Phase 1D.1 deterministic review initializer and confirmed-data adapter were
not duplicated. Phase 1D.2's PostgreSQL two-revision transaction remains the
result persistence and history mechanism.

## Genuine fictional-document evidence

All runs were sequential, supervised and used local model files only.

| Input | Route/providers | Result | Medicines | Elapsed | Peak child RSS |
|---|---|---:|---:|---:|---:|
| Generated searchable PDF | Native PDF text; EasyOCR 0, PaddleOCR 0 | completed_with_warnings | 1 | 2.156 s | 115,978,240 B |
| `synthetic-prescription-002.pdf` | Genuine EasyOCR 3 predictions | completed_with_warnings | 1 | 21.094 s | 1,344,999,424 B |
| `synthetic-prescription-001.pdf` | Genuine EasyOCR 20 predictions | completed_with_warnings | 1 | 18.953 s | 1,345,257,472 B |
| `synthetic-prescription-001.jpg` | Genuine EasyOCR 20 predictions | completed_with_warnings | 1 | 16.531 s | 1,343,164,416 B |
| `synthetic-prescription-001.png` | Genuine EasyOCR 19 predictions | completed_with_warnings | 1 | 15.843 s | 1,331,392,512 B |

The generated searchable PDF proves native-text routing, not OCR. The other four
runs are genuine EasyOCR inference. Each produced a non-empty Contract v1 result,
which demonstrates execution through Layers 2/3 as well as downstream mapping;
it is not a claim of clinical accuracy.

An adaptive EasyOCR/PaddleOCR run on the fictional PNG was attempted with the
existing local Paddle models. Supervision stopped it with
`PROCESSING_MEMORY_LIMIT` under the unchanged 2 GiB process-tree budget. It was
not retried, the budget was not raised, and the verified EasyOCR path remains
available. No TrOCR process was started.

## Review and PostgreSQL acceptance

The unchanged Phase 1D.1/1D.2 components remain verified as follows:

- OCR-derived Contract v1 deterministically initializes stable review rows;
- draft edits and confirmation preserve canonical fingerprints;
- confirmed structured fields, rather than stale OCR fields, run through the
  genuine Node-to-Python Layers 4/5 adapter;
- the local restricted PostgreSQL role persisted Revision 1 and Revision 2;
- Result 2 became current and Result 1 remained immutable history;
- identical completion replay was idempotent;
- stale Revision 1 completion and cross-owner reads were rejected;
- current-result repository explicitly selects `is_current=true`.

These document-processing and database proofs were performed in the same local
codebase but not as one uninterrupted automated transaction. Therefore this
phase does not claim a fully continuous OCR-to-two-revision PostgreSQL E2E.

## Tests

- Preprocessing/local worker focused suite: 39 passed.
- Supervisor/local worker focused suite after explicit flag wiring: 34 passed.
- Backend suite initially had one transient timeout while the heavyweight full
  Python run was executing concurrently. After OCR exited, the affected file
  passed 22/22 and the complete backend rerun passed 544/544.
- Python suite: 412 passed; 3 failures and 4 errors remain environment-dependent
  legacy Supabase/Layer 4 tests because `SUPABASE_URL`/`SUPABASE_KEY` and runtime
  DB fixtures are not configured in this shell.
- TypeScript typecheck passed.
- Backend production build passed.
- `git diff --check` reported no whitespace errors (existing line-ending warnings only).

## Failure and safety behavior

Existing document byte/page/pixel validation, supervised timeout, child process
termination, output bounds and the 2 GiB memory ceiling remain active. Empty or
invalid OCR cannot be marked successful. Preprocessing is disabled by default;
normal hosted processing and review V3 remain disabled.

## Remaining work and boundaries

1. Build one backend-owned acceptance runner that takes the genuine OCR Contract
   result through the real PostgreSQL review RPCs, two edits/confirmations,
   confirmed-data recomputation and result-history RPCs without splitting the
   proof across harnesses.
2. Exercise a multipage mixed fictional PDF in that runner.
3. Resolve PaddleOCR's supervised memory-limit failure without raising the
   established budget; otherwise keep it unavailable for this route.
4. Frontend review/result-history browser acceptance remains a separate phase.
5. Hosted deployment requires separate review and approval of the Phase 1D.1 and
   1D.2 migration hashes. No hosted write or activation occurred.

## Status

- `PREPROCESSING_FASTAPI_INTEGRATION: VERIFIED`
- `REAL_PDF_OCR: VERIFIED`
- `REAL_JPEG_OCR: VERIFIED`
- `REAL_PNG_OCR: VERIFIED`
- `LAYER2_LAYER3_EXTRACTION: VERIFIED`
- `OCR_TO_REVIEW_PERSISTENCE: PARTIAL`
- `FIRST_REVISION_CONFIRMATION: VERIFIED` (local PostgreSQL component proof)
- `SECOND_REVISION_CONFIRMATION: VERIFIED` (local PostgreSQL component proof)
- `RESULT_HISTORY_AND_FENCING: VERIFIED`
- `GENUINE_LOCAL_POSTGRESQL_E2E: PARTIAL`
- `BACKEND_REGRESSION: VERIFIED`
- `HOSTED_MIGRATIONS_EXECUTED: NO`
- `HOSTED_WORKERS_ENABLED: NO`
- `READY_FOR_FRONTEND_BACKEND_E2E: NO`
