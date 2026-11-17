# MedDecode Intelligence Service — Complete Forensic Audit

**Audit date:** 2026-11-14  
**Repository:** `C:/Users/dahiy/MedDecode-integration`  
**Branch observed:** `integration/full-project`  
**Scope:** source inspection and non-networked local tests only. No source, configuration, model, database, cloud service, or processing job was changed.

## 1. Executive summary

MedDecode has a real five-layer Python pipeline and a private FastAPI boundary, but it does **not** have five functional OCR providers. Five provider categories exist in source: EasyOCR, PaddleOCR, TrOCR, AWS Textract, and Google Cloud Vision. FastAPI instantiates only EasyOCR (`app/integration/http_service.py:25-33`). EasyOCR has prior repository-documented real local PDF/JPEG/PNG execution evidence. PaddleOCR is installed but current real inference was not established by this audit and repository status documentation records a Windows runtime failure. TrOCR lacks its `transformers` dependency and verified model assets. Textract and Vision have adapter tests using injected responses, no live inference evidence, and are not wired to FastAPI.

The HTTP endpoint does invoke all five *intelligence layers*: document/OCR, extraction, medicine understanding, catalogue matching, and recommendation ranking. That statement needs qualification: Layer 5 executes, but the live official repository supplies no alternatives and the Contract mapper deliberately emits empty `alternatives` and `recommendations`. Requested-analysis flags are structurally validated but do not control stage execution. Contract v1 is therefore structurally interoperable with Node but only partially expresses the internal pipeline.

The strongest safety properties are fail-closed request authentication, byte and image bounds, local model download prevention, conservative match classification, disagreement withholding, namespaced catalogue identifiers, and Node-side response validation before fenced persistence. The most important gaps are unbounded PDF page/rendered-pixel aggregation, non-cancellable native OCR/provider threads, missing quantitative handwriting evaluation, live catalogue privilege/query uncertainty, incomplete provenance/confidence serialization, and dormant duplicate implementations.

The offline suite was collected and executed: **283 tests passed, 1 Starlette/AnyIO deprecation warning**. `pytest.ini` excludes two live Supabase tests, `conftest.py` blocks network and dotenv loading, and top-level manual diagnostics are outside collection. Green tests establish deterministic behavior, not handwriting accuracy, live catalogue access, cloud OCR, or deployed resource performance.

## 2. Method and evidence boundaries

- Read all Python package trees, public definitions, requirements, pytest controls, runtime docs, Node HTTP client, worker composition and persistence handoff.
- Reused the immediately preceding audit checkpoint because source files were unchanged: `.venv/Scripts/python.exe -m pytest tests -q -p no:cacheprovider --basetemp <temporary>` returned `283 passed, 1 warning in 4.74s`; a fresh collection returned `283 tests collected`.
- Import/runtime probe: EasyOCR 1.7.2, PaddleOCR 3.7.0, PaddlePaddle 3.2.2, torch 2.6.0+cpu, FastAPI 0.136.1, PyMuPDF 1.28.2. CUDA unavailable. `boto3` and `transformers` were not importable. The `google` namespace was present, but Vision client import and live inference were not established.
- The current shell did not inherit the EasyOCR model-directory variable; the private `.env` contains the variable name, not evidence that every launch loads a valid directory. No secret values were printed.
- No genuine OCR was rerun. Repository evidence at `docs/integration-demo-status.md:5` records real local EasyOCR for synthetic PDF/JPEG/PNG with persisted local results, but explicitly says storage/auth were simulated and recognition accuracy was not measured.
- No hosted catalogue query was made. The previously reported connection identity proves authentication only, not query privileges or correctness.

## 3. Technical module inventory

### Entry points, integration and contracts

| Module | Important API | Actual role / callers | Runtime status and limitations |
|---|---|---|---|
| `app/main.py` | none | none | Empty; not an entry point (`README.md:18`). |
| `app/integration/http_service.py` | `lifespan`, `_initialize_model`, `/health`, `/ready`, `_process_document`, `/api/v1/intelligence/process` | Root launcher/Uvicorn; Node `HttpPythonIntelligenceClient` | Active FastAPI path; EasyOCR only; one request at a time; native work is not cancellable. |
| `app/integration/local_pdf_pipeline.py` | `_load_validated_document`, `process_local_pdf_to_contract_v1`, `process_local_pdf_with_hybrid_ocr_to_contract_v1` | FastAPI and local subprocess | Active hybrid path plus legacy Paddle default path. Fictional repository default is test/local-only; HTTP supplies official repository. |
| `app/integration/offline_pipeline.py` | `run_offline_pipeline`, `InMemoryMedicineRepository`, `synthetic_ocr_pages` | Hybrid/local pipeline and tests | Active layer orchestrator; fixture helpers are not HTTP fallbacks. |
| `app/integration/contract_v1.py` | `validate_request`, `synthetic_success`, `failure` | HTTP/local/test workers | Request validator; no Python success-response validator. |
| `app/integration/contract_v1_mapper.py` | `map_contract_v1` | offline pipeline | Active serializer; alternatives/recommendations empty, overall confidence null, status fixed to `completed_with_warnings`. |
| `app/integration/local_pdf_worker.py` | `main` | legacy/local Node subprocess option | Real local document worker; explicit EasyOCR/Textract/Vision selection; not the preferred HTTP path. |
| `development_fixture_worker.py`, `synthetic_worker.py`, `offline_pipeline_worker.py` | `main`/`process` | development/tests | Deliberately simulated; must not be represented as real OCR. |
| `local_pdf_worker.py`, `local_pdf_pipeline.py` | real local path | Node legacy composition/tests | Keep until HTTP migration is complete, then deprecate deliberately rather than silently. |

