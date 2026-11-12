# MedDecode backend

## Local execution

Use `backend/` as the working directory so package-relative paths and the
environment-loading convention remain correct. The development script watches
`src/server.ts`, the build writes to `dist/`, and the start script runs the
built `dist/server.js` entry point. Configuration names are documented in
`.env.example`; keep real credentials only in ignored local configuration.

## Authenticated profile API

The current profile surface uses the verified bearer identity and a
request-scoped Supabase client so database RLS independently enforces ownership.
It never accepts client-supplied ownership or system-managed fields.

- `GET /api/v1/users/me`
- `PATCH /api/v1/users/me` — accepts only `name` (`string` or `null`).
- `GET /api/v1/health-profile/me`
- `POST /api/v1/health-profile/me` — creates one profile and requires all
  editable fields explicitly.
- `PATCH /api/v1/health-profile/me` — updates only supplied editable fields.

The health-profile schema uses non-null booleans with `false` defaults for
several medical conditions. Because this cannot represent unknown separately
from confirmed negative, creation rejects omitted medical-history fields rather
than silently applying database defaults. Nullable values are limited to
`age`, `gender`, and `pregnancy`. Profile values must come from the authenticated
user's explicit request and never from prescription-extracted patient data.

## Controlled Supabase Auth smoke test

The authentication smoke-test harness verifies the local backend's public
health route, authenticated identity route, and two authenticated read-only
profile routes against one explicitly approved Supabase project. It never uses
the privileged client, creates or updates profile records, refreshes sessions,
signs out, or tests revocation.

Live execution is intentionally disabled unless every safety gate passes. The
offline automated tests use injected HTTP and authentication mocks and never
contact Supabase.

### Required environment variable names

Place real values only in an ignored `backend/.env.local` file:

```text
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
AUTH_SMOKE_APPROVED_SUPABASE_URL=
AUTH_SMOKE_BACKEND_ORIGIN=http://127.0.0.1:3000
AUTH_SMOKE_TEST_EMAIL=
```

`AUTH_SMOKE_APPROVED_SUPABASE_URL` must exactly match the origin in
`SUPABASE_URL`. The harness accepts only official HTTPS `*.supabase.co`
origins. The backend origin must resolve to `localhost`, `127.0.0.1`, or
`[::1]`. Do not add `SUPABASE_SECRET_KEY`; the smoke test neither needs nor
uses privileged access.

The repository ignores `.env` and `.env.*` except `.env.example`. Confirm the
local file before adding credentials:

```powershell
git check-ignore -v backend/.env.local
```

### Start the backend with `.env.local`

From `backend/` in PowerShell:

```powershell
$env:DOTENV_CONFIG_PATH = (Resolve-Path .env.local)
npm run dev
```

The same ignored file must be loaded in the separate shell used for the smoke
test. The backend and harness must use the same approved Supabase project.

### Execute later, only after separate approval

```powershell
$env:DOTENV_CONFIG_PATH = (Resolve-Path .env.local)
npm run smoke:auth -- --allow-live-auth
```

The harness prompts for the dedicated test-account password using a non-echoing
TTY input. It fails rather than falling back to visible input when a compatible
interactive terminal is unavailable. Never pass passwords, tokens, sessions,
keys, or project URLs as command-line arguments. Do not use verbose HTTP output,
PowerShell transcripts, screenshots, or screen sharing during execution.

The normal `signInWithPassword` operation creates an Auth session and may
update Supabase Auth session metadata and provider logs. The harness keeps the
resulting token only in process memory, disables automatic refresh and
persistence, and exits without logout or revocation. For that reason, live
execution requires separate approval and a dedicated non-patient test account.

The profile checks issue only these GET requests with the same in-memory bearer
token used for identity verification:

```text
GET /api/v1/users/me
GET /api/v1/health-profile/me
```

