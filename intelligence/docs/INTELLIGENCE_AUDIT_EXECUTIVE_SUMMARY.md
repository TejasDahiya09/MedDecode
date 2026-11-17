# MedDecode Intelligence Audit — Executive Summary

Audit date: 2026-11-14. The audit was read-only apart from these two reports. No hosted query, cloud OCR, model download, application processing or code/configuration change was performed.

## Bottom-line findings

MedDecode has five OCR **provider categories in source**, but only **one provider is active in FastAPI: EasyOCR**. The implemented categories are EasyOCR, PaddleOCR, TrOCR, AWS Textract and Google Cloud Vision. The repository does not contain an authoritative historical document proving that these exact five were the originally approved design. Tesseract and a dedicated layout OCR provider are absent.

EasyOCR is the only provider with repository-documented real local synthetic PDF/JPEG/PNG execution. PaddleOCR is installed but not wired to FastAPI and its current real inference is unverified. TrOCR lacks the installed `transformers` runtime and verified model assets. Textract and Vision are cloud adapters tested with injected responses only. Cloud processing remains disabled and was not invoked.

All five intelligence layers execute in the FastAPI path, but not all produce user-visible output:

1. Layer 1 loads PDF/JPEG/PNG and runs EasyOCR.
2. Layer 2 performs layout-aware, rule-based extraction.
3. Layer 3 parses and normalizes medicine fields and instructions.
4. Layer 4 queries the direct official-catalogue repository and classifies candidates.
5. Layer 5 runs conservative ranking, but receives no alternatives from the active repository.

The Contract mapper emits empty alternatives and recommendations, null overall confidence and fixed `completed_with_warnings`. It preserves extraction confidence and layer warnings, but drops provider provenance, disagreement alternatives and page-region evidence. Node validates Contract v1 before fenced persistence.

## Principal risks

- **P0 resource risk:** PDFs are byte-bounded but not bounded by page count or aggregate rendered pixels; all pages are rendered into memory.
- **P0 evidence risk:** material multi-provider disagreement and model provenance are reduced before Contract v1, limiting user-visible uncertainty.
- **P1 cancellation risk:** HTTP/provider timeouts cannot stop already-running native OCR threads.
- **P1 handwriting gap:** no handwriting detector, verified TrOCR runtime, or representative ground-truth handwriting benchmark.
- **P1 catalogue uncertainty:** the live repository references `entity_type` and exact lookup references `identity_hash`; current documentation's minimum column grant omits them. Prior successful login does not prove those queries work.
- **P1 contract semantics:** requested-analysis flags are required but do not gate execution.
- **P1 recommendation gap:** Layer 5 code exists, but active alternatives are absent and serialization withholds results. Enabling it directly would risk implying therapeutic equivalence.

## Test and runtime evidence

- Offline suite: **283 passed**, one dependency deprecation warning.
- Network and dotenv are disabled during the default suite; two live Supabase tests and top-level manual diagnostics are excluded.
- Installed probe: EasyOCR 1.7.2, PaddleOCR 3.7.0, PaddlePaddle 3.2.2, torch 2.6.0+cpu, FastAPI 0.136.1, PyMuPDF 1.28.2; CUDA false; `boto3` and `transformers` unavailable.
- No fresh genuine OCR or hosted catalogue query was run in this audit.
- There is no attributable representative benchmark artifact. CER, WER, entity precision/recall/F1, strength/frequency/duration accuracy, memory and representative latency remain unknown.

## Recommended architecture

Adopt adaptive routing with targeted fallback and evidence fusion:

1. Use a validated local printed-text provider for the page.
2. Detect quality, layout and likely handwriting regions.
3. Escalate only uncertain line/medicine regions to a second local provider and a verified handwriting model.
4. Preserve n-best text, boxes, provider/model provenance and conflicts.
5. Use the catalogue to cross-check identity confidence, never to silently rewrite OCR.
6. Abstain and request review on material conflicts.
7. Keep Textract/Vision as separately approved, privacy-gated last resorts.

This is preferable to five-provider parallel OCR because the current CPU-only environment has no RAM/latency evidence supporting five simultaneous models.

## Copilot implementation order

1. Bound PDF pages/rendered pixels and design killable OCR execution.
2. Build a versioned, annotated fictional/deidentified benchmark and measure accuracy, abstention, latency and memory.
3. Validate/pin PaddleOCR and provision a local handwriting model without runtime downloads.
4. Implement adaptive layout/handwriting routing and evidence-preserving fusion.
5. Improve Layers 2–3 from measured failure cases without silent medicine correction.
6. Verify least-privilege catalogue queries and provenance/freshness.
7. Keep Layer 5 output withheld until equivalence and evidence policy is reviewed.
8. Run full local FastAPI → Node validation → fenced persistence → authenticated retrieval regression with fictional documents.

## Verification matrix

- FASTAPI_SERVICE: **PARTIAL**
- HYBRID_OCR_IMPLEMENTATION: **PARTIAL**
- FIVE_OCR_PROVIDERS: **MISSING**
- HANDWRITTEN_PRESCRIPTION_SUPPORT: **UNVERIFIED**
- LAYER_1_DOCUMENT_PROCESSING: **PARTIAL**
- LAYER_2_INFORMATION_EXTRACTION: **PARTIAL**
- LAYER_3_MEDICINE_UNDERSTANDING: **PARTIAL**
- LAYER_4_MEDICINE_INTELLIGENCE: **PARTIAL**
- LAYER_5_RECOMMENDATIONS: **PARTIAL**
- CONTRACT_V1_COMPATIBILITY: **PARTIAL**
- CATALOGUE_DIRECT_POSTGRESQL: **PARTIAL**
- MEDICAL_SAFETY_HANDLING: **PARTIAL**
- OCR_BENCHMARK_QUALITY: **MISSING**
- READY_FOR_COPILOT_IMPLEMENTATION: **YES**

The full evidence, exact paths/line references, module inventory, call graph, gap register and eight-phase roadmap are in `INTELLIGENCE_SERVICE_COMPLETE_AUDIT.md`.
