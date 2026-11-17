# FastAPI processing execution trace

`app/integration/http_service.py` is the independent service entry. At startup `_initialize_model` constructs `EasyOCRProvider` and `HybridOCREngine(whole_page_providers=(provider,), max_parallel_providers=1)` and preloads the local model. There is no automatic provider fallback.

1. POST `/api/v1/intelligence/process`: compares a bearer token via `hmac.compare_digest`, validates content type and base64 request metadata via `contract_v1.validate_request`. Rejected requests return sanitized HTTP status.
2. Gate acquisition is bounded; a second request receives 429. Streams bytes with a 15 s transfer bound, 10 MiB max, metadata max 8192 and PDF/JPEG/PNG signature check.
3. `_process_document` stages only supplied bytes in a temporary directory, connects the configured restricted catalogue and calls `process_local_pdf_with_hybrid_ocr_to_contract_v1` with 120 DPI and `LocalOfficialCatalogueMedicineRepository`.
4. `_load_validated_document` decodes image with format, frame, size and EXIF/alpha checks, or renders PDF through `process_document`/`load_pdf_as_images`. PDF pages are rendered as a list without an explicit page/pixel cap.
5. `HybridOCREngine.recognize_page` invokes EasyOCR; optional numbered-region review and reconciliation run. Configured whole-page predictions become `OCRPageResult`; missing output or any page provider failure fails the HTTP processing call.
6. `run_offline_pipeline`: `extract_prescription_information` -> `understand_medicine_entries` -> `MedicineIntelligencePipeline.match_medicines` -> `RecommendationPipeline.rank` for each result. HTTP passes the official repository, not the fictional default.
7. `map_contract_v1` returns source identifiers, warnings, extracted fields and confidence; deliberately empty alternatives/recommendations and null unsupported fields. Python request validation is not a response schema validation. Node's `backend/src/services/http-python-intelligence.client.ts` validates responses before authorized persistence; no live full-chain validation was executed in this audit.
8. `TemporaryDirectory` and connection close on completion. Errors are mapped to sanitized 422, timeout to 504. `asyncio.shield` retains gate until the native OCR task actually exits; timeout is not cancellation.

`/health` is liveness; `/ready` checks initialized model, token and catalogue configuration rather than an actual catalogue query. Legacy PaddleOCR path and optional cloud/TrOCR adapters are bypassed by this HTTP composition. Output is not persisted by Python.