HTTP 200 passes only when the response contains the exact verified field set,
correct field types, and an owner ID matching the authenticated identity. HTTP
404 is also a contract PASS only when it carries the route's exact
`USER_PROFILE_NOT_FOUND` or `HEALTH_PROFILE_NOT_FOUND` code. Output reports only
the endpoint label, status, PASS/FAIL and `PROFILE_PRESENT` or
`PROFILE_NOT_FOUND`; it never prints profile values, email, tokens or provider
metadata. Any 401, 403, 500, malformed response, unexpected error code, extra
field or owner mismatch fails the run.

The same opt-in harness also performs a read-only prescription-history contract
check. It first confirms that missing and synthetic-invalid bearer tokens are
rejected, then uses the verified in-memory token for only these requests:

```text
GET /api/v1/prescriptions?limit=20&offset=0
GET /api/v1/prescriptions/{first_returned_id}   # only when the list is non-empty
GET /api/v1/prescriptions/not-a-uuid
GET /api/v1/prescriptions/{fresh_random_uuid}
```

The list must have the exact documented envelope, bounded pagination, known
file types and statuses, decimal-string file sizes, the public metadata
allowlist, and descending `created_at`/`id` ordering. An empty list is a PASS and
the existing-record detail check is reported as `SKIP NO_EXISTING_RECORD`; the
harness never creates a prescription to make the check pass. A populated list
causes the first record to be fetched in memory and validated against the same
allowlist without printing its ID or metadata. Invalid and unknown IDs must
return the exact documented 400 and 404 error codes.

The harness prints only safe check names, HTTP statuses, PASS/FAIL counts and an
empty/present reason. It never prints raw responses, record IDs, prescription
metadata, account identity, tokens or credentials. All application/profile and
history operations use GET. The Supabase password sign-in still creates an Auth
session and may update authentication metadata as described above. A successful
single-account run does not prove cross-user isolation; that requires a
separately approved second account and suitable owned records.

The opt-in harness also validates the read-only Medicine Cabinet contract:

```text
GET /api/v1/medicine-cabinet?limit=20&offset=0
GET /api/v1/medicine-cabinet/{first_returned_id} # only when non-empty
GET /api/v1/medicine-cabinet/not-a-uuid
GET /api/v1/medicine-cabinet/{fresh_random_uuid}
```

It verifies the exact public field allowlist, UUID identifiers, decimal-string
quantities, nullable dates and text, timestamps, pagination, and deterministic
`created_at DESC, id DESC` ordering. An empty cabinet is a PASS and the existing
record detail check is reported as `SKIP NO_EXISTING_RECORD`; the harness never
creates a cabinet entry. It also confirms missing and synthetic-invalid tokens
are rejected and requires the documented invalid/unknown-ID error codes.

Cabinet IDs, medicine identifiers, quantities, dates, usage information and raw
responses are never printed. These checks use one dedicated account and therefore
do not prove cross-user RLS isolation; that requires a separately approved second
account and controlled records. All cabinet application requests use GET.

## Controlled profile-write smoke test

`scripts/profile-write-smoke.ts` is a separate destructive harness for the
authenticated health-profile write contract. It refuses to run unless both
`--allow-live-auth` and `--allow-profile-write` are supplied, and retains the
approved-project, loopback-only backend, hidden-password, publishable-key and
in-memory-token controls described above.

The future approved run requires the application profile to exist and the
health profile to be absent. It creates one complete fixed synthetic profile,
verifies it, patches only `other_conditions`, verifies omitted fields stayed
unchanged, and confirms a second create receives the documented conflict. It
never sends `DELETE`, retries a write, uses an admin client, or attempts
automatic recovery.

The synthetic profile is intentionally retained because no delete API is
authorized. Success prints `SYNTHETIC_PROFILE_RETAINED`; failure after an
accepted create prints `SYNTHETIC_PROFILE_MAY_REMAIN`. This production-labeled
test-account mutation therefore requires separate approval before execution.

For a future explicitly approved manual run, start the backend as documented
above and run from `backend/` in a second interactive PowerShell:

```powershell
$env:DOTENV_CONFIG_PATH = (Resolve-Path .env.local)
npm run smoke:profile-write -- --allow-live-auth --allow-profile-write
```

