# MedDecode Copilot Phase 1 Intelligence Baseline

## Scope and safety boundary

This baseline documents the current local-first OCR and intelligence status for the MedDecode Python service without altering the FastAPI contract or Codex-owned entry points. The current evidence is derived from the repository's Python tests, the current OCR provider implementations, and the audited pipeline behavior in the intelligence layer package.

## 1. Current provider inventory

| Provider | Status in repo | Runtime state | Evidence | Notes |
| --- | --- | --- | --- | --- |
| EasyOCR | Active local provider | Verified for local synthetic OCR path | Local EasyOCR reader is invoked in the hybrid OCR pipeline and covered by tests | Only provider currently wired into the default FastAPI execution path |
| PaddleOCR | Installed but not actively routed | Partial | Package and adapter code exist; real local inference is not fully verified in this environment | Local model assets and runtime viability must be validated before enabling |
| TrOCR | Implemented region adapter | Blocked | Code is present but local transformers model assets are not established in the current environment | Intended for handwritten line recognition, not full-page OCR |
| AWS Textract | Adapter present, disabled by default | Verified mock only | Adapter response parsing and safe failures are covered by injected tests | Cloud path remains opt-in and disabled by default |
| Google Cloud Vision | Adapter present, disabled by default | Verified mock only | Adapter parsing and safe failure handling are covered by injected tests | Cloud path remains opt-in and disabled by default |

## 2. Real execution evidence

### EasyOCR

- Reader initialization is lazy and guarded against automatic downloads.
- Existing tests exercise local synthetic OCR flow with injected EasyOCR readers.
- Pipeline behavior is validated through the contract-v1 PDF path and the hybrid OCR reconciliation logic.
- Real handwriting performance is not established; the environment does not provide a validated handwritten benchmark.

### PaddleOCR

- Adapter is implemented with an explicit local model configuration and CPU-only validation.
- The current repository evidence shows the code is available, but local real inference remains partially validated.
- No live inference claim is made without model availability and fresh execution evidence.

### TrOCR

- The handwritten provider is implemented and guarded by a no-download local asset requirement.
- The environment lacks verified local model assets and the required transformers runtime for genuine inference.
- The provider remains blocked as a handwritten OCR path until a valid local checkpoint is available.

### Cloud adapters

- AWS Textract and Google Vision adapters include safe error parsing and disabled-by-default guards.
- They are intentionally not treated as authenticated or production-ready in this phase because no live cloud call is permitted.
- The only evidence is mocked adapter-level correctness, not live cloud execution.

## 3. Five-layer execution matrix

| Layer | Role | Current state | Evidence |
| --- | --- | --- | --- |
| Layer 1 | Document processing and OCR routing | Verified | Synthetic PDF rendering and hybrid OCR reconciliation tested locally |
| Layer 2 | Information extraction | Verified | Extraction and parsing from OCR output is exercised in the existing suite |
| Layer 3 | Medicine understanding | Verified | Medicine normalization and label parsing covered by contract-v1 behavior tests |
| Layer 4 | Medicine intelligence | Verified | Catalogue matching and normalization logic covered by existing isolated contract tests |
| Layer 5 | Recommendation logic | Verified | Recommendation rules and fallback behavior exercised by the Python suite |

## 4. Existing algorithmic fixes and safe defects addressed

1. Hardened the Google Vision transport in the hybrid OCR layer so missing `error` metadata no longer creates a risky attribute access on a malformed provider response.
2. Kept cloud providers opt-in and fail closed rather than inventing OCR results.
3. Preserved evidence reconciliation semantics: conflicting predictions remain visible to review but do not silently override the downstream medicine extraction path.
4. Kept EasyOCR as the default local OCR path, while leaving optional providers deliberately disconnected from the default service entry point.

## 5. Benchmark fixtures and methodology

The project already supports a synthetic benchmark design for evaluation, but the handwritten benchmark subset remains incomplete. The current benchmark structure is suitable for:

