# Postgres public default privilege hardening v1

This partial future-object hardening candidate changes only defaults used when
role `postgres` creates future tables or sequences in schema `public`.

It removes automatic access for `anon`, `authenticated`, and both MedDecode
worker roles. It preserves the existing `postgres` and `service_role` defaults.
Future API-facing tables/sequences must receive explicit grants in their own
reviewed migration.

It deliberately does not change:

- any current object;
- function or type defaults;
- any schema other than `public`;
- `supabase_admin` defaults;
- RLS, ownership, policies, data, RPCs, or worker configuration.

Function/type hardening is not included because PostgreSQL's built-in PUBLIC
defaults cannot be subtracted by a schema-specific default ACL. A global revoke
for `postgres` would affect future objects in `extensions` and
`official_catalogue`, so it requires a separate compatibility decision.

Deployment requires separate hash-specific authorization, a fresh verified
backup, exact preflight success, one atomic execution, and immediate independent
verification. The rollback review is read-only and never regrants broad access.