Do not run this command during automated testing. Output is restricted to check
labels, HTTP status, safe failure categories and retention notices; it does not
print the account email, password, token, profile values or provider metadata.

## Prescription upload foundation

`POST /api/v1/prescriptions/upload` accepts exactly one authenticated
`multipart/form-data` file in the `file` field. JPEG, PNG and PDF are the only
accepted types. The declared content type must agree with signature detection,
and basic end markers reject practically detectable truncation. The default
limit is 10 MiB and can be lowered or raised (up to a 50 MiB hard ceiling) with
`PRESCRIPTION_MAX_FILE_SIZE_BYTES`. Multipart ingestion also has a 30-second
default duration limit, configurable up to five minutes with
`PRESCRIPTION_UPLOAD_TIMEOUT_MS`.

The initial implementation uses bounded in-memory ingestion. Chunk buffers are
retained until one final contiguous buffer is assembled, so peak memory can
approach twice the configured file limit plus parser, request and AWS SDK
overhead. At the 10 MiB default, deployment concurrency and request rate limits
must therefore be sized for materially more than 10 MiB per active upload.
Moving to quarantined streaming storage should be considered before raising the
limit or operating at high concurrency. The local duration limit is not a
replacement for reverse-proxy request, connection, rate and concurrency limits.

Signature validation does not establish that a document is non-malicious.
Malware scanning and quarantine promotion remain deployment controls that are
not implemented in this foundation.

Accepted files are stored through an injectable AWS SDK v3 adapter under a
server-generated key:

```text
private/prescriptions/{prescription_uuid}/source.{verified_extension}
```

The adapter uses the AWS default credential provider chain, does not set a
public ACL, and requests S3-managed AES-256 encryption. Prefer a workload IAM
role in deployment. Environment access keys, when used for local development,
must remain in ignored credential storage and must never be committed.

Storage occurs before the ownership-scoped Supabase insert because the current
schema has no `uploading` state and requires `object_key`. A failed database
insert that returns a narrowly recognized definite rejection triggers one
compensating `DeleteObject`. This is not a distributed transaction: ambiguous
network failures or failed cleanup can leave an orphaned private object. A
provider error is considered a definite rejection only for a
narrow set of returned PostgreSQL constraint or permission codes. After an
ambiguous insert result, the backend performs one owner-scoped read using the
server-generated prescription ID. A fully matching record is accepted as a
committed insert. Missing, mismatching or unreadable reconciliation results
preserve the S3 object and return a safe reconciliation-required error; they do
not trigger destructive cleanup. This conservative policy can leave an orphaned
object, while delayed visibility or external interference can still produce a
row/object inconsistency. No blind retry or exactly-once guarantee is provided,
and a future least-privilege reconciliation process is still required.

Once S3 storage begins, a later client disconnect does not cancel the durable
workflow: the backend continues database registration or conservative
reconciliation to avoid abandoning a known stored object. The disconnected
client may not receive the result, and the current schema provides no durable
idempotency key for a safe automatic retry.

The upload endpoint does not create `ai_jobs`, call Member 1, generate a
presigned URL, extract patient data, or produce intelligence output. A future
processing phase must allocate `job_id` separately and provide Member 1 a
short-lived authorized document reference only after that integration is ready.

## Read-only prescription history API

Both history endpoints require a verified Bearer token and use the request's
JWT-scoped Supabase client. Queries include an explicit `user_id` filter while
RLS independently enforces `user_id = auth.uid()`.

### List history

```text
GET /api/v1/prescriptions?limit=20&offset=0
```

- `limit` defaults to `20` and must be from `1` through `50`.
- `offset` defaults to `0` and is capped at `1000000`.
- Duplicate, negative, malformed and unexpected query parameters are rejected.
- Results are ordered by `created_at DESC`, then `id DESC`.
- One lookahead row is requested to calculate `has_more`; it is not returned.

Example response:

```json
{
  "items": [
    {
      "id": "10000000-0000-4000-8000-000000000001",
      "file_type": "application/pdf",
      "file_size_bytes": "123456",
      "status": "uploaded",
      "prescription_date": null,
      "created_at": "2026-11-11T10:00:00.000Z",
      "updated_at": "2026-11-11T10:00:00.000Z",
      "processed_at": null
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "returned": 1,
    "has_more": false,
    "next_offset": null
  }
}
```