### Layer 1 and schemas

| Module | Important API | Purpose / output | Wiring and tests |
|---|---|---|---|
| `document_loader.py` | `get_document_type` | suffix-based legacy loader choice | Legacy path; dedicated tests. |
| `image_processor.py` | `load_and_normalize_image` | EXIF transpose and RGB | Legacy path; tests. Hybrid path has stricter decoding in `local_pdf_pipeline.py:99-129`. |
| `pdf_processor.py` | `load_pdf_as_images` | PyMuPDF page rendering | Active via `process_document`; multi-page but no page/aggregate-pixel cap (`pdf_processor.py:44-63`). |
| `pipeline.py` | `process_document`, `process_document_with_ocr` | decoding and legacy OCR loop | Active PDF/image decode; legacy Paddle default. |
| `ocr_engine.py` | `PaddleOCRLocalModelConfig`, `OCREngine` | PaddleOCR adapter to `OCRPageResult` | Implemented/tested with injected engine; real current inference unverified. |
| `hybrid_ocr.py` | provider protocols/classes, `HybridOCREngine`, reconciliation | parallel provider evidence, region crops and conservative fusion | Active coordinator, but FastAPI gives one EasyOCR provider. Tests use injected providers. |
| `google_vision_provider.py` | separate `GoogleVisionProvider` and transport | opt-in Vision adapter | Used by local worker and tests; duplicates a second implementation in `hybrid_ocr.py:389-435`. |
| `schemas/ocr.py` | `OCRBlock`, `OCRPageResult`, `UnverifiedNumberedRow` | downstream OCR representation | Active. Provider identity/alternatives are lost when converting reconciled output. |
| `schemas/prescription.py`, `schemas/medicine.py` | extraction and usage dataclasses | Layers 2–4 interchange | Active and tested. |

### Layers 2 and 3

| Package/module | Important API | Runtime behavior |
|---|---|---|
| `layer2_information_extraction/pipeline.py` | `extract_prescription_information` | Builds context; extracts date, doctor, facility, patient, medicines and general instructions (`:22-80`). |
| `document_context.py` | `PrescriptionDocumentContext.from_ocr_pages`, `_build_page_lines` | Groups blocks by vertical geometry and sorts left-to-right (`:53-83`, `:131-199`). |
| `medicine_extractor.py` | `extract_raw_medicines` | Rule-based form/strength/Rx detection and adjacent instruction attachment (`:13-166`, `:169-235`). |
| `field_extractors.py` | date/doctor/facility/patient functions | Regex/keyword metadata extraction; not model-based. |
| `instruction_extractor.py` | `extract_general_instructions` | Small supported general-instruction set. |
| `numbered_medicine_rows.py` | region inference/review row detection | Preserves uncertain numbered rows for review rather than confirming medicines. |
| `confidence.py`, `normalizers.py` | helper functions | Deterministic confidence/normalization. |
| `layer3_medicine_understanding/pipeline.py` | `understand_medicine_entry/entries` | Parser → normalizer → instruction parser (`:18-84`). |
| `medicine_parser.py` | `parse_medicine_entry` | Form, scalar strength, explicit component strengths; warns and leaves concentration ratio unknown (`:164-246`). |
| `medicine_normaliser.py` | name/form/strength normalization | Deterministic string/unit normalization; not spelling correction or medicine validation. |
| `instruction_parser.py`, `dosage_parser.py` | instruction schedule/timing/duration parsers | Numeric schedule, limited verbal frequency, food timing and duration patterns (`instruction_parser.py:11-86`). |

### Layer 4, datasets and database

| Package/module | Purpose | Wiring / risk |
|---|---|---|
| `runtime/pipeline.py` | retrieval → ranking → classification → explanation | Active in HTTP (`:45-135`). Conservative fixed-dose combination filter (`:67-82`). |
| `candidate_retriever.py` | exact normalized/alias/brand/generic then bounded prefix | Active, but official repository alias/brand methods return empty. |
| `candidate_ranker.py`, `match_classifier.py`, `explainability.py`, `normalizer.py` | deterministic matching score, status and warnings | Active and tested; score is not clinical probability. |
| `official_catalogue_provider.py` | direct PostgreSQL read-only repository | Active HTTP repository. Parameterized values, fixed SQL. Selects `entity_id,evidence,identity` and references `entity_type`; exact provider also references `identity_hash` (`:26-81`). |
| `runtime/repository.py` | Supabase HTTPS `MedicineRepository` | Default if no repository injected; not used by HTTP because HTTP injects direct repository. Live tests excluded. |
| `recommendation_data_provider.py`, `recommendation_flow.py` | Supabase-backed enrichment path | Not used by `run_offline_pipeline`; separate/dormant production design. |
| `runtime/__init__.py` and `runtime/schemas.py` | runtime dataclasses/enums | Duplicate definitions. Active code imports `runtime.schemas`; `runtime.__init__` is a conflicting legacy surface. |
| `database/catalogue_connection.py` | strict direct psycopg configuration | Active. Hosted requires verify-full, CA, credentials and non-privileged dedicated user (`:70-163`); connection opened by `connect_catalogue` (`:165`). No transaction-level read-only enforcement in code. |
| `database/supabase_client.py` | legacy service client | Used by legacy repository and ingestion utilities, not HTTP direct catalogue path. |
| `dataset_ingestion/*` | RxNorm, PMBI, NPPA, CDSCO/NLEM adapters, validation, merging, dry-run and explicit writers | Extensive offline/test tooling; not part of HTTP request execution. Presence does not prove hosted dataset freshness or activation. Writer modules are operationally dangerous and outside default runtime. |

