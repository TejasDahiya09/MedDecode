# MedDecode Current Architecture

Date: 2026-11-18

## System boundary

MedDecode is a three-service prescription-information prototype. It is not a
clinically validated medical device. The React browser application never
receives PostgreSQL, S3 worker, or internal Python credentials.

```text
React/Vite browser
  -> Express API (bearer authentication, ownership, validation)
     -> Supabase Auth and owner-scoped Data API/RPCs
     -> private S3 prescription objects
     -> restricted single-attempt worker (separate opt-in process)
        -> private FastAPI endpoint
           -> supervised local OCR child
           -> Layers 2-5
        -> fenced PostgreSQL review/result RPCs
```

## Frontend

React Router protects workspace routes. TanStack Query manages authenticated
requests and polling. Route-level lazy boundaries keep the initial application
entry at 102.89 kB minified in the current build. Prescription state is a
projection of prescription, job, review, and current-result state: completion
of initial OCR means review is required, not that intelligence results exist.

Implemented protected areas include upload, prescription history, review/edit,
results, official Medicine Library and comparison, Medicine Cabinet, Reminders,
profile, family members, and learning content. Development fixtures are marked
and gated separately from ordinary processing.

## Backend and storage

Express verifies the Supabase bearer identity before constructing owner-scoped
repositories. Private document preview first resolves owned metadata and then
streams a bounded S3 object with cancellation and disposal. Safe diagnostics
contain a correlation ID, stage, bounded category, and optional HTTP status
class; they exclude object keys, document contents, identities, and raw provider
errors.

Upload stores private document metadata and can submit a durable processing job
only through configured owner-scoped RPCs. A job is not executed by an Express
request. Results are validated against Contract v1 before fenced persistence.

## Review and worker lifecycle

The V3 path separates initial OCR from confirmed intelligence:

1. Validate and stage an owner-bound document.
2. Run supervised OCR and Layers 2-3.
3. Persist immutable evidence and initialize a draft review.
4. Complete the initial job without creating an intelligence result.
5. Wait for the user to edit and confirm an exact revision.
6. Submit one revision-bound job.
7. Run Layers 4-5 from confirmed canonical fields.
8. Finalize through revision, fingerprint, job, worker, lease, attempt, and
   claim-generation fences.

The worker is disabled by default. Controlled startup requires a dedicated
login, scoped RPC mode, an approved automatic admission, concurrency one,
single-attempt behavior, explicit V3 flags, separate S3 credentials, and the
private intelligence token. There is no automatic retry or batch adoption in
the reviewed controlled mode.

## Intelligence and OCR

FastAPI exposes liveness, readiness, and a private processing endpoint. The
processing endpoint enforces bearer authentication, file signature and resource
limits, one-document concurrency, bounded output, timeout, cancellation,
temporary-file cleanup, and process-tree termination.

EasyOCR is the local default. PaddleOCR adaptive fallback is disabled unless an
explicit flag and local model directories are provided. TrOCR is independently
disabled by default and remains constrained by the 2 GiB request budget. AWS
Textract and Google Cloud Vision SDKs are optional dependency profiles; provider
selection, credentials, data transfer, region, retention, and cost all require
separate approval. There is no automatic local-to-cloud fallback.

Unverified identities, label-only rows, and uncertain numbered regions remain
warning/evidence for manual review and cannot automatically enter Contract v1
medicines or Layers 4-5. Confidence values from different OCR providers are not
treated as calibrated probabilities.

## PostgreSQL and Supabase

Supabase Auth is the identity source. PostgreSQL stores prescriptions, jobs,
evidence, review revisions, immutable result history, Cabinet and Reminders.
RLS, table/function ACLs, user-scoped API clients, security-definer RPC checks,
and worker fencing are distinct controls.

Migration deployment is additive and approval-bound: immutable hash, exact
target identity, TLS `verify-full`, read-only preflight, fresh restore-tested
backup, one approved deployment file, then independent verification. Rollback
is never automatic. Local PostgreSQL 17 tests do not prove hosted parity;
hosted phase reports are historical evidence and must be refreshed before a new
deployment decision.

## Local operation

`npm run dev` is the reviewed root launcher. It starts FastAPI, Express, and
Vite, but not the worker. On Windows shutdown uses bounded `taskkill /T /F` for
its child trees, so in-flight work can be interrupted; database fences protect
durable state, but graceful drain remains an operational limitation.

See `docs/platform-local-runtime.md`, `docs/SECURITY.md`, and
`docs/MEDECODE_RELEASE_READINESS.md` for configuration and release boundaries.
