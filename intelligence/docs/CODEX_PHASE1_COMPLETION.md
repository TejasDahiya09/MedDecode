# Codex Phase 1 Completion

Date: 2026-11-14
Branch inspected: `integration/full-project`
Scope: FastAPI execution boundary, direct catalogue safety, Node HTTP compatibility, launcher integration, and infrastructure tests.

## Outcome

Phase 1 closes the two P0 execution-boundary defects from the forensic audit. Documents are now geometry-checked before rendering, and native OCR executes in a supervised single-document process that can be terminated as a process tree on timeout, cancellation, service shutdown, excessive output, or excessive memory. No OCR recognition algorithm, intelligence layer, hosted schema, hosted data, or worker activation was changed.

## 1. Original defects and verified causes

1. `http_service.py` enforced only request bytes and a magic prefix. A small PDF could declare many pages or very large page geometry and cause unbounded rendering work.
2. OCR ran through `asyncio.to_thread` and was deliberately shielded. HTTP timeout returned 504, but the native EasyOCR thread continued until completion. Python cannot safely terminate a native inference thread.
3. The request body was accumulated in memory before being copied to a temporary file.
4. FastAPI readiness proved configuration and an already-created in-process model only; it did not execute a current restricted catalogue query.
5. The audit documentation showed only three catalogue columns, while live Layer 4 SQL also needs `entity_type` and `identity_hash`. A successful login alone did not prove those grants.

## 2. Files changed

- `intelligence/app/integration/http_service.py`
- `intelligence/app/integration/document_safety.py` (new)
- `intelligence/app/integration/process_supervisor.py` (new)
- `intelligence/app/integration/fictional_document_harness.py` (new)
- `intelligence/app/database/catalogue_connection.py`
- `intelligence/.env.example` (new; no secrets)
- `intelligence/tests/integration/test_http_service.py`
- `intelligence/tests/integration/test_document_safety_boundary.py` (new)
- `intelligence/tests/integration/test_process_supervisor.py` (new)
- `intelligence/tests/integration/test_catalogue_connection.py`
- `scripts/dev-launcher.cjs`
- `scripts/dev-launcher.test.cjs`
- `intelligence/docs/CODEX_PHASE1_COMPLETION.md` (this report)

Copilot-owned Layer 1–5 implementation files were not modified.

## 3. PDF and image resource limits

`document_safety.py` performs inexpensive checks before OCR:

- maximum staged bytes (streamed to disk; Content-Length is not trusted);
- PDF magic and parser validation;
- encrypted/empty/malformed PDF rejection;
- maximum PDF pages;
- rendered width/height calculation from page geometry at the pipeline's 120 DPI;
- per-page and aggregate rendered-pixel ceilings;
- JPEG/PNG format verification, single-frame enforcement, width/height and decoded-pixel ceilings;
- Pillow decompression-bomb warnings/errors converted to safe rejections;
- temporary directory cleanup on success, rejection, cancellation, timeout, or child failure.

Conservative defaults and environment variables are documented in `intelligence/.env.example`. Invalid or unsafe configuration fails startup.

## 4. OCR cancellation architecture

FastAPI no longer runs native OCR in a thread. It invokes the existing `app.integration.local_pdf_worker` as a supervised, one-document child process:

- one global request gate preserves concurrency one;
- timeout and task cancellation terminate only the tracked child process tree;
- Windows uses the exact PID with `taskkill /T /F`; POSIX uses a new process group;
- stdout, stderr and response JSON are bounded;
- Windows RSS accounting covers the venv launcher and descendant interpreter process tree;
- a configurable child-tree RSS limit is enforced;
- child response IDs and terminal status are checked before the response crosses the HTTP boundary;
- service shutdown kills all and only tracked children;
- the child receives catalogue and essential OS variables, but not the internal bearer token, worker credentials, backend credentials, or unrelated environment secrets.

Trade-off: EasyOCR loads once per document, rather than remaining in the FastAPI process. The final fictional PDF completed in about 16 seconds and peaked at approximately 1.69 GB across the Windows child tree. This startup/memory cost is accepted in Phase 1 because it provides a real termination boundary. A reusable supervised child protocol would require a separately reviewed IPC/lifecycle change.

## 5. FastAPI security and reliability

- constant-time internal bearer-token comparison is preserved;
- only `application/octet-stream` is accepted at the private endpoint;
- contract metadata remains base64/JSON/Contract-v1 validated and bounded;
- caller-provided paths or remote URLs are never fetched;
- document bytes stream to a newly created private temporary path;
- malformed signatures and decoded geometry fail before OCR;
- errors expose only stable safe messages/statuses, never child stderr or exception text;
- `/health` remains a liveness check;
- startup readiness now verifies local model files, EasyOCR availability, safe limits, and a live restricted catalogue `SELECT 1`, then closes the connection;
- `/ready` performs no write and does not open an unbounded connection per health probe.

## 6. Direct catalogue query verification

Verified against the hosted direct endpoint with the existing restricted identity. The diagnostic ran inside an explicit read-only transaction and rolled back:

- host: `db.wyripeqruhvbksjfsvlr.supabase.co:5432`;
- database: `postgres`;
- identity: `meddecode_catalogue_python_reader`;
- TLS: active, client configuration `verify-full` with the configured CA;
- actual Layer 4 exact, prefix, and `EXPLAIN` query shapes executed;
- prefix query returned five bounded candidates; an exact `paracetamol` normalized-name query returned zero (a legitimate no-match, not a permission failure);
- SELECT available for `entity_id`, `entity_type`, `evidence`, `identity`, and `identity_hash`;
- no INSERT, UPDATE, DELETE, or schema CREATE privilege;
- connection closed after verification.

