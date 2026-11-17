# MedDecode V3 Implementation Roadmap

**Status:** Proposed — awaiting owner approval
**Rule:** approval of one phase does not authorize the next.

## Phase 0 — Architecture approval

- Review this audit, target architecture, lock, matrix and ADRs.
- Resolve naming, retention, confirmation semantics and cloud policy questions.
- Approve or reject the architecture lock only.

**Exit:** signed architecture decision. No code/database effect.

## Phase 1 — Evidence and revision contract (local only)

- Define versioned Review Contract v1 and canonical fingerprint rules.
- Specify bounded OCR evidence schema, field provenance and validation.
- Implement local/domain tests for optimistic concurrency, add/edit/remove/restore and confirmation idempotency.
- Do not change Contract v1.

**Exit:** local contract tests and threat review.

## Phase 2 — Reviewed database proposal

- Prepare additive PostgreSQL migration, RLS, grants, indexes, preflight, verification and rollback.
- Test PostgreSQL 17 under representative non-superuser identities.
- Test cross-user denial, stale finalization, duplicate confirmation and audit retention.

**Approval boundary:** exact hosted SQL hashes and affected objects.

## Phase 3 — Backend APIs disabled by default

- Add owner-scoped review/evidence/document-access endpoints.
- Add idempotency, ETag/lock version, fingerprint and stale-result enforcement.
- Preserve existing upload/results contracts.
- Validate storage headers, preview expiry and no-sensitive-log behavior.

**Exit:** backend suites, security tests, build, isolated DB integration.

## Phase 4 — Review UI disabled by default

- Add responsive evidence/revision workspace without replacing existing results.
- Provide conflict/provenance labels, medicine row operations, confirmation summary and accessible keyboard/mobile behavior.
- Retain result/history refresh behavior.

**Exit:** unit, Playwright, visual and clean lint/build evidence.

## Phase 5 — Local genuine acceptance

- Fictional PDF/JPEG/PNG through OCR, review, confirmation, Layers 2-5, Contract v1 and persistence.
- Exercise multiple medicines, material conflicts, concurrent edits, cancellation, timeouts and stale results.
- Keep cloud OCR and hosted worker disabled.

**Exit:** reproducible evidence with provider/resource measurements.

## Phase 6 — Hosted schema/API deployment disabled

- Reconfirm project, backup, hashes, roles and empty/known safety conditions.
- Deploy only approved additive schema and API-compatible release with feature disabled.
- Independently verify RLS, grants and unchanged existing records.

**Approval boundary:** hosted schema/application deployment.

## Phase 7 — Synthetic allowlisted rollout

- Enroll one approved fictional identity.
- Enable review flow and one bounded worker only for that identity.
- Verify real S3, review, confirmation, intelligence, result/history and unrelated-job isolation.
- Disable immediately on anomaly.

**Approval boundaries:** enrollment/feature activation; synthetic writes; worker activation are separate.

## Phase 8 — Production readiness

- Establish retention, monitoring, SLOs, incident response, capacity and backup/recovery coverage.
- Resolve frontend lint and all release regressions.
- Expand account admission gradually.

## Phase 9 — Optional provider experiments

- TrOCR: only after a safe architecture fits the existing budget or a separately approved budget change.
- Google OCR: only after privacy/legal/residency/cost/credential review and a fictional-data trial.
- Neither provider is required for V3 review launch.

## Emergency disable and rollback principles

1. Disable new V3 admission and worker startup first.
2. Preserve evidence, revisions, results and audit history.
3. Let no stale job finalize as current.
4. Roll back application routing before destructive schema action.
5. Execute SQL rollback only under separate authorization after exact state inspection.

## Regression gates per implementation phase

- Python full suite and resource/supervisor tests when OCR boundary changes.
- Backend full tests, typecheck and build.
- Frontend unit tests, lint, build and targeted Playwright.
- PostgreSQL role/RLS/concurrency/rollback tests.
- Root launcher startup/shutdown with workers disabled by default.
- `git diff --check`; no automated commit/push.

## Open owner decisions

1. Whether review confirmation is mandatory for every upload or only uncertain/high-risk cases (recommend mandatory for initial V3 rollout).
2. Retention period and storage representation for bounded provider evidence.
3. Whether legacy results receive an explicit immutable `legacy` revision marker.
4. Whether source preview is streamed or short-lived signed access.
5. Whether any cloud OCR processing is permissible and in which region.
6. Product language for “confirmed” so it cannot be mistaken for clinical validation.
