# Member 1 / Member 2 Contract Compliance Register

## 1. Document control and authority

| Item | Value |
| --- | --- |
| Project | MedDecode — Intelligence Behind Every Prescription |
| Contract | `MedDecode_Member1_Member2_Input_Output_Data_Contract_v1.pdf` |
| Contract version | 1.0 |
| Contract date | 6 September 2026 |
| Register scope | Member 2 backend integration planning and future verification |
| Register status | Upload foundation implemented and offline-tested; Member 1 integration is not implemented |

This register is based exclusively on the 27 contract rules supplied by the
project owner. The named PDF was reported as available in the ChatGPT project
context, but no local PDF was inspected during this task. Any detail not stated
in those rules is marked **NEEDS_SOURCE_VERIFICATION** rather than inferred.

### Status legend

- **IMPLEMENTED** — current backend code provides concrete evidence.
- **TESTED** — an automated offline test directly verifies the stated behavior.
- **PENDING** — required by the supplied rules but not implemented in this backend.
- **NEEDS_SOURCE_VERIFICATION** — the supplied rules do not define enough detail
  to design or test the behavior safely.
- **OUT_OF_SCOPE** — owned by Member 1; Member 2 must preserve the result rather
  than reproduce the intelligence behavior.

An item can be implemented without being tested, or tested only in an adjacent
context. The compliance matrix keeps these facts separate.

## 2. Responsibility boundaries

| Member 2 owns | Member 1 owns |
| --- | --- |
| Upload handling | OCR |
| Authentication and authorization | Prescription extraction |
| AWS S3 access | Medicine matching |
| Generation and ownership of `prescription_id` and `job_id` | Ingredient intelligence |
| Job creation, lifecycle and correlation | Derived analytics |
| Application persistence and history | Recommendations |
| Frontend-facing APIs | Alternatives |
| Validation and persistence of intelligence responses against existing database constraints | Warnings |

Member 2 must not silently reimplement, reinterpret or fabricate Member 1
intelligence. Member 1 must receive Member 2-owned identifiers and echo them in
its response so Member 2 can correlate the result with the originating job and
prescription.

## 3. Member 2 request checklist

| Requirement | Contract rule | Implementation | Test coverage | Notes |
| --- | ---: | --- | --- | --- |
| `schema_version` equals the string `"1.0"` | 3 | PENDING | PENDING | A breaking required-field change requires a new schema version. |
| Top-level `job_id` is present | 4 | PENDING | PENDING | Member 2 owns the identifier. Exact format is NEEDS_SOURCE_VERIFICATION. |
| Top-level `prescription_id` is present | 4 | PENDING | PENDING | Member 2 owns the identifier. Exact format is NEEDS_SOURCE_VERIFICATION. |
| Top-level `document` is present | 4 | PENDING | PENDING | Full object shape beyond the listed fields is NEEDS_SOURCE_VERIFICATION. |
| Top-level `requested_analysis` is present | 4 | PENDING | PENDING | Exact boolean requiredness/defaults are NEEDS_SOURCE_VERIFICATION. |
| `document.access_type` is `authorized_url` or `direct_upload` | 5 | PENDING | PENDING | Direct-upload payload representation is NEEDS_SOURCE_VERIFICATION. |
| `file_url` is present for `authorized_url` | 6 | PENDING | PENDING | URL lifetime, signing, audience and transport requirements are NEEDS_SOURCE_VERIFICATION. |
| `file_type` is `image/jpeg`, `image/png` or `application/pdf` | 7 | IMPLEMENTED for authenticated upload ingestion; PENDING for the future Member 1 request | TESTED offline for upload ingestion | The upload route verifies declared type, detected signature, basic completeness and a bounded byte count. This does not yet construct a Member 1 request. |
| `requested_analysis.extract_prescription` is represented | 8 | PENDING | PENDING | Treat as a boolean when implemented; defaults are not supplied. |
| `requested_analysis.match_medicines` is represented | 8 | PENDING | PENDING | Treat as a boolean when implemented; defaults are not supplied. |
| `requested_analysis.find_alternatives` is represented | 8 | PENDING | PENDING | Treat as a boolean when implemented; defaults are not supplied. |
| `requested_analysis.generate_recommendations` is represented | 8 | PENDING | PENDING | Treat as a boolean when implemented; defaults are not supplied. |