### Layer 5

`layer5_recommendations/schemas.py`, `scoring.py`, and `pipeline.py` define price, ingredient, safety, brand/generic and manufacturer criteria. `RecommendationPipeline.rank` refuses unconfirmed Layer 4 identities (`pipeline.py:38-52`), requires ingredient evidence (`:56-73`), excludes dosage/ingredient conflicts, normalizes only available criterion weights, and warns that scores are not clinical suitability probabilities (`:137-173`). In HTTP composition the official repository supplies no alternatives, so ranking returns no alternatives; the mapper discards ranked output regardless.

### Tests and configuration

- `pytest.ini`: collects `tests/`, excludes `test_layer4_runtime_e2e.py` and `test_layer4_supabase_readonly.py`.
- `conftest.py`: disables network, clears Supabase environment and blocks dotenv loading.
- Test-definition counts by folder: integration 46, Layer 1 56, Layer 2 38, Layer 3 55, Layer 4 82, Layer 5 4. Parametrization produces 283 collected cases.
- Top-level `test_ocr_manual.py`, `test_real_prescription_e2e.py`, and `test_real_supabase_e2e.py` are manual diagnostics and not collected.
- `requirements.txt` is not a lockfile and leaves several heavy dependencies unpinned.
- Environment names: `MEDDECODE_INTERNAL_TOKEN`, `MEDDECODE_EASYOCR_MODEL_DIRECTORY`, `MEDDECODE_CATALOGUE_ENV/HOST/PORT/DATABASE/USER/PASSWORD/PASSFILE/SSLMODE/SSLROOTCERT/CONNECT_TIMEOUT_SECONDS`; legacy Supabase paths use `SUPABASE_URL` and `SUPABASE_KEY`.

## 4. Actual production execution call graph

```text
Node RealPrescriptionProcessor.process
  → WorkerDocumentReader.download (private S3 object to isolated local path)
  → HttpPythonIntelligenceClient.analyze
      → validateIntelligenceRequestV1
      → read local staged bytes
      → POST application/octet-stream + base64 Contract metadata
FastAPI process
  → constant-time bearer validation
  → Python validate_request
  → one-request gate + bounded streaming + magic signature
  → asyncio.to_thread(_process_document)
      → TemporaryDirectory + write document bytes
      → connect_catalogue
      → LocalOfficialCatalogueMedicineRepository
      → process_local_pdf_with_hybrid_ocr_to_contract_v1
          → _load_validated_document
              → PDF: process_document → load_pdf_as_images
              → image: Pillow verify/load/EXIF transpose/RGB or alpha-on-white
          → HybridOCREngine.recognize_page
              → EasyOCRProvider.recognize (only configured FastAPI provider)
              → optional EasyOCR numbered-region second pass
              → no handwritten provider configured
              → _reconcile → HybridOCRPageResult.to_ocr_page_result
          → run_offline_pipeline
              → Layer 2 extract_prescription_information
              → Layer 3 understand_medicine_entries
              → Layer 4 MedicineIntelligencePipeline.match_medicines
              → Layer 5 RecommendationPipeline.rank per medicine
          → map_contract_v1
      → close catalogue connection + delete temporary directory
  → JSON response
Node HttpPythonIntelligenceClient
  → bounded response read
  → JSON parse
  → validateIntelligenceResponseV1
RealPrescriptionProcessor
  → validates again and rejects failed response
  → fenced finalization.completeOwned or failOwned
```

Evidence: `http_service.py:76-97,100-153`; `local_pdf_pipeline.py:176-211`; `offline_pipeline.py:112-143`; Node client `http-python-intelligence.client.ts:22-52`; handler `real-prescription-worker.handler.ts:34-54,73-97`.

### Conditional degradation/skip branches

- Invalid authentication/metadata/type/signature/size stops before OCR (401/400/415/413).
- Initialization failure makes `/ready` and processing unavailable (503).
- Busy gate returns 429; transfer timeout 408; processing timeout 504.
- Any page provider failure or absence of predictions turns the entire request into sanitized 422 (`http_service.py:92-96,148-152`). This means the coordinator's partial-provider success policy is overridden by HTTP's stricter page-failure rule.
- OCR provider disagreement is omitted from downstream text (`hybrid_ocr.py:702-723`), preserving evidence only in `HybridOCRPageResult`; mapper does not serialize it.
- Missing medicine name yields `NOT_ATTEMPTED`; no candidates yields `UNMATCHED`; conflicts produce ambiguous/unmatched statuses.
- Layer 5 executes for each match, but unconfirmed matches or absent alternatives yield no ranked output. Mapper always emits empty alternatives and top-level recommendations.
- All four requested-analysis booleans are required by `contract_v1.validate_request`, but `_process_document` does not branch on them. They are effectively ignored.

