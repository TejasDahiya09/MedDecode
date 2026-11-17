# ADR-008: Additive, Versioned and Reversible V3 Rollout

**Status:** Proposed — awaiting owner approval

## Context

The existing vertical slice works and contains valuable historical results. A flag-day replacement is unnecessary and risky.

## Decision

Use additive schema/API/UI changes, negotiated feature flags, fictional allowlisted rollout, independent verification and disable-first rollback. Preserve Contract v1 and historical records.

## Consequences

Temporary compatibility complexity is accepted. No phase inherits authorization for the next hosted mutation or activation.