No current file constructs this contract request. The presence of
`INTELLIGENCE_SERVICE_URL` in `backend/.env.example` is configuration scaffolding,
not an implemented integration.

## 4. Member 1 response checklist

### 4.1 Envelope, status and error rules

| Requirement | Accepted contract value or shape | Implementation | Test coverage |
| --- | --- | --- | --- |
| Echoed identifiers | Original `job_id` and `prescription_id` | PENDING | PENDING |
| Processing status | `completed`, `completed_with_warnings`, or `failed` | PENDING | PENDING |
| Successful response fields | `prescription`, `patient`, `medicines`, `recommendations`, `warnings`, `processing_metadata` | PENDING | PENDING |
| Failed response error | Structured `code`, `message`, and `retryable` | PENDING | PENDING |
| Processing versions | `dataset_version` and `model_version` when available | PENDING | PENDING |

The exact error-code catalogue, whether a failed response may contain partial
results, and the complete nested field definitions are
**NEEDS_SOURCE_VERIFICATION**.

### 4.2 Missing, nullable and collection rules

1. Missing optional scalar information must be represented as `null`.
2. Empty collections must be represented as `[]`.
3. Missing prescription or medicine details must never be fabricated.
4. Member 2 must preserve these distinctions during validation and persistence.
5. Unknown additional optional response fields must be tolerated. A future
   validator should reject invalid required fields while allowing unknown
   optional fields; whether those unknown fields are ignored or preserved in a
   raw payload is **NEEDS_SOURCE_VERIFICATION**.

The current profile tests verify null and empty-array preservation only for the
separate health-profile read API (`backend/tests/profiles.test.ts`, test
`returns an existing health profile with nulls and arrays preserved`). That is
useful adjacent evidence, but it does **not** test the Member 1 response contract.

## 5. Medicine result rules

| Requirement | Member 2 acceptance rule | Ownership/status |
| --- | --- | --- |
| `sequence_number` | Must be a positive number for every medicine and support multiple medicines without duplicates or reordering ambiguity | PENDING |
| Medicine sections | Every medicine contains `extraction`, `confidence`, `medicine_match`, `derived`, and `alternatives` | PENDING |
| Match status | Exactly `matched`, `probable_match`, `ambiguous`, `unmatched`, or `not_attempted` | PENDING |
| Confidence | Number in inclusive range `[0,1]`, or `null` | PENDING |
| `medicine_external_id` | Stable identifier owned by Member 1; Member 2 must not generate or rewrite it | OUT_OF_SCOPE for generation; PENDING for validation/persistence |
| SOS/as-needed dosage | Must not be invented | OUT_OF_SCOPE for calculation; PENDING for contract verification |
| Alternatives | Must meet Member 1 compatibility criteria | OUT_OF_SCOPE for selection; criteria NEEDS_SOURCE_VERIFICATION; PENDING for preservation |
| Warnings | Preserve Member 1 severity and meaning without downgrading or reinterpretation | OUT_OF_SCOPE for generation; PENDING for preservation |

The exact confidence property names within the nested objects, alternative
compatibility criteria, warning severity vocabulary and derived-field schema
are **NEEDS_SOURCE_VERIFICATION**.

## 6. Identifier ownership, correlation and idempotency

- Member 2 creates and owns `job_id` and `prescription_id`.
- The outbound request carries both identifiers.
- The inbound response must echo both identifiers.
- Member 2 must compare both echoed values with the persisted originating
  record before accepting or persisting a response.
- A mismatched identifier must fail closed and must not update another job or
  prescription.
