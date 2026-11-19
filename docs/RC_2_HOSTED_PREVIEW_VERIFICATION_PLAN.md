# RC-2 Hosted Owner-Authenticated Preview Verification Plan

Date: 2026-11-19
Status: READY FOR SEPARATE TARGET-SPECIFIC AUTHORIZATION
Execution performed while preparing this plan: none

## Objective and exact scope

Verify one existing fictional prescription document through the normal authenticated application route without changing PostgreSQL, S3, IAM, KMS, worker, or prescription state.

- Supabase project: `wyripeqruhvbksjfsvlr`
- Target prescription: `2bb56f2d-df83-4132-95a4-b9552fa48dd8`
- Endpoint: `GET /api/v1/prescriptions/:id/document/preview`
- Storage operation: one bounded S3 `GetObject` for the owner request, plus one cancellation probe only if separately authorized
- Application data writes: none

The target is documented as fictional by the prior controlled V3 workflow. RC-2 must nevertheless re-establish that classification and owner lineage through safe metadata before requesting bytes. If either cannot be established, execution stops.

## Credential and account prerequisites

The checked-in RC-4 loader accepts credentials only from runtime environment variables and only when `MEDDECODE_HOSTED_E2E_APPROVED=true`. It requires HTTPS and project `wyripeqruhvbksjfsvlr`; URL-embedded credentials and a different project fail closed.

Required runtime-only inputs:

- `MEDDECODE_E2E_TARGET_ORIGIN`
- `MEDDECODE_E2E_PROJECT_ID`
- `MEDDECODE_E2E_EMAIL`
- `MEDDECODE_E2E_PASSWORD`

For the full denial matrix, a separately approved second synthetic account must be injected through a distinct secure runtime channel. No credential may appear in a command line, Playwright configuration file, report, trace, screenshot, Git file, or shell transcript.

Before execution, an administrator must confirm without returning personal fields that:

1. the primary synthetic account owns the exact prescription;
2. the prescription remains explicitly fictional;
3. the second synthetic account is different and does not own it;
4. both accounts are approved for this test;
5. historical credentials formerly embedded in the 11 privately preserved specifications have been rotated or disabled.

Historical credential rotation is currently **UNVERIFIED**. The privately preserved files must not be used as a credential source. If rotation cannot be confirmed, RC-2 must use newly issued ephemeral synthetic-account credentials and must not rely on any historical value.

## Application and storage contract under test

The route authenticates before preview lookup, derives the owner from the verified identity, and queries prescription metadata by both prescription ID and owner ID. A non-owned or missing prescription returns the same 404 boundary before storage access.

For an owned record, the service validates:

- `storage_provider` is `aws_s3`;
- `storage_bucket` equals the configured private bucket;
- the object key is non-empty;
- MIME type is PDF, JPEG, or PNG;
- stored size is positive and within the configured maximum.

Only then may it issue `GetObject`. It never lists the bucket. Response consumption is capped at 10 MiB by configuration, observes timeout/cancellation, and destroys or cancels the provider body on failure. The route returns `private, no-store`, `nosniff`, and inline disposition headers.

Safe diagnostic output is restricted to:

- generated request correlation ID;
- stage: `metadata_lookup`, `metadata_validation`, `storage_request`, or `storage_stream`;
- category: the service's allowlisted category;
- optional provider status class: `4xx` or `5xx`.

Object keys, bucket names, account identifiers, cookies, bearer tokens, raw AWS errors, document bytes, and prescription content must never be logged.

## Preflight

All checks are read-only and must pass before the owner request:

1. Verify the application origin is HTTPS and belongs to the approved localhost/hosted configuration under review.
2. Verify Supabase project identity is exactly `wyripeqruhvbksjfsvlr`.
3. Confirm no worker is started and no upload/processing endpoint will be called.
4. Confirm the target prescription ID and fictional-data classification.
5. Confirm the primary account owns the target and the secondary account does not, returning only booleans/counts.
6. Confirm preview maximum size and timeout are bounded.
7. Confirm Playwright tracing and video are disabled and screenshots occur only on a manually reviewed non-sensitive page, preferably disabled for this run.
8. Confirm backend logs use the sanitized preview logger.
9. Confirm historical credential rotation, or provision new ephemeral account credentials.