PostgreSQL `bigint` file sizes are returned as decimal strings, or `null`, so
JavaScript clients do not silently lose integer precision. Offset pagination is
bounded but can shift or repeat records when concurrent inserts occur. A future
cursor contract would be preferable for high-volume history.

### Read one history record

```text
GET /api/v1/prescriptions/{prescription_uuid}
```

Success uses the same allowlisted item shape:

```json
{
  "prescription": {
    "id": "10000000-0000-4000-8000-000000000001",
    "file_type": "application/pdf",
    "file_size_bytes": "123456",
    "status": "uploaded",
    "prescription_date": null,
    "created_at": "2026-11-11T10:00:00.000Z",
    "updated_at": "2026-11-11T10:00:00.000Z",
    "processed_at": null
  }
}
```

An invalid UUID returns `400 INVALID_PRESCRIPTION_ID`. A missing or non-owned
record returns the same `404 PRESCRIPTION_NOT_FOUND` response, so the endpoint
does not reveal another user's records.

The history projection excludes bucket names, object keys, original filenames,
raw OCR, extracted patient/doctor/facility identifiers, storage URLs and
intelligence output. It never reads S3, creates an AI job or calls Member 1.
`uploaded` means only that document storage and registration completed; it does
not claim OCR, medicine matching or intelligence processing completed.

## Read-only medicine cabinet API

Both cabinet endpoints require a verified Bearer token. They use the request's
JWT-scoped Supabase client, apply an explicit `user_id` filter, and retain RLS as
independent owner enforcement. They do not join or modify Member 1's
`public.medicines` table.

### List cabinet entries

```text
GET /api/v1/medicine-cabinet?limit=20&offset=0
```

- `limit` defaults to `20` and must be from `1` through `50`.
- `offset` defaults to `0` and is capped at `1000000`.
- Duplicate, negative, malformed and unexpected parameters are rejected.
- Results are ordered by `created_at DESC`, then `id DESC`.
- An empty cabinet returns HTTP 200 with `items: []`.

```json
{
  "items": [
    {
      "id": "30000000-0000-4000-8000-000000000001",
      "medicine_id": "40000000-0000-4000-8000-000000000001",
      "quantity": "1.5000",
      "purchase_date": null,
      "expiry_date": "2027-01-01",
      "refill_date": null,
      "usage_information": null,
      "created_at": "2026-11-11T10:00:00.000Z",
      "updated_at": "2026-11-11T10:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "returned": 1,
    "has_more": false,
    "next_offset": null
  }
}
```

PostgreSQL `numeric` quantities are returned as validated decimal strings, or
`null`, so fractional and large values are not silently rounded by JavaScript.
Safe non-negative integer numbers are accepted from the provider; fractional or
unsafe numeric JS values fail closed because their original database precision
cannot be proven. Offset pagination is bounded but may drift during concurrent
changes; a cursor should be considered if cabinet volume grows.

### Read one cabinet entry

```text
GET /api/v1/medicine-cabinet/{entry_uuid}
```

Success returns `{ "entry": { ... } }` using the same public item shape. An
invalid UUID returns `400 INVALID_MEDICINE_CABINET_ENTRY_ID`. Missing and
non-owned entries both return `404 MEDICINE_CABINET_ENTRY_NOT_FOUND`.

`family_member_id` is intentionally omitted until family-member ownership and
privacy rules are independently verified. `medicine_id` is the internal foreign
key to Member 1-owned `public.medicines(id)`; it must not be treated as Contract
v1.0 `medicine_external_id`. The API does not join medicine data, call Member 1,
or claim that OCR, matching or intelligence processing is operational.

## Authenticated family-member API

All family-member endpoints require a verified Bearer token and use the
request-scoped publishable-key Supabase client. Repository operations explicitly
filter by the verified `user_id`; RLS independently enforces the same ownership.
Responses omit `user_id` and provider diagnostics.