## 5. Hybrid OCR forensic audit

| Provider | Implemented | Installed | Model available | FastAPI wired | Real inference tested | Handwriting support | Status |
|---|---|---|---|---|---|---|---|
| EasyOCR | Yes, `hybrid_ocr.py:167-237` | Yes, 1.7.2 | Prior local evidence; current shell variable absent | Yes, sole provider | Repository documents real synthetic PDF/JPEG/PNG | General OCR, no handwriting-specific validation | **VERIFIED** for current synthetic local path; handwriting unverified |
| PaddleOCR | Yes, `ocr_engine.py:28-177`, wrapper `hybrid_ocr.py:140-164` | Yes, 3.7.0/3.2.2 | Package installed; assets/runtime not freshly verified | No | Repository docs record Windows failure; injected tests only in current audit | General OCR claim not validated here | **PARTIAL / NOT WIRED** |
| TrOCR | Yes, region adapter `hybrid_ocr.py:240-285` | No `transformers` | No verified local model directory | No | Injected processor/model only | Intended handwritten line recognition; no detector or genuine test | **BLOCKED** |
| AWS Textract | Yes, `hybrid_ocr.py:288-386` | `boto3` not importable | Cloud service, no local model | No | Injected response/error tests only | Provider can label printed/handwriting; not validated | **BLOCKED / NOT WIRED** |
| Google Cloud Vision | Two adapter implementations (`hybrid_ocr.py:389-435`, `google_vision_provider.py:1-149`) | Namespace present; client import not established | Cloud service | No | Injected transport tests only | General document OCR; not validated | **PARTIAL / NOT WIRED** |
| Tesseract | No implementation found | Not assessed | None | No | No | No | **MISSING** |

**Do we really have five functional OCR providers? NO.** The source contains five categories, not five verified, configured providers. Repository documents do not define an authoritative original five-provider plan; the closest current set is EasyOCR/PaddleOCR/TrOCR/Textract/Vision. Tesseract and dedicated layout OCR are absent.

The coordinator can run whole-page providers concurrently (`hybrid_ocr.py:534-561`), crop detected lines for a handwriting provider (`:513-522,673-699`), and reconcile by bounding-box IoU and normalized exact text (`:702-723`). It does not calibrate provider confidences, perform edit-distance/word-level fusion, retain n-best token hypotheses, detect handwriting, or account for provider-specific bias. A running thread cannot be cancelled when its `Future.cancel()` returns false; `shutdown(wait=False)` returns while inference may continue. FastAPI additionally wraps the whole document in a non-cancellable thread.

## 6. Layer 1 document processing

| Capability | Status | Evidence / consequence |
|---|---|---|
| PDF/JPEG/PNG signatures and 10 MiB body | Implemented | `http_service.py:18-22,104-135`. |
| JPEG/PNG decode, single frame, dimensions/pixels | Implemented | `local_pdf_pipeline.py:107-129`; 10,000 side and 25M-pixel caps. |
| EXIF orientation and alpha handling | Implemented | `local_pdf_pipeline.py:121-128`. |
| PDF multi-page rendering | Implemented, unsafe bound gap | `pdf_processor.py:44-63`; all pages rendered into memory, no page or aggregate pixel limit. |
| Resolution | Fixed | HTTP uses 120 DPI (`http_service.py:89-91`); legacy default is 300 DPI. No quality-adaptive choice. |
| Deskew, denoise, contrast, grayscale, threshold, morphology | Not implemented in active path | No active transforms beyond EXIF/RGB/alpha. This avoids destructive thin-stroke thresholding, but offers little help for blur/skew/low contrast. |
| Layout and reading order | Partial | Block grouping by vertical coordinates then left-to-right (`document_context.py:131-199`); multi-column or curved handwriting may mix lines. |
| Segmentation | Partial | OCR boxes, numbered-region crop, and prediction-derived line crops; no handwriting/layout detector. |
| Confidence | Partial | Provider raw confidence preserved per prediction/block; simple line average; not calibrated across providers. |
| Provider failures | Conservative but inconsistent | Hybrid allows partial success; HTTP rejects if any page reports any provider failure. |

## 7. OCR output structure and information loss

`OCRPrediction` preserves engine name/version, page, text, polygon, raw confidence, style and model provenance (`hybrid_ocr.py:59-69`). `ReconciledOCRRegion` preserves alternatives and disagreement. `HybridOCRPageResult.to_ocr_page_result` only emits selected single-source/agreement predictions (`:90-124`), converting to `OCRBlock(text, confidence, bounding_box)`. Thus provider identity, alternatives, style, model provenance, elapsed time, and disagreement evidence do not reach Layers 2–5 or Contract v1. Page number is reconstructed by list position. Original crops stay in memory only. Exact normalized agreement is required; no word-level fusion occurs. IoU grouping uses the first group member as anchor, which can split or merge imperfect boxes.

The downstream schema can accept output from any number of providers after reconciliation, but it cannot preserve multi-provider evidence. Extending evidence requires a backward-compatible internal schema and carefully reviewed Contract representation, not simply adding providers.

## 8. Layers 2 and 3

