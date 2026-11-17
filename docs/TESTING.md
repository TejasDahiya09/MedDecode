# Testing and validation

Run commands from the named service directory. Tests should use synthetic inputs, mocks, and local fixtures only.

## Frontend

From `frontend/`:

```powershell
npm run typecheck
npm run lint
npm run test:unit -- --run
npm run build
npm run test:e2e
```

The browser suite uses Playwright and may create `test-results/` and `playwright-report/` output. This proves only the tested browser behaviors and viewport configurations.

## Backend

From `backend/`:

```powershell
npm run typecheck
npm test
npm run build
```

Do not run `smoke:auth` or `smoke:profile-write` without a separately approved target/account and live-operation plan.

## Python

From `intelligence/`:

```powershell
py -3.12 -m pytest
```

The pytest configuration excludes the runtime-e2e and Supabase-read-only tests listed in `pytest.ini`. Tests that initialize OCR models, contact Supabase, process real prescription data, or write database records are not part of this default offline command and need separate authorization.

For recent changes, focused selectors may be used, for example:

```powershell
py -3.12 -m pytest tests/layer1/test_google_vision_provider.py tests/layer4/test_official_dataset_ingestion.py
```

## Local database migration tests

Use only the repository's dedicated local PostgreSQL harness against its explicitly disposable database. Verify database identity before any harness that can reset schemas. Read the harness safety checks first. Do not point it at Supabase or another shared/hosted database.

## Evidence and reporting

Record the exact command, exit result, environment scope, and test count. Distinguish:

- Unit tests with deterministic mocks.
- Local fixture/browser demonstrations.
- Local model inference.
- Local disposable-database migration tests.
- Hosted integration and production deployment.

One category does not prove another. Current tests must be rerun after changes; historical results are not fresh validation.