The connection factory now also sets `default_transaction_read_only=on`. The feared two-column permission gap is not present in the current hosted role, so no hosted GRANT is required.

## 7. Backend HTTP compatibility

No Node contract change was required. Existing code already provides:

- loopback-or-HTTPS endpoint validation and a server-only token;
- 10 MiB staged-file bound;
- caller cancellation combined with a 120-second timeout;
- 1 MiB response bound;
- JSON parsing and full Contract-v1/correlation validation;
- no fallback when the HTTP intelligence service is explicitly composed;
- fenced completion, duplicate-result prevention, and terminal failure behavior;
- `allowRetry: false` in controlled single-attempt mode.

The new FastAPI cancellation boundary makes the existing Node AbortSignal meaningful: cancelling the HTTP operation now terminates the supervised OCR process instead of abandoning native work.

## 8. Launcher and shutdown verification

The root launcher now forwards `MEDDECODE_INTELLIGENCE_*` settings only to Python while continuing to withhold worker/backend credentials. Worker startup remains explicit and disabled by default.

Evidence:

- launcher security/unit tests: 6 passed;
- an updated FastAPI instance started on loopback port 18000, returned `alive` and `ready`, and released the port after shutdown;
- exact child termination, shutdown cleanup, and repeated-timeout cleanup passed on Windows;
- the normal root launcher correctly refused to create a duplicate because ports 3000/5174/8000 were already serving the existing MedDecode runtime;
- existing endpoints returned backend health 200, backend readiness 200, and Python readiness 200;
- no unidentified existing service was stopped.

A fresh end-to-end `npm run dev` startup/shutdown cycle was therefore not performed in this session. This is the only reason `ROOT_LAUNCHER` is reported PARTIAL rather than VERIFIED.

## 9. Test evidence

- focused Python boundary/database tests: 25 passed;
- full Python regression suite: 300 passed, one pre-existing Starlette deprecation warning;
- full backend suite: 503 passed;
- focused Node HTTP client/worker/Contract tests: 13 passed;
- backend TypeScript typecheck: passed;
- backend build: passed;
- root launcher tests: 6 passed;
- direct restricted catalogue query verification: passed;
- updated FastAPI loopback liveness/readiness/startup/shutdown: passed;
- genuine local fictional PDF through the final supervisor, EasyOCR, five layers, restricted catalogue and Contract v1: `completed_with_warnings`, SHA-256 `1036ba242a67476c7e9ba150c7da112fa146c5e5a5d2e3bdfdde39c85b802a74`, 1 medicine, 2 warnings, 16.015 seconds, peak child-tree RSS 1,686,622,208 bytes.

The genuine smoke was local document inference plus read-only hosted catalogue access. It did not create, claim, update, or finalize a hosted prescription job.

## 10. Evaluation harness for Copilot

Run only with an explicitly fictional document:

```powershell
cd C:\Users\dahiy\MedDecode-integration\intelligence
.\.venv\Scripts\python.exe -m app.integration.fictional_document_harness `
  --document C:\path\to\fictional.pdf `
  --file-type application/pdf `
  --fictional-confirmed
```

The single-line JSON output contains only status, file hash/size, elapsed time, peak child-tree RSS, medicine count, warning count, and a sanitized error category. It never prints OCR text, medicine names, patient data, credentials, or child stderr.

Copilot interface requirements:

1. Keep `app.integration.local_pdf_worker` as a single-document, stdin-request/stdout-Contract-v1 entry point.
2. Provider changes must continue to honor the supplied local path and must not fetch remote URLs.
3. Stdout must remain JSON-only; patient/OCR evidence must not be written to production logs.
4. A future persistent model process requires a separately reviewed bounded IPC protocol, correlation, cancellation, memory, and shutdown contract.

No algorithm or Contract-v1 schema change is required by Phase 1.

## 11. Known limitations

- Per-document model initialization adds latency and memory compared with an in-process cached reader.
- Windows memory enforcement sums the supervised process tree by periodic sampling; extremely short spikes between samples may not be observed.
- Client-disconnect termination depends on ASGI delivering task cancellation; regardless, the hard processing timeout still bounds computation.
- Readiness is a startup dependency snapshot. A later catalogue outage fails processing safely, but readiness does not continuously reconnect or mutate state.
- PDF parser/renderer native-code defects cannot be eliminated by geometry checks; the subprocess timeout, memory ceiling, and process-tree termination provide containment.
- The existing runtime on the normal ports was not restarted, so it will use the new code on its next controlled restart.

## 12. Approvals and rollback

No hosted schema, grant, RLS, role, patient record, prescription job, AWS object, or worker flag was changed. No additional hosted approval is required for these local changes. Normal deployment/restart remains an operational approval boundary.

Rollback is code-only:

1. restore the prior `http_service.py` transport implementation;
2. remove `document_safety.py`, `process_supervisor.py`, and `fictional_document_harness.py`;
3. remove the `default_transaction_read_only` connection option only if compatibility requires it;
4. restore the prior launcher Python-environment filter and remove the new limit variables;
5. rerun Python boundary tests, backend HTTP-client tests, typecheck, and build.

Do not roll back by changing hosted grants or activating a worker.

## Final status

PDF_RESOURCE_LIMITS: VERIFIED

OCR_EXECUTION_CANCELLATION: VERIFIED

FASTAPI_SECURITY: VERIFIED

DIRECT_CATALOGUE_QUERIES: VERIFIED

HTTP_CONTRACT_V1: VERIFIED

ROOT_LAUNCHER: PARTIAL

READY_FOR_HYBRID_OCR_INTEGRATION: YES