Layer 2 is deterministic and layout-aware but heuristic. It recognizes a fixed set of dosage-form prefixes, strengths `mg/mcg/g/ml/iu/units/%`, Rx markers, limited metadata labels and instruction keywords (`medicine_extractor.py:13-166`). Inside Rx, permissive name syntax can create false positives; instruction keywords can create false negatives. The current line assembler assumes horizontally aligned blocks and ordinary reading order. Adjacent instruction association attaches to the most recent medicine and can misassociate multi-column or separated instructions. Quantity and route are not extracted into the Contract path. Confidence is propagated from OCR blocks but not statistically calibrated.

Layer 3 strips a `Medicine:` label, parses a bounded dosage-form vocabulary and scalar or component strengths (`medicine_parser.py:14-161,164-246`). It explicitly withholds concentration ratios that cannot fit the schema. Instruction parsing supports `x-x-x`, once/twice/thrice per day, explicit tablet/capsule dose quantity, after/before food and numeric day/week/month duration (`instruction_parser.py:11-86`). Common Indian shorthand such as OD/BD/TDS/QID/HS/SOS and route abbreviations is not comprehensively represented by the shown patterns; `SOS` is later recognized only by mapper string inspection. There is no probabilistic NER, lexicon-based spelling correction, or model-assisted parser. Layer 3 cannot prove that a plausible OCR string is a real medicine; Layer 4 must decide. Incorrect names may remain unmatched, ambiguously match a prefix, or incorrectly match a close catalogue name. Silent high-risk correction must remain prohibited.

## 9. Layer 4 intelligence and catalogue

HTTP uses direct psycopg with `LocalOfficialCatalogueMedicineRepository`, not the legacy Supabase repository. Queries are parameterized and bounded to 25 results, but exact/prefix searches inspect JSON name fields and order by entity ID, not relevance. Alias and brand methods return empty; ingredient enrichment is a no-op (`official_catalogue_provider.py:42-81`). Combination matching is conservative when explicit component strengths exist (`runtime/pipeline.py:67-82`). Matching score combines names, strength, form and ingredients; classifier can withhold ambiguous or low-scoring identities.

The dataset-ingestion tree has adapters/tests for RxNorm, PMBI, NPPA, CDSCO and NLEM-related data, but those are offline ingestion implementations, not proof that the live HTTP catalogue contains current or complete versions. The mapper itself warns package-price links are unavailable. WHO/ICMR integrations were not established.

`catalogue_connection.py` enforces hosted `verify-full`, CA file, timeout, credential presence and a dedicated non-privileged username. It does not issue `SET TRANSACTION READ ONLY`; least privilege depends on role grants. `README.md` documents column grants for `entity_id,evidence,identity`, but the live query also references `entity_type`, and `OfficialCatalogueProvider.find_exact_formulation` references `identity_hash`. The deployed role may already have those reviewed grants, but this audit did not query the host. Authentication evidence alone is insufficient. This is a deployment verification blocker, not evidence of failure.

## 10. Layer 5 recommendations and medical safety

The ranker is an information-ranking mechanism, not a personalized treatment engine. It requires a confirmed match and same active ingredients; it rejects form mismatch and warns on missing price/safety evidence. It has no patient-specific contraindication, allergy, interaction, pregnancy, renal/hepatic, pediatric or clinician-intent model. The live official repository provides no alternative candidates, and the Contract mapper emits empty alternatives/recommendations (`contract_v1_mapper.py:176,206`). Withholding is the correct behavior until catalogue identity and clinical equivalence evidence are proven.

Layer 5 runs in FastAPI, but its results only influence warnings. It should not be described as producing therapeutic recommendations. Price code exists, yet the active official repository does not provide verified formulation-package price relationships.

## 11. Contract v1 compliance

**Assessment: PARTIALLY COMPLIANT.** Correlation UUIDs, schema version, supported file types, nullable extraction fields, medicine arrays, match status/confidence, source-namespaced external ID, warnings and failed response shape are represented. Node validates success and failure responses (`intelligence-contract-v1.validator.ts:208+`) and verifies job/prescription correlation before fenced persistence.

Limitations:

- Python validates the request but has no full success-response validator; TypeScript is the enforcement boundary.
- Requested-analysis flags are required but ignored by execution.
- OCR engine provenance, alternate predictions, disagreement regions, page evidence and elapsed/model data are lost.
- `processing_metadata.overall_confidence` is always null; dataset/model versions are omitted by mapper.
- Alternatives and recommendations are always empty despite Layer 5 execution.
- Status is always `completed_with_warnings`, including cases where warnings might only be informational.
- Quantity is always null; route is not represented by current mapper.
- Metadata claims `authorized_url`, but HTTP intentionally receives already staged bytes and never fetches the URL. Node supplies a non-routable placeholder (`real-prescription-worker.handler.ts:20-25`). This is a controlled transport adaptation but semantically awkward.

## 12. FastAPI engineering audit

Positive controls: constant-time bearer comparison and 32-character minimum (`http_service.py:101-104`); 512-character auth-header bound; content type, metadata and magic bytes; 10 MiB streaming limit; 15-second transfer limit; one-request lock; 120-second response timeout; model preload with downloads disabled; temp directory and connection cleanup; no OpenAPI/docs; sanitized public errors. The application itself does not enforce loopback binding; the root launcher/Uvicorn command does.