### List and read

```text
GET /api/v1/family-members?limit=20&offset=0
GET /api/v1/family-members/{family_member_uuid}
```

`limit` defaults to 20 and accepts 1–50. `offset` defaults to 0 and is capped at
1,000,000. Results use one lookahead row and stable `created_at DESC, id DESC`
ordering. An invalid UUID returns `400 INVALID_FAMILY_MEMBER_ID`; missing and
non-owned records both return `404 FAMILY_MEMBER_NOT_FOUND`.

### Create

```http
POST /api/v1/family-members
Content-Type: application/json

{
  "name": "Synthetic Test Member",
  "relationship": "parent"
}
```

`name` is required, trimmed and limited to 100 characters. `relationship` is a
trimmed non-empty string up to 100 characters or `null`; omission stores `null`.
Successful creation returns HTTP 201 with `{ "member": { ... } }`. Ownership and
system fields are server-controlled. A missing application-user parent returns
`409 APPLICATION_PROFILE_REQUIRED`.

The repository constructs an exact insert payload containing only the verified
`user_id`, validated `name`, and validated `relationship`. It does not spread a
caller-controlled object into the database mutation. Returned records are
validated for owner, UUID, normalized text lengths, relationship nullability,
and timestamp syntax before serialization. A malformed provider record fails
with a generic `500` response and is never silently rewritten or exposed.

### Update

```http
PATCH /api/v1/family-members/{family_member_uuid}
Content-Type: application/json

{ "relationship": null }
```

Only `name` and `relationship` are editable. Patches must be non-empty; omitted
fields remain unchanged. `name` cannot be null or empty.

PATCH is currently last-write-wins. There is no ETag, row version, or
`updated_at` precondition, and the backend does not automatically retry a
failed PATCH. A transport failure after a request reaches PostgreSQL can leave
the mutation outcome unknown; the API returns a safe error rather than claiming
success or attempting an unsafe compensating write. The same ambiguity applies
to POST and DELETE, so callers must not blindly retry mutations.

### Delete

```text
DELETE /api/v1/family-members/{family_member_uuid}
```

Successful deletion returns HTTP 204 with no body. The application does not
delete or update medicine-cabinet rows. The verified database foreign key uses
`ON DELETE SET NULL`, so PostgreSQL clears existing cabinet references to the
deleted family member.

The current foreign key does not itself prove that a referenced family member
and cabinet row have the same owner. Family assignment is therefore not
implemented here and requires explicit dual-ownership validation in a future
phase. Owner-scoped DELETE filters cannot prevent PostgreSQL's internal
`ON DELETE SET NULL` action from affecting a cross-owned cabinet row if an
invalid association already exists. No such association is claimed to exist,
but live Family Members DELETE remains on hold pending a read-only data audit
and an approved database-level ownership design.

A future separately reviewed design should consider a unique owner-qualified
key on `family_members(id, user_id)` and a composite foreign key from
`medicine_cabinet(family_member_id, user_id)`. No constraint, trigger, RLS
policy, schema, or live data was changed by this implementation phase.

These APIs and hardening checks have only mocked offline verification: no live
family-member read, insert, update, delete, RLS, concurrent-mutation, or foreign
key action test was performed. They do not access Member 1 medicine data, call
OCR/NER/matching, or use prescription-extracted patient information.

## Offline Contract v1 transport proof

Phase 5.2 includes an isolated `IntelligenceClient` implementation that sends a
single Contract v1 JSON request to the fixed Python module
`app.integration.synthetic_worker`. It is test infrastructure only: it is not
registered in Express, the prescription-upload flow, persistence, or startup.

The adapter accepts HTTPS `authorized_url` references but the worker never
dereferences them. `direct_upload` is rejected because Contract v1 does not
define its binary transport. The subprocess has bounded stdout/stderr, a timeout,
fixed non-shell arguments, safe transport errors and response-correlation checks.
On Windows, termination of the direct child is requested on timeout or output
overflow; termination of an arbitrary descendant process tree is not claimed.
