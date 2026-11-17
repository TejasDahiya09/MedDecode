# Security, privacy, and safety

## Sensitive information

Prescription images/PDFs, OCR text, medicine and dosage details, patient identity, access tokens, and service credentials are sensitive. Use only synthetic fixtures for routine local tests. Do not print or attach OCR text, patient details, JWTs, signed URLs, or environment values to logs, screenshots, issue reports, or test output.

Never commit `.env`, `.env.local`, model caches, downloaded datasets, private test outputs, or real prescriptions. The frontend's `VITE_` variables are delivered to the browser and must contain only public configuration. `gitignore` does not protect files already tracked or prevent accidental copying.

## Authentication and authorization

The frontend access token is verified by the backend. Derive ownership from the verified identity, not caller-supplied user IDs. Use request-scoped user clients and RLS for user-scoped operations; review privileged server credentials and administrative clients separately. Do not put secret keys in browser code.

Current code references both `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`; Python database configuration separately reads `SUPABASE_KEY`. These names and trust levels are not interchangeable. The privilege boundary and least-privilege deployment configuration require explicit review.

## OCR and clinical claims

OCR output is fallible. Preserve raw evidence and uncertainty; do not invent a medicine, dose, contraindication, price, alternative, or recommendation when evidence is absent. A successful schema validation is not a clinical accuracy result. No clinical safety or efficacy validation is claimed.

EasyOCR local execution is distinct from optional cloud OCR. The Google Vision adapter's fake-client tests do not make a cloud call. Keep cloud providers disabled unless the user has separately authorized a specific provider, data flow, credentials, region, retention terms, and cost.

## Development fixture

`/api/v1/development/fictional-intelligence-result` uses a fixed synthetic request and local injected OCR. It is registered only under the development flag with explicit local paths. Never pass patient documents to this endpoint or describe fixture OCR as real recognition.

## Local safety controls and gaps

- Python pytest disables network connections and dotenv loading through its test setup; consult `intelligence/conftest.py` and `pytest.ini`.
- The default Python suite excludes live Supabase tests; other manual/live/write diagnostics are not routine tests.
- Root `test-results/` is ignored as generated browser diagnostics. Preserve existing artifacts; inspect them only if necessary and redact sensitive content before sharing.
- `backend/.env.example` and `frontend/.env.example` have been restored as placeholder-only templates based on active configuration reads. Real `.env` values remain local and ignored; review templates whenever configuration names change.
- This is not a complete security review. No hosted environment, IAM policy, branch protection configuration, or current database catalog was verified here.