- `medicine_external_id` is Member 1-owned and must remain stable.
- Duplicate delivery and idempotency behavior are not defined by the supplied
  rules. The duplicate-response policy, terminal-state transition rules and
  idempotency key strategy are **NEEDS_SOURCE_VERIFICATION** before integration.

No job or prescription correlation implementation exists in the current
backend, so all of these controls are **PENDING**.

## 7. Security and patient-data separation

### Mandatory separation rule

Extracted `patient` data belongs to an intelligence result for a prescription.
It must never be treated as an authenticated user's asserted profile and must
never overwrite `public.users` or `public.health_profiles`.

### Current profile API finding

The Step 7B profile APIs and Step 7C profile-write APIs satisfy this rule
structurally:

- `backend/src/routes/profile.routes.ts` keeps profile writes on explicit
  authenticated `/me` endpoints. It accepts only user-entered profile fields;
  it has no prescription or intelligence-result input.
- `backend/src/repositories/profile.repository.ts` exposes only
  profile-specific reads/writes scoped to the verified authenticated user ID.
  It does not accept extracted-patient objects or Member 1 result types.
- Client-supplied `id`, `user_id`, email and timestamps are rejected. Health
  profile ownership is always assigned from the verified identity.
- `backend/tests/profiles.test.ts`, test `ignores client-supplied IDs and filters
  by verified identity`, confirms the authenticated identity controls the read.
- `backend/tests/profile.repository.test.ts`, tests `queries only the allowed
  application-user fields for the verified ID` and `queries all 15 allowed
  health fields for the verified user ID`, confirm the two read queries and
  their ownership filters.

Therefore, the profile APIs **never derive authenticated profile updates from
prescription-extracted patient data**. Their write inputs come only from the
authenticated profile endpoints and are strictly allowlisted. This separation
is **IMPLEMENTED and TESTED for the present profile surface**. A future
integration-specific test must still ensure that an intelligence persistence
adapter cannot call these profile-write paths or target these tables.

### Medical-history representation limitation

The verified database schema stores six condition fields as non-null booleans
with `false` defaults. It cannot distinguish an unknown/uncollected answer from
a confirmed negative value after storage. To avoid silently converting omitted
answers into `false`, `POST /api/v1/health-profile/me` requires every editable
health field to be supplied explicitly. Nullable `age`, `gender`, and
`pregnancy` can use `null`; the condition booleans cannot. PATCH leaves omitted
fields unchanged. This mitigation does not remove the underlying schema
limitation, and this document does not authorize a schema change.

Other required security controls for the future integration include:

- authorize uploads and S3 access without leaking reusable URLs;
- authenticate frontend-facing routes independently of service-to-service
  authorization;
- never log document URLs, prescription contents, extracted patient values or
  complete intelligence payloads;
- validate the response before persistence;
- use least-privilege service credentials and explicit table allowlists;
- preserve warnings and failures without exposing internal Member 1 details to
  unauthorized callers.

Service authentication, URL expiry and retry/log-redaction details are
**NEEDS_SOURCE_VERIFICATION**.

## 8. Backward compatibility

1. Required fields and their meanings are fixed for schema version `1.0`.
2. A breaking change to required fields requires a new schema version.
3. Member 2 should tolerate unknown additional optional output fields.
4. Required identifiers, status values and required nested sections must still
   be validated strictly.
5. Member 2 must not silently coerce a newer breaking response into version
   `1.0`.
6. Version negotiation and supported-version rejection behavior are
   **NEEDS_SOURCE_VERIFICATION**.

No compatibility parser or runtime schema exists today; implementation and
tests are **PENDING**.

## 9. Verified database mapping

