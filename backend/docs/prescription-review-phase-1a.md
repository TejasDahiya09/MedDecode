# Prescription Review Phase 1A

Phase 1A adds a local, persistence-agnostic Review Contract v1 and immutable domain operations under `src/domain/prescription-review`. It does not add routes, database objects, hosted writes, workers, or frontend behavior, and it does not change Intelligence Contract v1.

## Domain guarantees

- Original extracted fields remain separate from current reviewed fields.
- Confirmed revisions cannot be edited.
- Reopening creates a new revision with a base-revision link.
- Lock-version checks reject stale commands.
- add and confirm commands have replay-safe identifiers.
- Medicine deletion is a tombstone; restore and OCR-original restore are distinct.
- Canonical SHA-256 fingerprints use `meddecode.review-input.v1`, include ordered active medicine fields, and exclude timestamps/provenance/display metadata.
- Invalidation identifies catalogue, ingredient, dose, schedule, recommendation, warning and aggregate dependencies without invoking Layers 4/5.
- Confirmation explicitly means reviewed transcription, not medical verification.

## Phase 1B atomic persistence requirements

An in-memory pure function cannot provide database transaction guarantees. Phase 1B must implement reviewed PostgreSQL/RLS/RPC operations that atomically:

1. derive owner from the authenticated prescription relationship;
2. compare the expected revision and lock version;
3. apply one validated command and increment the lock;
4. enforce unique prescription/revision numbers, medicine IDs and command IDs;
5. insert append-only review events while preserving original evidence;
6. confirm only a draft, persist its canonical fingerprint, and create at most one matching intelligence job;
7. replay the same confirmation idempotency key without creating another job;
8. reject a different confirmation key after confirmation;
9. fence intelligence finalization by confirmed revision ID and fingerprint;
10. mark prior results superseded/stale without deleting them.

Every hosted schema, RLS, grant, RPC and deployment operation remains a separate approval boundary.

## Security handoff

The domain deliberately has no `userId` argument and makes no authorization claim. Future services must derive the authenticated user from the bearer token and verify prescription ownership before loading or applying a command. Do not accept a client-supplied owner ID, log medicine content, or use a privileged database identity as a workaround.
