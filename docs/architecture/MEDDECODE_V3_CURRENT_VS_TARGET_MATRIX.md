# MedDecode V3 Current vs Target Matrix

**Status:** Proposed — awaiting owner approval

| Capability | Current | V3 target | Disposition |
|---|---|---|---|
| Authentication | Supabase Auth bearer validation | unchanged | KEEP |
| Ownership | owner-scoped APIs/RLS assumptions | extend to evidence/revisions | EXTEND |
| Original storage | private S3 prescription objects | immutable + owner preview | EXTEND |
| Upload validation | PDF/JPEG/PNG signatures and bounds | unchanged, capability advertised | KEEP |
| Queue | PostgreSQL RPC jobs | same canonical queue | KEEP |
| Worker security | dedicated restricted/scoped identities | separate OCR/intelligence permissions as needed | EXTEND |
| OCR supervision | killable bounded subprocess tree | unchanged | KEEP |
| EasyOCR | default | baseline | KEEP |
| PaddleOCR | adaptive bounded fallback | same, evidence persisted | EXTEND |
| TrOCR | real but memory-blocked | resource-admitted only | KEEP DISABLED |
| Cloud OCR | disabled/not integrated | optional policy-gated adjudicator | DEFER |
| OCR evidence | rich internal, lossy app boundary | immutable provider/source evidence | ADD |
| Structured extraction | machine-generated | initial snapshot + review revision | EXTEND |
| Human correction | absent | add/edit/remove/restore/reorder | ADD |
| Confirmation | absent | atomic idempotent owner confirmation | ADD |
| Concurrency | job fencing | plus review ETag/lock version | EXTEND |
| Intelligence | immediate Layers 2-5 | confirmed revision input | CHANGE FLOW |
| Contract v1 | validated machine result | unchanged | KEEP |
| Result freshness | prescription/result relation | revision + fingerprint | EXTEND |
| History | prescriptions/results | expose current/superseded revision | EXTEND |
| Catalogue | restricted official reads/RPCs | preliminary suggestions + confirmed matching | EXTEND |
| Cabinet | authenticated CRUD | save only representable confirmed identities | KEEP/EXTEND |
| Reminders | frontend contracts need backend parity proof | confirmed cabinet-linked schedules | VERIFY/DEFER |
| Observability | bounded non-secret logs | revision/provider decision codes | EXTEND |
| Redis/BullMQ | absent | absent | DO NOT ADD |

## Preservation estimate

Of 22 major capability rows, 13 are primarily retained, 7 are additive extensions, one flow is deliberately changed, and cloud OCR is deferred. This is a conservative architecture evolution, not a rewrite. The estimate is capability-based, not a claim about lines of code.

## Functionality matrix

| User function | Actual current evidence | Target acceptance |
|---|---|---|
| Sign in | implemented/tested | retain |
| Upload PDF/JPEG/PNG | implemented/tested | retain |
| Private storage | implemented/tested | retain |
| Automatic processing | implemented behind controlled flags | retain disabled-by-default rollout |
| View status/results/history | implemented/tested | revision-aware |
| Review original source | not complete | owner-only preview + evidence |
| Correct OCR fields | absent | revision editor |
| Add/remove medicines | absent | tombstoned review operations |
| Confirm extraction | absent | idempotent atomic confirmation |
| Recompute after edit | absent | fingerprint-bound job |
| Catalogue search/detail/compare | implemented | preserve source-aware IDs |
| Save to cabinet | implemented with legacy-ID constraint | confirmed identity mapping only |
| Create reminders | UI/API claims need complete backend evidence | no silent OCR-derived schedules |

## Documentation conflicts to resolve after approval

- Older implementation/status documents contain outdated test counts and OCR-provider conclusions.
- Some database notes describe historical hosted migration states and must not be treated as current proof.
- Any document describing a local bridge as the only active intelligence path should be reconciled with the authenticated FastAPI client and worker composition.
- This V3 package supersedes conflicts only after owner approval; historical evidence remains preserved.