| Database object | Verification basis | Contract mapping decision |
| --- | --- | --- |
| `public.users` | Current repository operations in `backend/src/repositories/profile.repository.ts`; profile tests | Authenticated user-managed profile read/update only. **Must not** receive extracted `patient` data. |
| `public.health_profiles` | Current repository operations in `backend/src/repositories/profile.repository.ts`; profile tests | Authenticated user-managed health-profile read/create/update only. **Must not** receive extracted `patient` data. |
| `public.family_members` | Owner-supplied verified catalog contract plus `backend/src/repositories/family-member.repository.ts` and offline tests | Authenticated owner-scoped CRUD uses explicit mutation allowlists, verified `user_id` filters, JWT-scoped RLS, and strict returned-row validation. Values come only from explicit authenticated requests, never extracted prescription data. No medicine or Member 1 table is accessed. Offline mocks do not prove live RLS, ambiguous mutation outcomes, concurrent-update behavior, or foreign-key actions. Live DELETE is blocked because `medicine_cabinet.family_member_id -> family_members.id ON DELETE SET NULL` does not enforce matching owners; no cross-owner data is claimed to exist. A future composite owner-qualified constraint requires separate review and approval. |
| `public.prescriptions` | Owner-supplied verified catalog contract plus `backend/src/repositories/prescription.repository.ts` and offline tests | Authenticated user-scoped insert of storage fields only; status is `uploaded`; no patient or intelligence fields are written. Live RLS behavior is not claimed by mocks. |
| `public.medicine_cabinet` | Owner-supplied verified catalog contract plus `backend/src/repositories/medicine-cabinet.repository.ts` and offline tests | Authenticated read-only owner-scoped list/detail of cabinet fields. The internal `medicine_id` FK is exposed without joining or changing Member 1 medicine data and is not treated as `medicine_external_id`; `family_member_id` remains private pending ownership review. Live RLS behavior is not claimed by mocks. |
| Job records | No schema or repository evidence in this checkout | NEEDS_SOURCE_VERIFICATION |
| Intelligence result, medicine, recommendation, warning and processing metadata records | No schema or repository evidence in this checkout | NEEDS_SOURCE_VERIFICATION |

The project owner states that the live Supabase database has existing Member 1
and Member 2 tables, but this task did not connect to it or inspect migrations.
Table names, columns, constraints and relationships not evidenced above must
not be guessed. Before persistence work, obtain read-only, catalog-derived
schema evidence for the relevant existing tables and map every contract field
to an existing constrained destination or an explicitly approved raw payload.
No migration is authorized by this register.

## 10. Rule-by-rule compliance matrix