Any mismatch is a stop condition. Do not substitute a different prescription, owner, project, bucket, or object.

## Execution sequence

### Owner request

1. Sign in through the normal UI using the securely injected primary synthetic account.
2. Navigate to the exact prescription review/results page.
3. Request the preview through the application's authenticated API client.
4. Record only status, response headers, request correlation ID, MIME type, and byte count.
5. Require HTTP 200, an allowed MIME type, non-zero bytes within the configured cap, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`.
6. Consume bytes only in memory for the assertion and immediately release them. Do not save, screenshot, attach, or retain document contents.

### Denial matrix

1. Repeat the exact endpoint without authentication; require HTTP 401 and prove storage was not requested through safe application instrumentation.
2. Sign in as the separately approved non-owner synthetic account; require the existing indistinguishable 404/not-owned behavior and prove storage was not requested.
3. Do not infer cross-owner denial merely from an invalid token test.

### Cancellation

Only if included in the separate execution authorization, begin one owner request and abort it through the browser request controller. Require the application to dispose the S3 body and emit at most the sanitized `cancelled` category. This is not permission for a second full download.

## Failure classification

| Outcome | Classification | Next action |
| --- | --- | --- |
| Owner 200 with bounded allowed content | `PREVIEW_OK` | Close the hosted acceptance gap for this object only. |
| Route/service logic failure before storage | `APP_ERROR` | Prepare a local code correction; no hosted mutation. |
| Sanitized `access_denied` | `STORAGE_DENIED` | Prepare a separate IAM/KMS review; do not change policy. |
| Sanitized `object_not_found` | `OBJECT_MISSING` | Verify metadata/object lifecycle under separate authorization. |
| Metadata bucket/provider/type mismatch | `CONFIG_DRIFT` | Prepare configuration remediation; do not rewrite the record. |
| Owner session or safe diagnostics unavailable | `UNVERIFIED` | Stop without substituting credentials or direct S3 access. |

HTTP 503 alone is not a root cause. The correlation ID plus sanitized stage/category is required for classification.

## Evidence and cleanup

Retain only:

- UTC execution timestamp;
- target prescription ID;
- approved project ID;
- safe response status and headers;
- bounded byte count and MIME type;
- sanitized diagnostic fields if applicable;
- anonymous and cross-owner status results;
- confirmation that no storage or database mutation occurred.

Clear runtime credentials from the process environment, close the browser context, stop only task-owned local services, and verify no trace, storage-state, downloaded document, screenshot, or response body remains. Do not alter or delete the private legacy specifications during RC-2.

## Success criteria

RC-2 passes only when:

- the exact owner receives a bounded preview through the application;
- anonymous access receives 401;
- the approved non-owner cannot distinguish existence and does not reach S3;
- the response is non-cacheable and has an allowed content type;
- safe logs contain no identifiers beyond the correlation ID and allowlisted classification;
- cancellation cleanup passes if that probe was authorized;
- no hosted mutation, upload, worker action, object listing, or IAM/KMS change occurs;
- credentials and document bytes are absent from artifacts.

## Approval still required

A separate execution approval must name:

- the exact application origin;
- the exact primary and secondary synthetic accounts through a secure injection mechanism, without putting secrets in the approval text;
- the exact prescription ID above;
- whether the cancellation probe is authorized;
- permission for the narrowly scoped owner `GetObject` read;
- confirmation that historical credentials are rotated or that fresh ephemeral credentials will be used.

```text
RC_2_READINESS: READY_FOR_SEPARATE_AUTHORIZATION
TARGET_PRESCRIPTION: 2bb56f2d-df83-4132-95a4-b9552fa48dd8
HOSTED_TEST_GATE: FAIL_CLOSED
HISTORICAL_CREDENTIAL_ROTATION: UNVERIFIED
HOSTED_MUTATIONS: NONE
```