- clean printed prescriptions
- simple mixed print/handwriting samples
- low-risk synthetic OCR validation
- deterministic provider conflict checks

The missing piece is a representative, privacy-safe handwritten corpus with exact transcription and field-level medicine labels. Until that exists, the handwritten benchmark remains incomplete and must be reported as such.

## 6. Measured baseline metrics

The current baseline uses the existing deterministic local test suite rather than claiming clinical accuracy. The repository suite validates:

- OCR block extraction and text reconciliation
- medicine-name parsing and label extraction
- safe disagreement handling
- provider failure classification
- contract-v1 output mapping

The current repository evidence does not support broad clinical accuracy claims or a real handwritten OCR performance number.

## 7. Missing model dependencies and blockers

- TrOCR requires a local `transformers` runtime and model assets; these are not established in the current environment.
- PaddleOCR requires explicit local model directories and real inference verification before being marked as viable.
- AWS and Google adapters remain mocked only and remain intentionally off.
- Handwriting benchmark assets are missing or incomplete.

## 8. Handwriting limitations

- There is no verified handwriting detector.
- There is no validated TrOCR handwritten inference path.
- No representative handwriting ground-truth benchmark is available.
- The current pipeline can preserve evidence and abstain on disagreement, but it cannot yet claim robust handwritten prescription recognition.

## 9. Cloud adapter readiness

Cloud OCR remains intentionally disabled by default. The repository adapters are ready for future policy-gated activation, but they do not represent a verified live-production path. Any future activation requires explicit user/operator authorization, a governance review, and an approved contract change before sending prescription data beyond the local service.

## 10. Proposed adaptive routing interfaces

The next phase should keep the current contract stable and introduce a local-only adaptive routing layer with a conservative design:

1. Analyze document quality and the page layout.
2. Run a primary local provider (default EasyOCR).
3. Review uncertain text or medicine areas.
4. Run selective local fallback only when the routing policy explicitly justifies it.
5. Preserve provider evidence and disagreement rather than inventing a single answer.
6. Require a separate review gate before any cloud OCR invocation.

No contract-v1 field changes are proposed in this phase.

## 11. Exact files modified

- `app/layer1_document_processing/hybrid_ocr.py`
- `tests/layer1/test_hybrid_ocr.py`
- `docs/COPILOT_PHASE1_INTELLIGENCE_BASELINE.md` (this file)

## 12. Tests executed

- `intelligence/.venv/Scripts/python.exe -m pytest -q`

Result: 283 passed.

## 13. Risks and regressions

- EasyOCR remains the only provider with a clear local path in the default service.
- PaddleOCR and TrOCR are still not validated for real local inference.
- Cloud adapters are mocked only and remain intentionally off.
- No claim is made for handwriting or real clinical accuracy in the absence of a representative benchmark.

## 14. Next implementation phase

1. Validate PaddleOCR with explicit local model assets and no-download constraints.
2. Provision an approved handwritten model/processor path for TrOCR.
3. Create and label a privacy-safe handwriting benchmark subset.
4. Add a routing layer that compares evidence without inventing medicine matches.
5. Keep cloud OCR behind a separate consent gate and a reviewed contract change.

## 15. Required coordination with Codex

- Do not modify Codex-owned HTTP entry points.
- Preserve the existing FastAPI contract.
- Keep all cloud provider activation behind policy-gated controls.
- Restrict runtime model downloads and sensitive document handling to the local service boundary.

## Final status

EASYOCR: VERIFIED

PADDLEOCR: PARTIAL

TROCR: BLOCKED

AWS_TEXTRACT_ADAPTER: VERIFIED_MOCK

GOOGLE_VISION_ADAPTER: VERIFIED_MOCK

LAYER_1: VERIFIED

LAYER_2: VERIFIED

LAYER_3: VERIFIED

LAYER_4: VERIFIED

LAYER_5: VERIFIED

HANDWRITING_BENCHMARK: MISSING

READY_FOR_ADAPTIVE_HYBRID_OCR_IMPLEMENTATION: NO