| Rule | Requirement summary | Code status | Test status | Evidence / gap |
| ---: | --- | --- | --- | --- |
| 1 | Member 2 responsibility boundary | IMPLEMENTED for upload, read-only prescription history and read-only medicine cabinet; PENDING for remaining integration | TESTED offline for upload, history and cabinet | No job, processing worker or intelligence-facing service call is implemented. Cabinet reads do not join or modify Member 1 medicine data. |
| 2 | Member 1 intelligence boundary | OUT_OF_SCOPE / preserved in plan | PENDING | No Member 1 logic is reimplemented. No integration exists. |
| 3 | Input schema version `1.0` | PENDING | PENDING | No request DTO or validator. |
| 4 | Required input envelope fields | PENDING | PENDING | No request DTO or validator. |
| 5 | Allowed document access types | PENDING | PENDING | Direct-upload shape NEEDS_SOURCE_VERIFICATION. |
| 6 | Authorized URL requires `file_url` | PENDING | PENDING | No document validator. |
| 7 | Allowed MIME types | IMPLEMENTED for upload ingestion; PENDING for intelligence request construction | TESTED offline for JPEG, PNG, PDF, mismatches and unsupported content | Upload validation does not imply Member 1 transport readiness. |
| 8 | Requested-analysis flags | PENDING | PENDING | Defaults/requiredness NEEDS_SOURCE_VERIFICATION. |
| 9 | Echo IDs in output | PENDING | PENDING | No response adapter/correlation service. |
| 10 | Output status enum | PENDING | PENDING | No response validator. |
| 11 | Successful output sections | PENDING | PENDING | Nested schemas NEEDS_SOURCE_VERIFICATION. |
| 12 | Structured failed output | PENDING | PENDING | Error-code catalogue NEEDS_SOURCE_VERIFICATION. |
| 13 | Medicine sequence and sections | PENDING | PENDING | No medicine result schema. |
| 14 | Match-status enum | PENDING | PENDING | No medicine result schema. |
| 15 | Confidence range or null | PENDING | PENDING | Exact confidence fields NEEDS_SOURCE_VERIFICATION. |
| 16 | Null scalars and empty arrays | PENDING | PENDING | Adjacent profile test exists, but no intelligence-contract test. |
| 17 | No fabrication | OUT_OF_SCOPE for generation; PENDING for acceptance safeguards | PENDING | No adapter exists. |
| 18 | Stable Member 1 medicine ID | OUT_OF_SCOPE for generation; PENDING for persistence | PENDING | No mapping exists. |
| 19 | No invented SOS calculations | OUT_OF_SCOPE for generation; PENDING for preservation | PENDING | Exact extraction shape NEEDS_SOURCE_VERIFICATION. |
| 20 | Alternative compatibility | OUT_OF_SCOPE for selection; PENDING for preservation | PENDING | Compatibility criteria NEEDS_SOURCE_VERIFICATION. |
| 21 | Warning severity/meaning preserved | OUT_OF_SCOPE for generation; PENDING for preservation | PENDING | Severity vocabulary NEEDS_SOURCE_VERIFICATION. |
| 22 | Do not overwrite authenticated profiles from extracted patient data | IMPLEMENTED through strict profile-route separation and allowlists | TESTED for the current profile surface | `profile.routes.ts`, `profile.repository.ts`, `profiles.test.ts`, `profile-writes.test.ts`, `profile.repository.test.ts`; future intelligence-adapter isolation test still required. |
| 23 | Tolerate unknown optional fields | PENDING | PENDING | Ignore-versus-raw-preserve policy NEEDS_SOURCE_VERIFICATION. |
| 24 | New version for breaking changes | PENDING | PENDING | No compatibility layer. |
| 25 | Correlate original IDs | PARTIAL | TESTED offline for upload-owned `prescription_id`; PENDING for jobs and Member 1 responses | The upload route allocates and persists the server-owned prescription ID. No job or intelligence-response correlation exists. |
| 26 | Dataset/model versions when available | PENDING | PENDING | Persistence destination NEEDS_SOURCE_VERIFICATION. |
| 27 | Validate and persist within DB constraints | PARTIAL | TESTED offline for the verified prescription-upload mapping; PENDING for live RLS and intelligence results | The upload repository uses an explicit prescription allowlist, verifies all returned storage fields and conservatively reconciles ambiguous insert outcomes. No live database assertion or intelligence-result persistence is claimed. |

## 11. Future contract-test requirements

All tests should be offline fixtures/mocks first. Live service or database tests
require a separate explicit approval and credential-safe plan.

### Request validation

- accepts a complete valid version `1.0` request;
- rejects missing or altered `schema_version`;
- rejects missing/empty `job_id` and `prescription_id`;
- rejects a missing `document` or `requested_analysis`;
- accepts only the two access types;
- requires `file_url` for `authorized_url`;
- accepts only the three supported MIME types;
- validates each requested-analysis flag once its requiredness is verified;
- confirms request construction never includes unrelated profile or patient data.

### Response and failure validation

- accepts each processing status and rejects unknown statuses;
- requires echoed IDs and rejects either ID mismatch;
- validates all required successful-response sections;
- validates failed response `code`, `message` and boolean `retryable`;
- verifies missing optional scalar values are `null`;
- verifies absent collections are represented as `[]`;
- rejects fabricated default prescription/medicine details;
- accepts absent `dataset_version`/`model_version` only when contract-optional;
- accepts valid unknown optional fields without weakening required-field checks.

