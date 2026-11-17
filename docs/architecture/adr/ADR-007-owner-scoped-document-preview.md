# ADR-007: Owner-Scoped Private Document Preview

**Status:** Proposed — awaiting owner approval

## Context

Review requires source visibility, while prescription objects are private and must not become public URLs.

## Decision

Expose only authenticated owner-authorized streaming or short-lived signed access, with strict object-key validation, expiry, safe headers and audit metadata. Never return permanent S3 credentials or internal keys unnecessarily.

## Consequences

Enables evidence review while preserving privacy. Cache, download and browser-content policies require security testing.
