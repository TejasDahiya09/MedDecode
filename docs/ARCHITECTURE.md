# Architecture

## Components

```text
Browser (React/Vite)
       │ authenticated HTTPS/JSON or multipart requests
       ▼
Node.js / Express API ───── Supabase Auth/PostgreSQL
       │                         │
       ├── object-storage adapter └── application metadata and job records
       │
       └── local Python process bridge (explicitly configured workflows)
                    │
                    ├── document loading and OCR providers
                    ├── extraction, medicine parsing and normalization
                    ├── catalogue matching/intelligence
                    └── Contract v1 JSON
```

This is a repository-level model, not a guarantee that every edge is enabled in a given environment. The backend and Python service are separate packages; the Python code is not an HTTP server by virtue of being in the repository. The active bridge invokes a worker process for configured use cases.

## Runtime paths

1. **Frontend-only demonstration:** the Vite application renders product and fictional sample workflows using local fixtures. These screens do not establish a clinical-data pipeline.
2. **Authenticated API:** the frontend session supplies a bearer token. The backend verifies identity and uses request-scoped user clients for user-scoped operations where implemented.
3. **Prescription storage and processing:** upload, persistence, job submission, and result retrieval use separate API/database/storage paths. The processing job store is gated by `PROCESSING_JOB_STORE_ENABLED`; its default is disabled.
4. **Development fixture intelligence:** the backend conditionally registers a dedicated endpoint only in development when explicit local fixture paths are set. It runs Python with fictional, injected OCR. This path is not a substitute for real OCR and does not prove a production worker is ready.
5. **Python local worker:** the real-PDF worker can use EasyOCR with an explicitly provided local model cache. Optional OCR providers are not prerequisites for EasyOCR; live cloud OCR must remain separately configured and authorized.

## Contract boundary

The backend validates the intelligence response against Contract v1 before returning/persisting supported results. Keep the validator and Python mapper in sync through contract tests. A valid response can still be empty or contain warnings; schema validity is not proof of correct medicine recognition.

## Trust and persistence

- The browser is an untrusted client. User identity and ownership must be derived from verified authentication, not body fields.
- Supabase Auth identifies users; PostgreSQL row-level security and backend authorization are distinct controls.
- Prescription binary storage is intended to be external object storage; database records hold metadata and references.
- OCR output, parsed medicine data, matched catalogue data, and recommendations are separate claims with different evidence. Do not collapse uncertainty or infer missing clinical facts.
- Dataset ingestion and database writing are distinct stages. Offline parsing/dry-run must not be described as a database import.

## Known gaps

The database-reference SQL currently present in the worktree explicitly preserves pre-existing medicine tables but does not define their complete DDL. Hosted schema compatibility, live cloud access, production worker activation, and end-to-end processing of a real prescription are not established by this architecture diagram.
