# Official catalogue deployment preparation

**Status: preparation only.** No hosted connection, schema migration, data
restore, RPC deployment, or source database write was performed. Option A keeps
all legacy `public.medicines` data and IDs intact.

For the dependency-ordered catalogue, Python-reader, and worker package, use
[`unified-hosted-deployment.md`](./unified-hosted-deployment.md).

## Verified local snapshot

The source was confirmed as PostgreSQL 17.11 at `127.0.0.1:5433`,
`meddecode_job_test`, schema `official_catalogue`. The schema contains 13 tables;
the read-only verifier checks every table, validated foreign keys, provenance,
IDs, import batches, typed relationships, prices, regulatory events, and access
state.

| Table | Rows |
|---|---:|
| sources | 12 |
| releases | 22 |
| import_batches | 42 |
| source_records | 7,072 |
| ingredients | 8,388 |
| formulations | 4,802 |
| formulation_ingredients | 5,079 |
| products | 1,710 |
| product_packages | 4,781 |
| price_observations | 4,781 |
| regulatory_events | 1,951 |
| link_candidates | 9,982 |
| catalogue_entities | 26,419 |

All 17 foreign keys are validated and there are no observed orphans. All 4,802
formulations have matching formulation entities. The latest completed batch per
release accounts for 7,072 input records: 7,032 new, 40 previously existing,
and zero hash conflicts. All 42 stored batches are completed.

Prices remain separated into 915 ceiling-price, 22 special-feature ceiling,
1,391 revised-MRP, and 2,453 PMBI-listed-MRP observations. All 4,781 price rows
have `package_id = NULL`; product/package/formulation foreign-key associations
are absent, so the RPC must continue returning empty prices. Regulatory events
contain 1,244 approvals and 707 restriction notices; all retain
`establishes_current_status = false`.

The stored link table contains 7,200 exact and 2,782 unmatched candidates. The
preparation pipeline reported 10,663 linkages, but intentionally omits uncertain
links when writing this table. Those unresolved candidates are not in the
database dump and must not be described as exported link rows.

All source records have matching dataset, external-record ID, and release
metadata in their preserved original payloads. The `sources.authority` column
currently contains the generic value `official-source-as-recorded`; exact
source authorities are retained in each original payload. Also, the importer’s
`releases.dataset_hash` is derived from source key and release label, not a hash
of the complete source extract. Use the archive SHA-256 below for this exact
transfer snapshot; do not treat `dataset_hash` as the archive checksum.

The source relations total about 84 MiB. A verified custom-format, data-only
archive contains exactly the 13 `official_catalogue` table-data entries:

- Size: **8,165,661 bytes (7.79 MiB)**
- SHA-256: `E8962AFA0E5DF6D8F3B090E3EDC61A96E59C9BB3BBDE8A444C57CA77C01E365F`
- Local prepared archive: `C:\Users\dahiy\.copilot\session-state\3119dafc-d38d-45a4-8289-1320be7f544b\files\official_catalogue_deployment_2026-11-13.dump`

The archive is data-only: it does not contain schema DDL, legacy tables,
prescriptions, authentication tables, or application records.

## Deployment order

Do not blindly apply every dated integration migration. The intended official
catalogue sequence is:

1. Capture the target’s legacy medicine state with
   `backend/database/legacy_catalogue_state_capture.sql`.
2. Run the read-only, fail-closed
   `backend/database/official_catalogue_target_preflight.sql`. It requires the
   legacy `public.medicines` table, a fresh `official_catalogue` namespace,
   Supabase roles, `auth.uid()`, and role/schema provisioning privileges.
3. Apply
   `backend/database/integration-migrations/202611130001_official_catalogue_source_aware/001_up.sql`.
4. Apply
   `backend/database/integration-migrations/202611130002_official_catalogue_link_replay_identity/001_up.sql`.
5. Restore the data-only archive in one transaction.
6. Run `backend/database/official_catalogue_snapshot_verify.sql`.
7. Apply the official RPC migration in order:
   `202611130004_official_catalogue_read_rpc/001_preflight.sql`,
   `002_up.sql`, then `003_verify.sql`.
8. Re-run the legacy state capture and compare its output with the pre-deployment
   capture.