Failure behavior: corrupt images fail through bounded decoder into 422; invalid PDFs are caught by PyMuPDF and sanitized; empty/magic-only content produces no OCR and 422; unsupported type 400/415; concurrent request 429; model/config failure 503; DB failure 422. Large images are bounded, but PDFs are not page/pixel bounded. A disconnected/timed-out request cannot cancel native OCR; the lock stays held until completion. Provider executor threads have the same limitation. Startup cancellation cancels the initialization coroutine, not necessarily the underlying thread. Root launcher uses forced process-tree termination, so graceful in-flight shutdown is not established. There is no structured operational logging; the HTTP service intentionally avoids content logging, but observability is weak.

## 13. Accuracy, handwriting and benchmark status

No repository-backed ground-truth benchmark covering handwriting, blur, skew, lighting, multi-column layouts and ambiguous medicine names was found. Existing synthetic fixtures are four small files and are not an annotated clinical-quality corpus. The default suite mocks provider inference or uses deterministic injected text. Repository docs explicitly state that prior real format tests did not inspect recognized medicine names or measure accuracy.

Therefore CER, WER, medicine exact match, extraction precision/recall/F1, strength/frequency/duration accuracy, false-positive rate, unsupported-correction rate, memory and representative latency are **unknown**. Earlier user-reported benchmark values were not found in an attributable repository artifact and are not used as authoritative audit evidence. Handwriting support is unverified: no handwriting detector, no TrOCR runtime, no genuine handwritten dataset, and only English EasyOCR is configured.

Required evaluation infrastructure: versioned fictional/deidentified images; transcription plus medicine/span/strength/instruction annotations; document-quality labels; fixed provider/model versions; identical render/preprocessing; per-field metrics and abstention/error-severity analysis; cold/warm latency, peak RSS/VRAM; reproducible run manifest; protected error review. Clinical adjudication is needed for safety-sensitive labels.

## 14. Performance and resources

EasyOCR is preloaded once and reused. FastAPI serializes documents, avoiding overlapping CPU/memory load. PDF rendering and images are held in lists, and providers receive image copies. Parallel five-provider execution would multiply page images, model memory and threads; no measured RAM budget proves feasibility. Torch is CPU-only in this environment. The 120-second Node and FastAPI deadlines align, creating little margin for response transfer/finalization. Provider timeout is 60 seconds under FastAPI, but a timed-out thread may continue. Direct catalogue creates one connection per request and closes it; no pool is used, appropriate for serialized low volume but unbenchmarked.

Recommended measurements: cold model load, warm per-page p50/p95, peak RSS per provider and per rendered page, PDF page scaling, connection latency, timeout overrun and shutdown duration. Do not run five models in parallel until these budgets exist.

## 15. Security, privacy and safety

No patient document was accessed. HTTP receives bytes from the restricted Node worker rather than arbitrary paths/URLs. Temporary files are scoped and cleaned after native work exits. Public errors do not expose OCR text or credentials. Cloud OCR is disabled unless explicitly selected in the local worker; FastAPI cannot invoke it. EasyOCR runtime download is disabled. Direct catalogue configuration rejects privileged/common roles and insecure hosted TLS.

Risks: PDF resource exhaustion; native timeout overrun; no application-level loopback assertion; `.env` contains secret-bearing settings and must remain ignored/protected; legacy manual diagnostics can print OCR/medical content; legacy Supabase/ingestion paths can write and must stay outside runtime; no dependency lock/SBOM; clinical uncertainty evidence is reduced during serialization; no patient-specific safety engine. Cloud OCR must require separate data-transfer, retention, region, identity and cost approval.

## 16. Test coverage

The 283-case offline suite covers request validation, mapper semantics, image security, HTTP auth/limits/gate behavior, deterministic hybrid fusion, provider error classification, extraction/parsing rules, matching, dataset transforms and recommendation rules. Cloud tests inject transports. TrOCR/EasyOCR adapter tests inject model objects. HTTP tests monkeypatch initialization and `_process_document`; one controlled fixture exercises actual layers with an injected OCR provider and in-memory catalogue. The default suite intentionally prevents network.

Missing: real model initialization regression, genuine handwriting inference, live restricted catalogue queries, full HTTP with real EasyOCR and database under pytest, PDF bombs/page caps, process cancellation, resource benchmarks, confidence calibration, multi-column reading order, provider-specific accuracy, clinical adjudication, source freshness, and Layer 5 runtime serialization. Manual/live tests were skipped per safety rules.

## 17. Duplication and dead/dormant code register

| Item | Evidence | Disposition |
|---|---|---|
| Two Google Vision providers | `hybrid_ocr.py:389-435`; `google_vision_provider.py:1-149`; local worker imports latter | **REFACTOR** after behavior parity tests. |
| Duplicate runtime schemas | `runtime/__init__.py` and `runtime/schemas.py`; active imports target schemas | **DEPRECATE** legacy `__init__` definitions after import audit. |
| Legacy Paddle pipeline | `process_local_pdf_to_contract_v1` and `process_document_with_ocr` | **KEEP/INVESTIGATE** until HTTP replacement and migrations complete. |
| Legacy Supabase repository/enrichment | `runtime/repository.py`, `recommendation_data_provider.py`, `recommendation_flow.py` | **INVESTIGATE**; not HTTP direct path, may serve tools/tests. |
| Development/synthetic workers | explicit fixture modules | **KEEP** with strict development labeling. |
| Empty `app/main.py` | no runtime use | **DEPRECATE/REMOVE** only after packaging review. |
| Dataset writers and real diagnostics | manual modules excluded from tests | **KEEP** as controlled admin tooling; separate package/entry points recommended. |
| Requested-analysis flags | validated but unused | **REFACTOR** contract execution semantics. |
| Duplicate Google dependency entries/unpinned stack | requirements declaration | **INVESTIGATE** reproducible lock and compatibility. |

