# MedDecode Codex Phase 2.4A: Restricted Catalogue Connection and E2E Verification

Date: 2026-11-15

## Outcome

The Phase 2.3 PDF/JPEG/PNG failures were diagnosed without altering hosted
state, roles, grants, credentials, TLS settings, or OCR behavior. The current
Codex execution identity is denied at the direct IPv6 socket layer before a
PostgreSQL/TLS handshake. Independent normal-Windows-PowerShell verification
subsequently confirmed that the host itself has global IPv6, a default route,
and successful TCP/5432 access. The failure is therefore classified as a Codex
execution-environment restriction, not a host-routing or database defect. The
local code already had the correct restricted configuration and child
environment propagation; the safe implementation change is a classified local
diagnostic path, not a database workaround.

No hosted worker, prescription, catalogue record, database schema, grant, RLS
policy, AWS setting, cloud OCR service, TrOCR provider implementation, Contract
v1 field, commit, or push was changed.

## Workspace preservation

- Checkout: `C:\Users\dahiy\MedDecode-integration`
- Branch: `integration/full-project`
- The worktree was already substantially modified/untracked by concurrent
  work. Existing files were preserved; no reset, revert, clean, stash, commit,
  or push occurred.
- `hybrid_ocr.py` was not edited. Its Phase 2.3 SHA-256 remains
  `0f1db132f1c0dd5fe73db45af4a16b535dc571fdb7f9712951d5d6f7cabe3cd6`.

## Root cause and evidence

The configured path is correct and loaded in both the parent and supervised
child:

| Setting | Verified non-secret state |
| --- | --- |
| host | `db.wyripeqruhvbksjfsvlr.supabase.co` |
| port/database | `5432` / `postgres` |
| role | `meddecode_catalogue_python_reader` |
| TLS mode | `verify-full` |
| CA path | exists |
| password source | configured but never displayed |
| child propagation | all `MEDDECODE_CATALOGUE_*` keys inherited by the supervised child |

DNS resolved the direct host to an AAAA record:
`2406:da18:1f5e:4100:ef84:d963:f176:bf94`. In this execution environment:

- the Codex process cannot open the outbound IPv6 socket;
- a direct Python `AF_INET6` socket connect raised `PermissionError`, errno
  `13`;
- psycopg raised `OperationalError` without an SQLSTATE;
- the sanitized local diagnostic classified this as `TCP_ACCESS_DENIED`.

This happens before the TLS handshake, password authentication, role grants,
or Layer 4 query. It is therefore not evidence of an invalid password, missing
reader column grant, or an application SQL error. The observed network state is
for the Codex sandbox identity only. The normal Windows host independently
verified IPv6 binding, global addresses, a default route, DNS, and
`TcpTestSucceeded : True`; those facts supersede the earlier sandbox-only host
inference.

## Minimal implementation

### Safe diagnostics

`classify_catalogue_connection_error()` maps transport and database failures to
stable categories without exposing connection strings, certificate locations,
libpq text, passwords, or query data. Relevant categories include:

- `NETWORK_UNREACHABLE`, `DNS_FAILURE`, `TCP_TIMEOUT`, `TCP_REFUSED`,
  `TCP_ACCESS_DENIED`
- `TLS_VALIDATION_FAILED`, `AUTHENTICATION_FAILED`, `PERMISSION_DENIED`,
  `CONNECTION_EXHAUSTED`

The supervised local worker now emits only a safe marker such as:

```text
SAFE_WORKER_FAILURE:CATALOGUE_CONNECTION:TCP_ACCESS_DENIED
```

The HTTP contract remains unchanged and continues to return its generic safe
processing failure rather than leaking transport diagnostics to callers.

### Operator-safe direct verification

Added `app.integration.catalogue_connection_diagnostic`, which loads the
existing private `.env` locally, performs no write, opens the restricted direct
connection, runs one parameterized, bounded catalogue query, rolls back the
read-only transaction, closes the connection, and prints only a marker.

Run this in the **normal project user's PowerShell**, not by copying any secret
into chat or a command line:

```powershell
cd C:\Users\dahiy\MedDecode-integration\intelligence
$env:PYTHONDONTWRITEBYTECODE = '1'
.\.venv\Scripts\python.exe -m app.integration.catalogue_connection_diagnostic
```

Expected success marker:

```text
CATALOGUE_DIAGNOSTIC:OK:role=meddecode_catalogue_python_reader:readonly=on:tls_verify_full=true:parameterized_query=ok
```