### Medicine scenarios

- validates one and multiple medicine results with positive, unique sequence
  numbers;
- rejects zero, negative, missing or invalid sequence numbers;
- covers all five match statuses;
- covers confidence at `0`, `1`, values between them and `null`;
- rejects confidence below `0`, above `1`, NaN or non-numeric values;
- covers unmatched and ambiguous medicines without fabricated matches;
- verifies a stable `medicine_external_id` is persisted unchanged;
- verifies alternatives are passed through unchanged and satisfy the verified
  Member 1 compatibility contract;
- verifies warnings retain their original severity and meaning;
- verifies recommendations and warnings preserve empty arrays;
- verifies SOS/as-needed data is never converted into invented dosage math.

### Correlation, idempotency and persistence

- accepts only responses whose `job_id` and `prescription_id` match the
  originating persisted records;
- rejects cross-job or cross-prescription responses;
- tests duplicate and replayed responses after the idempotency policy is
  source-verified;
- prevents a completed terminal result from being corrupted by a late duplicate;
- persists successful, warning and failed states within verified database
  constraints;
- rolls back or fails closed when a required persistence operation fails;
- proves extracted `patient` data cannot update `public.users` or
  `public.health_profiles`;
- proves persistence uses an explicit allowlist of verified result tables;
- verifies unknown optional fields follow the approved ignore/raw-preservation
  policy;
- verifies no sensitive values, signed URLs or full payloads enter logs or API
  error responses.

## 12. Known mismatches, gaps and next actions

### Current gaps

1. No production Member 1 service client or service-authentication mechanism exists.
2. Phase 5.2 adds versioned TypeScript types, runtime validators, normative JSON
   Schema artifacts and an offline-only local subprocess client. It is not wired
   to an HTTP route, upload flow, persistence layer or production service.
3. The Phase 5.2 synthetic adapter supports only a non-dereferenced
   `authorized_url`; the contract's `direct_upload` binary representation remains
   unspecified and is rejected rather than invented.
4. Phase 5.2 validates both correlation identifiers and complete success/failure
   envelopes, but no production job state machine exists.
5. Prescription upload plus read-only owner-scoped history and medicine-cabinet repositories exist, but no job or intelligence-result repository is present.
6. Private AWS S3 upload, deterministic multipart termination, conservative ambiguous-insert reconciliation and definite-rejection compensation are offline-tested. No live bucket verification, malware scanning, reconciliation worker or authorized-URL implementation is present.
7. No verified mapping exists for result persistence into the existing Supabase
   application schema.
8. Contract-specific TypeScript, Python and real local cross-language tests now
   cover the synthetic adapter. They do not prove live document access, OCR,
   persistence, RLS, S3, retry or production process supervision.
9. Direct-upload representation, production retry/idempotency policy, authorized
   URL issuance, result persistence and version negotiation remain unresolved.

These are implementation gaps, not permission to modify the database or invent
contract details.

### Recommended next actions

1. Keep the authoritative Contract v1.0 PDF and its reviewed schema artifacts
   together in the eventual documentation checkpoint; do not silently stage the
   PDF during implementation review.
2. Obtain read-only catalog evidence for the existing job, prescription and
   intelligence-result tables and constraints; do not execute migrations.
3. Resolve every **NEEDS_SOURCE_VERIFICATION** item with Member 1 and record the
   decision/version.
4. Review the Phase 5.2 transport types and validators independently before any
   production wiring; keep them decoupled from database row types.
5. Extend negative fixtures only from verified Contract v1 requirements; do not
   convert examples or ambiguities into mandatory fields.
6. In a separately authorized phase, design the production orchestration and
   persistence allowlists. The synthetic adapter cannot write any data.
7. Only after offline verification, prepare a separately approved, credential-
   safe integration test against an approved non-patient test environment.

This register introduces no runtime behavior and authorizes no live service,
database, migration or authentication operation.
