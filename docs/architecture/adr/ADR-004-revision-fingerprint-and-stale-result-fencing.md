# ADR-004: Revision Fingerprint and Stale-Result Fencing

**Status:** Proposed — awaiting owner approval

## Context

Asynchronous processing can finish after a user creates a newer correction.

## Decision

Bind every intelligence job/result to a confirmed revision ID and canonical input fingerprint. Finalization must reject or supersede results whose expected revision is no longer current. Confirmation is idempotent and optimistic-concurrency protected.

## Consequences

Prevents stale overwrite and duplicate jobs. Canonical serialization/versioning must be specified and tested across Node, Python and SQL.