If the normal user context returns `TCP_ACCESS_DENIED` or
`NETWORK_UNREACHABLE`, investigate that process identity or security product
before changing application configuration. Do not substitute a pooler, relax
TLS, change the hostname, use an administrator role, or change hosted grants.

## Files changed in Phase 2.4A

- `intelligence/app/database/catalogue_connection.py`
- `intelligence/app/integration/local_pdf_worker.py`
- `intelligence/app/integration/catalogue_connection_diagnostic.py` (new)
- `intelligence/tests/integration/test_catalogue_connection.py`
- `intelligence/tests/integration/test_catalogue_connection_diagnostic.py` (new)
- `intelligence/tests/integration/test_local_pdf_worker.py`
- `intelligence/docs/CODEX_PHASE2_4A_CATALOGUE_AND_E2E_COMPLETION.md` (new)

## Restricted role, TLS, and child verification

- Configuration parsing verified the intended restricted role and required
  `verify-full` CA path.
- A successful TLS handshake and real reader query cannot be claimed from this
  sandbox because socket access was denied first.
- The standalone diagnostic and supervised child independently reached the
  same transport category; the child reported
  `WORKER_CATALOGUE_CONNECTION_TCP_ACCESS_DENIED`.
- The child receives only `MEDDECODE_CATALOGUE_*` variables plus essential OS
  settings. It does not receive the FastAPI bearer token, worker login,
  backend credentials, or unrelated process secrets.

## Fictional PDF/JPEG/PNG processing

With `MEDDECODE_ADAPTIVE_OCR_ENABLED=true` and
`MEDDECODE_TROCR_ENABLED=false`, all three fictional fixtures were submitted
to the local harness. Each safely failed before OCR at catalogue connection:

| Fixture | Result |
| --- | --- |
| PDF | `WORKER_CATALOGUE_CONNECTION_TCP_ACCESS_DENIED` |
| JPEG | earlier Phase 2.3 run stopped at the same pre-OCR catalogue stage |
| PNG | earlier Phase 2.3 run stopped at the same pre-OCR catalogue stage |

No medicine, warning, catalogue lookup, Contract v1 success result, or hosted
record was fabricated. After the normal-user diagnostic succeeds, run the same
explicitly fictional fixtures through
`app.integration.fictional_document_harness` to obtain current five-layer
evidence; this report intentionally does not carry forward older Phase 2.2
success as a fresh Phase 2.4A pass.

## Regression evidence

| Check | Result |
| --- | --- |
| catalogue/local-worker/FastAPI/supervisor focused Python tests | 69 passed, 1 existing Starlette deprecation warning |
| full Python suite | 369 passed, 1 existing Starlette deprecation warning |
| backend suite | 503 passed |
| backend TypeScript typecheck | passed |
| backend build | passed (required normal shared-checkout write access) |
| root launcher tests | 6 passed |

The diagnostics tests explicitly verify parameterized query use, rollback and
close behavior, safe category mapping, and suppression of sensitive exception
content.

## Rollback

The change is local-only. To stop using the additional diagnostics, remove the
new diagnostic module and classification references as one reviewed source
change; no hosted rollback exists or is needed. Runtime rollback requires no
change because adaptive OCR and TrOCR remain disabled by default. Keep:

```text
MEDDECODE_TROCR_ENABLED=false
PROCESSING_WORKER_ENABLED=false
```

## Remaining limitation

The only blocking action is running the existing read-only diagnostic under the
normal Windows PowerShell user context, which has independently verified direct
TCP access. Codex's sandbox cannot supply this evidence. This is not a request
for a database grant, credential rotation, or schema change. Once the
diagnostic emits its `OK` marker, the local PDF/JPEG/PNG adaptive harness and
loopback FastAPI check can be rerun without changing any security boundary.

## Final status

CATALOGUE_ROOT_CAUSE: IDENTIFIED

DIRECT_CATALOGUE_CONNECTION: PARTIAL

TLS_VERIFY_FULL: PARTIAL

SUPERVISED_CHILD_CATALOGUE: PARTIAL

PDF_FIVE_LAYER_E2E: BLOCKED

JPEG_FIVE_LAYER_E2E: BLOCKED

PNG_FIVE_LAYER_E2E: BLOCKED

FASTAPI_ADAPTIVE_PATH: PARTIAL

CONTRACT_V1: VERIFIED

BACKEND_COMPATIBILITY: VERIFIED

TROCR_REMAINS_DISABLED: YES

HOSTED_WORKER_REMAINS_DISABLED: YES

READY_FOR_LOCAL_TWO_PROVIDER_ROLLOUT: NO