## 18. Target OCR architecture options

### A. Sequential fallback

EasyOCR first, then PaddleOCR on low-confidence pages, then handwriting recognizer on unresolved crops. Lowest average resource use and privacy-friendly. Weakness: first-provider boxes control later regions, confidence is uncalibrated, and error latency accumulates. Good transitional design.

### B. Parallel ensemble

EasyOCR, PaddleOCR and optional handwriting model on every page; fuse all predictions. Best evidence diversity in theory, but highest RAM/CPU/GPU/latency; cloud providers add privacy/cost. Current exact-text/IoU fusion is too primitive, and the environment has no demonstrated capacity. Not recommended initially.

### C. Adaptive routing with targeted fallback and evidence fusion — recommended

Run one validated local detector/recognizer, classify page/regions by print/handwriting and quality, escalate only uncertain line/medicine regions to a second local recognizer and optional handwriting model, retain n-best evidence and abstain on material disagreement. Catalogue cross-validation can raise or lower identity confidence but must never silently rewrite OCR. Cloud is a separately consented last resort. This fits current provider protocols and conservative reconciliation while controlling latency and privacy.

The five current categories can remain candidates, not a quota. Start with EasyOCR + validated PaddleOCR fallback + local handwriting recognizer. Treat Textract/Vision as optional policy-gated adapters. Add layout/handwriting detection as routing, not falsely count it as OCR provider six.

## 19. Prioritized gap register

| ID | Pri | Component / location | Expected vs actual | Impact / root cause | Proposed solution, tests, owner |
|---|---|---|---|---|---|
| IA-001 | P0 | PDF render, `pdf_processor.py:44-63` | Bounded document resources; all pages rendered without page/pixel aggregate cap | Malicious/large PDF can exhaust memory before HTTP byte limit helps | Add page, dimension and aggregate pixel caps before/while rendering; bomb/multipage tests. Medium, low contract risk. **Copilot**. |
| IA-002 | P0 | Medical output evidence, `contract_v1_mapper.py:161-218` | Preserve uncertainty/provenance; provider disagreement and model evidence discarded, overall confidence null | User may see output without the evidence needed to interpret OCR uncertainty | Preserve internal evidence and warnings; agree backward-compatible Contract mapping with code owner; tests for conflict/abstention. High, contract risk. **Shared**. |
| IA-003 | P1 | Native cancellation, `http_service.py:139-152`, `hybrid_ocr.py:540-560` | Deadline stops resource use; thread continues | Capacity lockout and shutdown delay | Isolate OCR in killable supervised process or provider-native cancellation; timeout/leak/shutdown tests. High. **Copilot + code owner**. |
| IA-004 | P1 | Catalogue privileges/query, `official_catalogue_provider.py:60-68`, README grant | Verified least privilege; live query columns exceed documented minimum | Production matching may fail despite successful login | Reconcile reviewed column grants and run read-only exact/prefix tests; no admin fallback. Low/medium. **Code owner**. |
| IA-005 | P1 | Handwriting | Genuine measured recognition; no detector/model/assets/evaluation | Main handwriting objective unproven | Build labeled benchmark first, then validate local handwriting recognizer and routing. High. **Copilot**. |
| IA-006 | P1 | Requested analysis, `contract_v1.py:8-13`, HTTP path | Flags control requested work; all stages always run | Contract behavior surprising and needless processing | Define supported semantics; gate or reject unsupported combinations; tests. Medium. **Shared**. |
| IA-007 | P1 | Layer 5 serialization | Safe evidence-backed information; ranking runs but output dropped | Feature is incomplete, and enabling directly could create unsafe equivalence claims | Keep withheld until equivalence/provenance policy and schema tests exist. High. **Shared**. |
| IA-008 | P2 | PDF/image preprocessing | Quality-adaptive non-destructive transforms; only orientation/RGB | Skew/blur/low contrast degrade OCR | Benchmark deskew/contrast variants with stroke/decimal preservation. Medium. **Copilot**. |
| IA-009 | P2 | Fusion/output schema | Calibrated word/line evidence; exact text + IoU and early reduction | Multi-provider evidence not exploitable downstream | Calibrate per provider, retain n-best and region evidence; fusion tests. High. **Copilot**. |
| IA-010 | P2 | Layer 2/3 rules | Indian format/abbreviation coverage; limited deterministic grammar | Missed or mis-associated schedules and names | Expand only from labeled fixtures, preserve unknowns; field precision/recall. Medium. **Copilot**. |
| IA-011 | P2 | Dependencies | Reproducible compatible stack; heavy packages unpinned/missing | Drift and insecure/non-repeatable deployments | Produce lock, license/SBOM and clean-environment tests. Medium. **Copilot/code owner**. |
| IA-012 | P2 | Duplicate code | Single schemas/provider; duplicate surfaces | Divergence and inconsistent fixes | Consolidate after compatibility tests. Medium. **Copilot**. |
| IA-013 | P2 | Observability | Safe metrics; little structured logging | Failures/latency hard to diagnose | Content-free stage timings, provider status and correlation IDs. Medium. **Shared**. |
| IA-014 | P3 | Optional cloud OCR | Explicit governed escalation; adapters dormant | Potential quality benefit with privacy/cost risk | Provider-specific approval, DPI/region/retention/cost controls and synthetic canary. High. **Code owner/security**. |

