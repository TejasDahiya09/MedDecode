# Python intelligence

## Package organization

Work from `intelligence/`; imports and `pytest.ini` are configured for that directory.

1. `app/layer1_document_processing/` loads documents, renders pages, and runs OCR providers.
2. `app/layer2_information_extraction/` extracts prescription-level and medicine information.
3. `app/layer3_medicine_understanding/` parses medicine names, dosage instructions, and normalized entities.
4. `app/layer4_medicine_intelligence/` performs catalogue retrieval/matching and contains dataset-ingestion tooling.
5. `app/layer5_recommendations/` scores/ranks supported recommendation inputs.
6. `app/integration/` contains offline, local-PDF, development fixture, and worker/contract bridges.

These are code-layer boundaries, not independent deployable services. Layer 4 includes utilities that can write to Supabase; inspect the entry point before execution.

## OCR providers and limits

- EasyOCR is the local default when an explicit local model-cache directory is supplied. Batch 7 genuinely exercised fictional PDF, JPEG and PNG fixtures.
- PaddleOCR is optional adaptive fallback and requires both explicit local model directories. Package installation alone is not model availability; current genuine adaptive inference remains unverified.
- TrOCR uses a separate optional interpreter/model path, remains disabled by default, and must not be enabled without resource approval under the unchanged 2 GiB tree limit.
- AWS Textract and Google Cloud Vision SDKs are excluded from the default environment. Their separate requirement profiles and explicit provider selection do not authorize a cloud call.
- Provider availability, model files, memory use, and real document recognition are runtime concerns. A Contract v1 response can be valid even when it contains no recognized medicine.

Do not silently replace OCR results with fixture data. Preserve raw evidence, provenance, confidence where actually supplied, and uncertainty.

## Worker and JSON contract

The local PDF worker is a subprocess entry point used by the Node bridge. Its standard output is a JSON-only Contract v1 channel; diagnostics belong on standard error and must not contain prescription content or credentials. Use the real-PDF worker for genuine local OCR and the dedicated development fixture worker only for intentionally simulated tests.

## Python commands

The service README documents the reviewed offline suite and its exclusions. Common command:

```powershell
.venv\Scripts\python.exe -m pytest
```

Install `requirements.txt` for the local runtime and
`requirements-test.txt` for tests. Install one of
`requirements-cloud-aws.txt` or `requirements-cloud-google.txt` only after a
specific cloud provider, data flow, region, retention policy, credentials and
cost have been approved. There is no automatic cloud fallback.

This command excludes specific live Supabase tests, but it does not prove that the local OCR models initialize or that database writers are safe. Do not run real-prescription, model-runtime, Supabase, or database-write diagnostics without explicit authorization.

## Dataset ingestion

The working tree includes a source-specific RxNorm adapter for official RXNCONSO CSV/RRF-shaped extracts and an offline normalization/dry-run report. The adapter retains source identifiers, release, hashes, and raw fields; it deliberately does not infer strength, dosage form, approvals, or clinical claims from an RxNorm string. Other source names are rejected until schemas are verified. See [data sources](DATA_SOURCES.md).
