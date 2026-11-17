# MedDecode intelligence service

## Project layout

Use `intelligence/` as the working directory for Python commands. Source and
tests import the local package as `app`, so repository-root execution is not
configured.

The current source contains five layers:

1. Document loading, image/PDF processing, and OCR.
2. Prescription information extraction.
3. Medicine parsing and normalization.
4. Medicine catalogue retrieval, matching, enrichment, and dataset-ingestion
   utilities.
5. In-memory recommendation scoring and ranking.

`app/main.py` remains empty. The production subprocess entry point for real
PDF processing is `python -m app.integration.local_pdf_worker`; the Node
worker supplies the input JSON on stdin and consumes exactly one Contract v1
JSON document from stdout.

## Python and dependencies

Python 3.10 or newer is required by the current type syntax. Python 3.12 is the
candidate interpreter for the first controlled compatibility test; it is not
yet a verified or locked project requirement.

Runtime dependencies are declared in `requirements.txt`. Test dependencies are
declared in `requirements-test.txt`. The required direct packages include
Pillow, PyMuPDF, NumPy, PaddleOCR, PaddlePaddle, python-dotenv, and the Supabase
Python client.

The newly added direct dependencies are intentionally not version-pinned until
a compatible PaddleOCR/PaddlePaddle/Python combination has been verified. These
files are dependency declarations, not a reproducible lockfile.

## Safe offline tests

After a separately approved dependency installation, run the default reviewed
offline suite from this directory with:

```powershell
py -3.12 -m pytest
```

`pytest.ini` limits collection to `tests/` and excludes the two Layer 4 tests
that instantiate a real Supabase repository. `conftest.py` additionally blocks
network connections, clears Supabase variables, and disables dotenv loading
for the pytest process.

The offline suite uses in-memory mocks or synthetic temporary fixtures. It
does not establish that OCR model initialization, Supabase access, or the full
intelligence pipeline works in a deployed environment.

## Excluded diagnostics and live operations

The following are not ordinary offline tests and must never be invoked by the
default pytest command:

- `tests/layer4/test_layer4_runtime_e2e.py`
- `tests/layer4/test_layer4_supabase_readonly.py`
- `test_real_supabase_e2e.py`
- `test_real_prescription_e2e.py`
- `test_ocr_manual.py`
- `app/database/supabase_connection_test.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/run_ingestion.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/real_supabase_ingestion_test.py`

The real-prescription diagnostic can print OCR and extracted medical content.
Dataset-ingestion utilities can write database records. They require separate
authorization, safety review, and controlled credentials.

Offline tests must not use production Supabase credentials. Official catalogue
reads use the explicit `MEDDECODE_CATALOGUE_*` settings described in
`.env.example`. The `local_pdf_worker` refuses catalogue processing when the
environment is missing or invalid; it never falls back to localhost in a
hosted configuration. Hosted connections require `verify-full` TLS, an
existing root certificate, and a password or mounted password file.

## Python worker deployment

The real worker command is:

```powershell
py -3.12 -m app.integration.local_pdf_worker `
  --local-pdf-path C:\private\prescription.pdf `
  --official-catalogue `
  --ocr-provider easyocr `
  --easyocr-model-directory C:\private\easyocr-models
```

The Node worker owns the subprocess timeout and cancellation. The Python
worker validates the Contract v1 request, rejects missing catalogue
configuration, keeps diagnostics on stderr, and writes no non-JSON content to
stdout. The catalogue identity must be a dedicated restricted read-only
account. For the current direct-read provider, the minimum hosted grants are:

```sql
CREATE ROLE meddecode_catalogue_python_reader
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA official_catalogue
  TO meddecode_catalogue_python_reader;
GRANT SELECT (entity_id, evidence, identity)
  ON TABLE official_catalogue.catalogue_entities
  TO meddecode_catalogue_python_reader;
```

The role must not receive application-table, write, legacy-catalogue, schema
CREATE, or `auth` privileges. Set its password through the deployment secret
manager or a mounted passfile; never put credentials in `.env.example`.
Hosted role creation and grants require separate deployment approval.
