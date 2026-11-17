# ADR-006: Optional Policy-Gated Cloud OCR

**Status:** Proposed — awaiting owner approval

## Context

Google Vision and Document AI can provide handwriting/layout evidence but add external processing, residency, retention, credentials, cost and possibly cloud-storage flows.

## Decision

Define an optional provider interface but keep cloud OCR disabled. Invocation requires explicit policy/consent, approved region, cost and resource caps, non-destructive evidence normalization and separate deployment approval.

## Consequences

Local processing remains functional when cloud is unavailable. Cloud OCR is never a silent low-confidence fallback.
