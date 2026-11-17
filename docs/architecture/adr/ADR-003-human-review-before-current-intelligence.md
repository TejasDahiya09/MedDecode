# ADR-003: Human Review Before Current Intelligence

**Status:** Proposed — awaiting owner approval

## Context

Users currently cannot correct extraction before downstream intelligence becomes the displayed result.

## Decision

For V3-reviewed flows, OCR creates an awaiting-review draft. Only atomic owner confirmation produces the canonical fingerprint and an intelligence job. Legacy behavior remains readable during migration.

## Consequences

Improves safety but adds an interaction step. Product copy must not imply that confirmation is medical validation.
