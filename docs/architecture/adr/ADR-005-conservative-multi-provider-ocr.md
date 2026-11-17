# ADR-005: Conservative Multi-Provider OCR Reconciliation

**Status:** Proposed — awaiting owner approval

## Context

EasyOCR, PaddleOCR and TrOCR confidence values are not mutually calibrated. Clinically material disagreement cannot be resolved by naïve majority vote.

## Decision

EasyOCR remains baseline, Paddle is bounded fallback, and TrOCR is resource-gated. Preserve alternatives and withhold unresolved medicine names, decimals, strengths, units, routes and frequencies. Provider evidence survives into review.

## Consequences

Some fields remain unknown and require human review. TrOCR stays disabled under the current 2 GiB budget.
