# ADR-001: Retain PostgreSQL/RPC Job Queue

**Status:** Proposed — awaiting owner approval

## Context

MedDecode already has atomic RPC claims, leases, heartbeats, fencing, cancellation, scoped authorization, finalization and recovery in PostgreSQL. No Redis/BullMQ runtime exists. OCR memory—not queue throughput—is the demonstrated constraint.

## Decision

Retain PostgreSQL/RPC as the sole V3 queue. Scale through bounded workers, indexes, connection budgets and measured contention. A second queue requires a later ADR with measured evidence.

## Consequences

Avoids dual authorities and new credentials. PostgreSQL load/retention must be monitored. This ADR authorizes no schema or activation change.