P0 IA-002 is about loss of safety evidence, not proof that the current synthetic result is clinically unsafe. Current alternatives/recommendations remain withheld, which reduces immediate harm.

## 20. Copilot implementation roadmap

### Phase I — critical interfaces and safety

Modules: `pdf_processor.py`, `local_pdf_pipeline.py`, `http_service.py`, `hybrid_ocr.py`, mapper/contract boundary. Add render budgets, killable execution design, requested-analysis semantics and evidence-preserving internal schema. Acceptance: abuse and timeout tests pass; no output loses a material disagreement; existing Node contract remains compatible or is separately approved. Roll back by feature-gated old path and schema compatibility.

### Phase II — evaluation and quantitative baseline

Create a versioned fictional/deidentified annotated corpus and benchmark harness. Acceptance: reproducible CER/WER, entity and field metrics, abstention, p50/p95 and peak memory by document class. No application changes required. Rollback: remove only generated benchmark artifacts, retain manifests.

### Phase III — provider completion

Validate PaddleOCR compatibility; provision pinned TrOCR/handwriting assets locally; consolidate Vision adapter; keep cloud disabled. Acceptance: cold/warm initialization and real inference on benchmark fixtures, no runtime downloads, deterministic provider failure behavior. Rollback: provider config exclusion.

### Phase IV — handwriting and adaptive routing

Add quality/handwriting/layout routing and targeted fallback with evidence fusion. Acceptance: statistically meaningful improvement on held-out handwriting without unacceptable printed regression, latency/memory inside budgets, conflict abstention. Rollback: EasyOCR-only routing flag.

### Phase V — Layers 2 and 3

Use benchmark failures to expand line association, medicine/form/strength and instruction grammars. Acceptance: per-field precision/recall improvement, no unsupported correction, adversarial decimal/unit tests. Rollback: versioned rule sets.

### Phase VI — Layer 4

Verify least-privilege exact/prefix queries, provenance and live dataset versions; improve bounded relevance without fuzzy auto-selection. Acceptance: read-only identity tests and matched/ambiguous/unmatched fixtures with stable identifiers. Rollback: exact-only matching mode.

### Phase VII — Layer 5

Define medicine information versus clinical advice; expose only source-backed non-equivalence information. Acceptance: no alternative without verified formulation/ingredient/form/strength evidence, provenance and warnings; clinician/safety review. Rollback: keep arrays empty.

### Phase VIII — end-to-end release readiness

Run real local FastAPI with model and restricted catalogue, Node Contract validation, fenced persistence and authenticated retrieval using fictional documents. Include failures, cross-owner denial, resource/timeout/shutdown and no-cloud proofs. Rollback: disable intelligence service/worker flags; preserve historical results.

## 21. Final verification matrix

| Area | Status | Evidence |
|---|---|---|
| FASTAPI_SERVICE | **PARTIAL** | Auth/bounds/gate/tests verified; native cancellation, PDF aggregate bounds and live dependency path incomplete. |
| HYBRID_OCR_IMPLEMENTATION | **PARTIAL** | Coordinator/fusion tested with injected providers; FastAPI uses one provider. |
| FIVE_OCR_PROVIDERS | **MISSING** | Five categories in code, only EasyOCR has real repository-documented inference evidence. |
| HANDWRITTEN_PRESCRIPTION_SUPPORT | **UNVERIFIED** | No genuine handwriting corpus/model runtime/detector. |
| LAYER_1_DOCUMENT_PROCESSING | **PARTIAL** | Real supported formats and EasyOCR path; preprocessing/resource gaps. |
| LAYER_2_INFORMATION_EXTRACTION | **PARTIAL** | Deterministic tests pass; representative real Indian formatting accuracy unknown. |
| LAYER_3_MEDICINE_UNDERSTANDING | **PARTIAL** | Rules tested; limited grammar and no model/clinical validation. |
| LAYER_4_MEDICINE_INTELLIGENCE | **PARTIAL** | Direct repository/matcher tested offline; live query privilege/data freshness unverified here. |
| LAYER_5_RECOMMENDATIONS | **PARTIAL** | Ranker tested; active path has no alternatives and mapper withholds output. |
| CONTRACT_V1_COMPATIBILITY | **PARTIAL** | Node validation/persistence boundary exists; provenance, metadata and feature semantics incomplete. |
| CATALOGUE_DIRECT_POSTGRESQL | **PARTIAL** | Strict config and prior login evidence; actual query permissions not verified in this audit. |
| MEDICAL_SAFETY_HANDLING | **PARTIAL** | Conservative matching/withholding; no patient-specific safety engine and evidence reduction remains. |
| OCR_BENCHMARK_QUALITY | **MISSING** | No attributable, representative ground-truth benchmark artifact. |
| READY_FOR_COPILOT_IMPLEMENTATION | **YES** | Gap register and phased safety-first roadmap are actionable; implementation must begin with P0/P1 controls and evaluation. |

