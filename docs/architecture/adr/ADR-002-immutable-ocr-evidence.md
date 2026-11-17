# ADR-002: Immutable OCR Evidence and Correction Provenance

**Status:** Proposed — awaiting owner approval

## Context

Internal OCR retains richer provider evidence than the persisted/UI contract. Overwriting OCR with user edits would destroy auditability.

## Decision

Store immutable, bounded OCR evidence separately from structured review revisions. Each corrected field records observed evidence and user/system provenance. Deletions are tombstones.

## Consequences

Enables source review and dispute analysis, with additional private storage and retention obligations. No prescription text belongs in routine logs.
