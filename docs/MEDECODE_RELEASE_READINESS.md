# MedDecode Release Readiness

Decision date: 2026-11-18 (Asia/Calcutta)

Candidate commit: `37aa3166b3d7345592d06e5ec25dfa85feffcc76`

## Decision: NO-GO

The source, static gates, local security tests, clinical exclusion invariants,
and local EasyOCR baseline are substantially stronger than the original audit.
The release remains a no-go because the core user journey has not been proven as
one uninterrupted isolated or hosted transaction, and the authenticated hosted
document-preview path remains unverified. Passing unit tests and separately real
OCR/browser runs do not close those user-facing gaps.

This decision does not invalidate the successful hosted Reminder remediation or
the locally verified review/result workflow. It prevents representing the whole
application as deployment-ready until the remaining acceptance evidence exists.

## Current gate summary

- Security: local PostgreSQL 17 Reminder matrix passes; historical hosted
  Migration 012 verification passes. No Batch 8 hosted query was performed.
- Clinical safety: unverified identities remain excluded; 451 Python tests pass.
  No clinical accuracy claim is supported.
- Backend: typecheck/build pass; 591 tests pass when the three sandbox-blocked
  PG tests are combined with the serial run; 3 source-gated tests remain skipped.
- Frontend: lint/typecheck/build pass; 378 unit and 14 focused Chromium tests pass.
- Operations: launcher tests 7/7; worker remains opt-in and was not started.
- Dependencies: cloud OCR is optional, but Python OCR packages are not fully
  lockfile reproducible.

## Release blockers and risks

| Item | Severity | Evidence and user impact | Required remediation | Blocks release? |
| --- | --- | --- | --- | --- |
| Uninterrupted upload-to-result acceptance | High | Batch 5 used a real browser review/result flow and a separate genuine OCR run. A document could still fail at the untested composition boundary. | Run one fictional upload through the actual supervised worker, pause for review, confirm, and verify results/history with cleanup and resource evidence. | Yes |
| Hosted authenticated S3 preview | High | Batch 4 could not access an approved owner session; local preview passed. Users may still receive 503 from IAM, KMS, bucket, key, or configuration drift. | With an approved fictional owner session, read one bounded preview, classify safe diagnostics, and verify anonymous/cross-owner denial without retaining bytes. | Yes for the hosted deployment |
| Genuine adaptive PaddleOCR | Medium | Package is installed, but no explicit readable detection/recognition directory pair was configured in Batch 7. Low-quality fallback behavior is unproven on this checkout. | Supply reviewed local model paths without download, run sequential supervised fictional fallback cases, measure peak tree memory, and prove safe EasyOCR fallback. | No while adaptive OCR stays disabled; yes before enabling it |
| Genuine supervised FastAPI inference | Medium | Genuine EasyOCR ran through Layer 1; supervisor controls passed automated tests. The same genuine inputs were not sent through the live FastAPI supervisor in Batch 7/8. | Run fictional PDF/JPEG/PNG through the private endpoint with the existing 2 GiB limit and verify timeout/cancellation/no-orphan behavior. | Yes for claims of end-to-end processing readiness |
| Python dependency reproducibility | Medium | Direct packages such as EasyOCR/PaddleOCR remain unpinned; `pip check` passes only for this installed environment. | Produce and test a Python 3.12 lock/constraints artifact on a clean machine without changing provider defaults. | Yes for reproducible release packaging |
| Legacy unauthenticated demo expectations | Low | Older browser expectations conflict with the authenticated production UI. They are not current acceptance evidence. | Classify or rewrite them around explicit development fixtures without weakening authentication. | No |
| Eleven credential-bearing browser specs plus target-only spec | High process risk | They are preserved privately and excluded from Git. They cannot safely run in CI and are not reviewed evidence. | Replace embedded credentials with an approved secret-injection harness and rotate any credentials ever embedded, then review before restoring tests. | Yes for claiming hosted browser coverage; not a runtime code blocker |
| Remaining skipped tests | Medium | Three guarded PG exact-recovery/transport tests were skipped; hosted/runtime opt-in suites are also outside defaults. | Run each against a task-owned disposable target under its explicit guard and record results. | Conditional; blocks claims in those paths |
| Broad default privileges for future `public` objects | Medium | Historical Migration 012 report says existing Reminder ACLs are correct but global defaults were out of scope. A future table/function could inherit excessive privileges. | Independently review `pg_default_acl`; prepare a separately approved forward migration if broader defaults are unsafe. | No for verified current Reminder tables; yes before relying on defaults for new objects |
| Windows forceful launcher shutdown | Medium | Ctrl+C uses `taskkill /T /F`; an in-flight local request can be interrupted. | Add graceful drain/acknowledgment followed by bounded forced fallback and test an in-flight OCR request. | No for development; yes for production-style operation |
| Starlette/AnyIO deprecation | Low | Full Python suite emits one third-party warning. | Validate a compatible pinned dependency set with warnings-as-errors canary coverage. | No |
| Multi-source UI state projection | Medium | Known cases are tested, but there is no exhaustive property/browser matrix for every prescription/job/review/result combination. | Centralize or exhaustively test the current pure state projection without changing API contracts. | Conditional |

## Operational readiness rules

1. Keep worker, adaptive OCR, TrOCR, and cloud OCR disabled by default.
2. Use `npm run dev` for ordinary local development; controlled worker startup
   always requires a fresh scope/admission preflight and explicit approval.
3. Do not deploy from historical hashes alone. Recalculate candidate hashes,
   inspect the target, and restore-test a fresh backup.
4. Keep database administration, restricted catalogue, scoped worker, and
   frontend publishable identities separate. Never place server secrets in
   `VITE_` variables.
5. Treat S3 documents, OCR text, logs, screenshots, database dumps, and browser
   credentials as sensitive. Keep them outside Git and reports.
6. Do not auto-retry or manually rewrite job state. Use only reviewed, fenced,
   exact-job recovery under separate authorization.
7. A schema-valid Contract v1 result is not clinical validation. Preserve
   uncertainty and require human confirmation before revision-bound intelligence.

## Exit criteria for a revised decision

A revised `CONDITIONAL GO` requires the uninterrupted fictional workflow,
hosted owner preview classification, genuine supervised FastAPI evidence, and a
clean-install dependency constraints test. A full `GO` additionally requires
resolution or explicit acceptance of the skipped security/recovery paths and a
deployment-specific preflight against the exact target configuration.

No hosted mutation, upload, worker activation, migration, dataset change, or
MedDecode-dev change occurred in Batch 8.
