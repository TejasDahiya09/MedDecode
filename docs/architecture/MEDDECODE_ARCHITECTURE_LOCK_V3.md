# MedDecode Architecture Lock V3

**STATUS: PROPOSED — AWAITING OWNER APPROVAL**

This file is a proposed freeze, not authorization to implement it.

## Proposed locked decisions

1. React/Vite, Express/TypeScript, FastAPI/Python, Supabase Auth/PostgreSQL, private AWS S3, and the official catalogue remain the platform.
2. PostgreSQL/RPC remains the only job queue. No Redis, BullMQ, Celery, or parallel queue is introduced in V3.
3. Contract v1 remains the immutable machine-intelligence contract.
4. Human review is an additive application contract with immutable revisions and field provenance.
5. Original document and OCR evidence are never overwritten by a correction.
6. Intelligence results bind to a confirmed revision and canonical input fingerprint; stale finalization is rejected.
7. EasyOCR is baseline, PaddleOCR is bounded fallback, and TrOCR remains resource-gated and disabled under the current 2 GiB limit.
8. Cloud OCR is optional, disabled by default, and requires separate privacy, residency, cost, credential and activation approval.
9. Supabase Auth/RLS and least-privilege application/catalogue/worker identities remain mandatory.
10. PDF/JPEG/PNG remain the advertised formats until another format passes complete security and genuine acceptance testing.
11. Automatic processing remains disabled by default and activation remains an explicit operational boundary.
12. No clinical equivalence, treatment recommendation, or calibrated confidence may be inferred from OCR provider agreement alone.

## Change control

After owner approval, a change to a locked decision requires a new ADR stating evidence, compatibility, security impact, migration and rollback. Approval of this document would approve architecture direction only—not SQL, hosted changes, credentials, worker activation, cloud calls, or patient-data processing.

## Documents governed

- `MEDDECODE_MASTER_SYSTEM_AUDIT_V3.md`
- `MEDDECODE_TARGET_ARCHITECTURE_V3_PROPOSED.md`
- ADR-001 through ADR-008
- `MEDDECODE_V3_IMPLEMENTATION_ROADMAP.md`
- `MEDDECODE_V3_CURRENT_VS_TARGET_MATRIX.md`

Earlier architecture/status documents remain historical evidence. They are not deleted. Where they conflict, this V3 package would supersede them only after explicit owner approval.