9. Run the authenticated, anonymous, and direct-table PostgREST smoke checks
   below. Keep the read feature disabled until every check passes.

`202611130003_restricted_medicine_catalogue` targets the legacy
`public.medicines` schema and is **not part of this official data deployment**.
Do not apply it as a prerequisite.

## Commands (examples only; hosted commands are unexecuted)

Local export, using existing password-file authentication and PostgreSQL 17
client tools:

```powershell
.\backend\scripts\export-official-catalogue.ps1 `
  -OutputPath 'C:\secure\exports\official_catalogue.dump' `
  -PgBinDirectory 'C:\Program Files\PostgreSQL\17\bin'
```

The script hard-codes the verified local source identity, runs the read-only
snapshot verifier, exports only `official_catalogue` table data, refuses to
overwrite an existing output, validates all 13 archive entries, and prints a
SHA-256. It never uses `--clean`, `--drop`, or `--disable-triggers`. Do not put
passwords in command arguments or `PGPASSWORD`; use an approved password file
or credential provider.

After separate deployment approval, set `$TargetDsn` from the approved secure
secret source (do not print it), then execute:

```powershell
$TargetDsn = '<approved TLS-protected target connection string>'
$Archive = 'C:\secure\exports\official_catalogue.dump'
psql $TargetDsn -X -v ON_ERROR_STOP=1 -f .\backend\database\official_catalogue_target_preflight.sql
psql $TargetDsn -X -v ON_ERROR_STOP=1 -f .\backend\database\integration-migrations\202611130001_official_catalogue_source_aware\001_up.sql
psql $TargetDsn -X -v ON_ERROR_STOP=1 -f .\backend\database\integration-migrations\202611130002_official_catalogue_link_replay_identity\001_up.sql
pg_restore --dbname=$TargetDsn --data-only --no-owner --no-acl --exit-on-error --single-transaction $Archive
psql $TargetDsn -X -v ON_ERROR_STOP=1 -f .\backend\database\official_catalogue_snapshot_verify.sql
psql $TargetDsn -X -v ON_ERROR_STOP=1 -f .\backend\database\integration-migrations\202611130004_official_catalogue_read_rpc\001_preflight.sql
psql $TargetDsn -X -v ON_ERROR_STOP=1 -f .\backend\database\integration-migrations\202611130004_official_catalogue_read_rpc\002_up.sql
psql $TargetDsn -X -v ON_ERROR_STOP=1 -f .\backend\database\integration-migrations\202611130004_official_catalogue_read_rpc\003_verify.sql
```

Before any hosted command, verify the target host/database and PostgreSQL
version. The local and verified hosted schemas are PostgreSQL 17.11. RPC
preflight requires `CREATEROLE`, `CREATE` on
`public`, authority to grant and revoke that temporary `public` privilege,
effective access to `auth.uid()`, and no direct client usage/select on
`official_catalogue`. The RPC migration does not grant on Supabase-managed
`auth` objects; it fails closed if the restricted owner cannot already use
`auth.uid()` effectively. Stop if any prerequisite differs; do not relax
grants or RLS checks to force deployment.

### PostgREST smoke checks

Use an approved authenticated access token without printing it:

```powershell
$SupabaseUrl = '<approved Supabase project URL>'
$AnonKey = '<approved publishable/anon key>'
$AccessToken = '<approved authenticated user token>'
$FunctionHeaders = @{
  apikey = $AnonKey
  Authorization = "Bearer $AccessToken"
  "Content-Type" = "application/json"
}

$search = Invoke-RestMethod `
  -Method Post `
  -Uri "$SupabaseUrl/rest/v1/rpc/meddecode_official_catalogue_search_v1" `
  -Headers $FunctionHeaders `
  -Body '{"p_query":"synthetic","p_limit":2,"p_offset":0}'

if ($search.Count -gt 2 -or $search[0].catalogue_source -ne "official_catalogue") {
  throw "Authenticated official catalogue search smoke check failed."
}
```

Run the detail RPC with a known verified official formulation UUID and confirm
that `id_namespace` is `official_catalogue.formulation_id` and `prices` is an
array. Requests without the bearer token must return an authentication or
authorization failure. A direct-table probe must use the official schema
profile and must not return rows:

```powershell
$DirectHeaders = @{
  apikey = $AnonKey
  Authorization = "Bearer $AccessToken"
  "Accept-Profile" = "official_catalogue"
}
$direct = Invoke-WebRequest `
  -Method Get `
  -Uri "$SupabaseUrl/rest/v1/formulations?select=formulation_id&limit=1" `
  -Headers $DirectHeaders `
  -SkipHttpErrorCheck
if ($direct.StatusCode -ge 200 -and $direct.StatusCode -lt 300) {
  throw "Direct official catalogue table access was unexpectedly exposed."
}
```

## Backend API contract for frontend integration

These authenticated backend routes preserve separate identifier namespaces:

- `GET /api/v1/medicines?q=<term>&limit=<1..50>&offset=<0..500>&source=<legacy|official_catalogue>`
  returns `{ items, pagination: { limit, offset, has_more } }`.
- `GET /api/v1/medicines/:id?source=<source>` returns `{ medicine }`.
- `GET /api/v1/medicines/compare?a=<uuid>&b=<uuid>&source=<source>` returns
  `{ medicines: [first, second], clinical_equivalence: null }`.

Official rows include `id`, `catalogue_source`,
`id_namespace`, `canonical_name`, `generic_name`, `brand_name`, `dosage_form`,
`strength_value`, `strength_unit`, and `manufacturer_name`. Detail responses
also include `ingredients`, `aliases`, `sources`, and `prices`. Official
formulation IDs are UUIDs in the
`official_catalogue.formulation_id` namespace. `prices` and unverified
optional metadata remain empty or null; clients must not infer substitutions or
legacy IDs.

Invalid query parameters, unknown sources, malformed UUIDs, duplicate compare
IDs, or unexpected query keys return `400`. Missing records return `404`;
unauthenticated requests return `401`; and disabled catalogue reads return
`503` with `CATALOGUE_NOT_CONFIGURED`. Explicit `source=legacy` remains
available after official activation.

## Rollback and recovery

- The schema migrations are transactional. A failed migration rolls back its
  own transaction; stop and inspect before continuing.
- `pg_restore --single-transaction` either imports the complete snapshot or
  rolls back the import. Do not retry until target state is inspected and the
  snapshot verifier confirms whether rows were committed.
- Never truncate, drop, or recreate the legacy catalogue. If any verification
  fails after import, leave the additive schema untouched, keep RPC access
  disabled, and investigate. Do not use a cleanup restore.
- Before primary-source activation, keep the backend on `legacy`. If a later
  activation must be reversed, set the default back to `legacy` and disable
  `MEDICINE_CATALOGUE_READ_ENABLED`; preserve both catalogues and their IDs.
- Any removal of RPC functions or the cluster-wide owner role requires a
  separately reviewed rollback after checking dependencies and grants.

## Backend activation and remaining integration

The new `MEDICINE_CATALOGUE_DEFAULT_SOURCE` setting is strict and defaults to
`legacy`. After hosted schema/import/RPC verification and explicit approval,
the minimal activation is:

```text
MEDICINE_CATALOGUE_READ_ENABLED=true
MEDICINE_CATALOGUE_DEFAULT_SOURCE=official_catalogue
```

Requests can still select `?source=legacy` explicitly. The source selector
must be retained for detail and comparison so an official UUID is never sent
to a legacy lookup. The medicine cabinet still validates IDs through the
legacy detail RPC and writes a foreign key to `public.medicines`; official
formulation UUIDs cannot be added there. Do not map them. Supporting official
cabinet entries requires a separately approved source-aware cabinet contract
and storage relationship. Frontend consumers must preserve
`catalogue_source`/`id_namespace` and distinguish unavailable price data.

## Readiness

Local export, archive contents, snapshot counts, provenance, and read-only
integrity checks passed. The isolated PostgreSQL RPC suite passed, including
authenticated behavior, anonymous/PUBLIC denial, direct-table denial, stable
UUIDs, and response-shape checks. Backend tests, typecheck, and build passed.
Hosted import and activation remain blocked until the read-only hosted
preflight, deployment approvals, and PostgREST smoke checks pass.
