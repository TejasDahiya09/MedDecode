# MedDecode

MedDecode is a prototype for organizing prescription and medicine information. This repository brings together a React frontend, a Node.js/Express backend, and a Python intelligence package. It is not a clinically validated or approved medical device; do not use it to make care decisions.

## Repository map

| Path | Purpose |
| --- | --- |
| `frontend/` | React 19, TypeScript, Vite, user interface and browser tests |
| `backend/` | Express API, authentication boundary, prescription storage metadata, job submission, and Contract v1 validation |
| `intelligence/` | Python document/OCR and medicine-understanding layers, dataset ingestion, and offline tests |
| `backend/database/` | Database migrations and local migration test harnesses |
| `docs/` | Architecture, service guides, safety boundaries, testing, data sources, and implementation status |

Services have independent dependency manifests and commands. There is no root-level install or start command.

## Current product boundaries

- The frontend includes public pages, authenticated screens, and local demonstration workflows. A fictional development-only intelligence endpoint is separate from ordinary prescription processing and uses injected fixture OCR; it is not evidence of genuine OCR.
- The backend exposes authenticated profile, family-member, prescription, medicine-cabinet, processing, and results routes. Some operations require configured external storage or database services.
- The Python package contains document processing and intelligence code, including local OCR paths and optional providers. The worker bridge and provider availability are configuration-dependent.
- RxNorm ingestion and enrichment are implemented as separate offline stages: RXNCONSO parsing/dry-run followed by RXNREL/RXNSAT enrichment. The recorded local run covered 290 accepted records: 305 ingredient links, 15 multi-ingredient formulations, and ingredient/strength/dosage-form coverage for all 290. Fourteen focused ingestion/enrichment tests passed. This is a bounded local run, not full-catalog or clinical validation; there is not yet a single composed CLI entry point.
- RxNorm source files and normalized/enriched JSON exports under `datasets/` are local-only and Git-ignored. Do not stage or commit them. Other named datasets remain unavailable until their official extract schemas are verified.
- Database reference files and local migration tests do not establish that any migration has been applied to a hosted database.

See [architecture](docs/ARCHITECTURE.md), [implementation status](docs/IMPLEMENTATION_STATUS.md), and the [service documentation](docs/).

## Local development

Install dependencies in each service using its lockfile and package instructions. Use separate terminals:

```powershell
Set-Location frontend
npm ci
npm run dev
```

```powershell
Set-Location backend
npm ci
npm run dev
```

The frontend development server defaults to `http://127.0.0.1:5174`; the backend defaults to port `3000`. The frontend can render local demo pages without backend connectivity. Authenticated API functions and storage/database-backed operations require correctly configured local environment variables. Do not copy production credentials into a development environment.

Python setup and the safe offline-test boundary are documented in [intelligence](docs/INTELLIGENCE.md) and [testing](docs/TESTING.md). Do not run live, database-writing, real-prescription, or model-initialization diagnostics as part of ordinary tests.

## Environment and data safety

Environment files, credentials, prescription documents, model assets, and downloaded datasets are not repository deliverables. Keep credentials in ignored local files; frontend `VITE_` variables are public and must never contain server secrets. Use only synthetic fixtures in tests and demonstrations. See [security and privacy](docs/SECURITY.md).

The root `.gitignore` excludes root `datasets/` and `test-results/`; the latter contains generated browser-test diagnostics and must not be added to source control. Ignore rules are not a substitute for checking whether sensitive files are already tracked.

## Documentation

- [Architecture and data flow](docs/ARCHITECTURE.md)
- [Backend API and configuration](docs/BACKEND.md)
- [Frontend routes and boundaries](docs/FRONTEND.md)
- [Python intelligence and OCR](docs/INTELLIGENCE.md)
- [Medicine datasets and provenance](docs/DATA_SOURCES.md)
- [Official dataset ingestion and RxNorm results](docs/OFFICIAL_DATASETS.md)
- [Database and migrations](docs/DATABASE.md)
- [Security, privacy, and safety](docs/SECURITY.md)
- [Testing and validation](docs/TESTING.md)
- [Implementation status and consolidation](docs/IMPLEMENTATION_STATUS.md)

The service READMEs contain additional service-specific detail. In case of conflict, implementation and tests are authoritative; this documentation records known gaps rather than promising unverified behavior.
