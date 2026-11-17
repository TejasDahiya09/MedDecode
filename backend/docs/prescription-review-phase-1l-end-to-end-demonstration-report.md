# Controlled V3 demonstration — activation checkpoint

This run stopped at the explicit Generation 2 activation approval boundary.
No activation, feature flag, worker startup, upload or processing occurred.

## Current verification

- Branch: `integration/full-project`; existing changes preserved.
- Launcher tests: 6 passed. Focused backend/transport/confirmed-review tests:
  30 passed, zero failures or skips, including real Python Layers 4–5 adapter execution.
- Backend production build passed outside the filesystem sandbox. Frontend
  typecheck and production build passed; Vite reports a large-chunk warning.
- All five Migration 011 hashes match the previous approved candidate.
- Hosted read-only preflight returned
  `AUTOMATIC_ROLLOUT_GENERATION_2_ACTIVATION_PREFLIGHT_OK`.
- Deployed Migration 010 independent verification returned
  `PRESCRIPTION_REVIEW_INITIAL_COMPLETION_VERIFY_OK`.
- Migration 008 generation objects and the one-job submission guard are present.

## Fresh recovery point

UTC archive timestamp: `20261115T234619Z`.

Archive:
`C:\Users\dahiy\MedDecode-Backups\generation2-activation-20261115T234619Z\meddecode-public-auth-current.dump`

Size: 963,710 bytes.

SHA-256:
`4B4834BBD18D7AD7EA00B9B2F0D2E0B4E574275A79733E9C369910A6EA84343F`

The ACL-restricted public/auth custom archive restored successfully into a new
disposable PostgreSQL 17 UTF-8 database, including ACL definitions with existing
local placeholder roles. Source and restore matched: 6 prescriptions, 7 jobs,
2 results, 1 admission, 2 scopes, 0 review revisions. The deployed Migration 010
RPC and disabled Generation 2 state were present in the restore. The disposable
database was dropped and the private cluster stopped.

Recovery limitations: global roles/memberships, original ownership replay,
Supabase platform configuration and Auth service, S3 objects, external services.
Archive retention is manual; no automatic deletion was configured.

## Hosted readiness snapshot

The configured project service identifies `wyripeqruhvbksjfsvlr`, database and
session role `postgres`, with `sslmode=verify-full`; psql reports TLS 1.3.
Generation 1 admissions: 1; Generation 2 admissions: 0. Generation 2 remains
disabled. Exactly one allowlist row matches the reviewed synthetic account
`9a1b7896-34cd-439b-9cfd-b26411086786`. Claimable automatic scopes, worker
sessions, active leases and conflicting locks: all zero. Historical queued job
`e584f43c-51d9-436b-bbe6-da5572d2cdca` remains unadmitted.

## Pending explicit approval

Approve only
`backend/database/integration-migrations/202611160011_automatic_rollout_generation_2_activation_v1/002_activate.sql`
with SHA-256
`F1587077E3DDA568635474D5D6B8A4FEB5CD15C6B2917394172861BB1A74F3CC`,
followed by its independent read-only verification. The exact complete
transaction is in that file. It locks and revalidates the policy and generation
before setting Generation 2's activation timestamp and enabling policy admission.
It changes no job, prescription, result or scope.

Use expected database `postgres`, expected project `wyripeqruhvbksjfsvlr`,
expected test account `9a1b7896-34cd-439b-9cfd-b26411086786`, and local readiness
`PASS`. Recheck these and current database safety state immediately before use.
Worker startup requires the separate later approval stipulated by the master
execution request. Synthetic document preparation and the actual website
workflow remain pending; no OCR or final result is claimed for this run.
