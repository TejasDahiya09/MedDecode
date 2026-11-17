# Intelligence audit ? 2026-11-14

Scope: repository inspection and local offline Python tests. No hosted database or OCR provider call was made in this audit. Existing uncommitted work was preserved. A 283-test suite passed (1 dependency deprecation warning) using `.venv/Scripts/python.exe -m pytest tests -q -p no:cacheprovider --basetemp <temporary-directory>`. These tests include mock/injected boundaries and do not establish clinical accuracy. No fresh genuine OCR run was made; prior local synthetic PDF/JPEG/PNG persistence is documented in `docs/integration-demo-status.md`, with simulated storage/auth and no measured recognition accuracy. User-reported earlier 7-case benchmark numbers were not independently reproduced or located in an attributable artifact; do not treat them as verified.

## Layers and gaps

1. Layer 1: PDF via PyMuPDF and JPEG/PNG via Pillow; EXIF orientation and alpha normalization for images. HTTP renders PDF at 120 DPI. Image size is bounded but `pdf_processor.load_pdf_as_images` renders all pages into memory without a comparable explicit page or rendered pixel limit. No verified deskew, layout understanding or handwriting classification in the HTTP path. Numbered-region review exists; it is not equivalent to handwriting recognition. Hybrid conflicts are withheld from normal OCR output.
2. Layer 2: `extract_prescription_information`, OCR line grouping and rule-based `extract_raw_medicines`, context, fields, numbered-row review and confidence. Handwriting, complex tables and OCR-corrupted names are not clinically validated. Explicit quantity/route completeness needs fixture-based assessment.
3. Layer 3: `understand_medicine_entries`, `parse_medicine_entry`, `parse_medicine_instructions`, normalization of form, strength, schedules and duration. Rules and heuristics do not establish clinical correctness; ambiguity should remain visible.
4. Layer 4: `MedicineIntelligencePipeline` uses `LocalOfficialCatalogueMedicineRepository` on HTTP; matching uses bounded exact/prefix lookup and scoring/classification. Brand/alias methods explicitly return empty; ingredient enrichment is a no-op. No credible live hosted query was made in this audit. Missing catalogue access causes request failure, not a fictional-catalogue fallback. Official dataset ingestion modules do not establish that all sources or price links are active.
5. Layer 5: `RecommendationPipeline.rank` runs on each match, but official repository supplies no alternative list in this composition. Mapper emits `alternatives: []` and `recommendations: []`; warnings are mapped. Candidate scoring is not evidence of therapeutic equivalence, contraindication checking or safe clinical recommendations.

## Security and performance

Bearer comparison is constant-time, minimum token length 32; FastAPI checks byte signatures, 10 MiB body, metadata bound, stream timeout, one concurrent request and 120-second HTTP deadline. Local model download is disabled. Temporary directories and catalogue connections close when processing completes. Native thread OCR can outlive a timed-out HTTP call; the gate remains held. There is no fresh proof of process isolation, forced cancellation, memory limits, or live TLS/RLS in this audit. `/ready` checks catalogue configuration, not DB reachability. Restrict bind/network access independently. No patient records or credentials were inspected.

The mapper propagates extraction confidence and warnings; overall confidence and quantity are null, and source-backed IDs use `official_catalogue:`. It emits fixed `completed_with_warnings` and empty recommendation/alternative arrays. Python validates request metadata; the Node client validates returned Contract v1. No new end-to-end Contract v1 or clinical validation was performed here.

## Inventory

All application Python modules present at audit time (presence does not imply live wiring):
- `app/__init__.py`
- `app/core/__init__.py`
- `app/database/__init__.py`
- `app/database/catalogue_connection.py`
- `app/database/supabase_client.py`
- `app/database/supabase_connection_test.py`
- `app/integration/__init__.py`
- `app/integration/contract_v1.py`
- `app/integration/contract_v1_mapper.py`
- `app/integration/development_fixture_worker.py`
- `app/integration/http_service.py`
- `app/integration/local_pdf_pipeline.py`
- `app/integration/local_pdf_worker.py`
- `app/integration/offline_pipeline.py`
- `app/integration/offline_pipeline_worker.py`
- `app/integration/synthetic_worker.py`
- `app/layer1_document_processing/__init__.py`
- `app/layer1_document_processing/document_loader.py`
- `app/layer1_document_processing/google_vision_provider.py`
- `app/layer1_document_processing/hybrid_ocr.py`
- `app/layer1_document_processing/image_processor.py`
- `app/layer1_document_processing/ocr_engine.py`
- `app/layer1_document_processing/pdf_processor.py`
- `app/layer1_document_processing/pipeline.py`
- `app/layer2_information_extraction/__init__.py`
- `app/layer2_information_extraction/confidence.py`
- `app/layer2_information_extraction/document_context.py`
- `app/layer2_information_extraction/field_extractors.py`
- `app/layer2_information_extraction/instruction_extractor.py`
- `app/layer2_information_extraction/medicine_extractor.py`
- `app/layer2_information_extraction/normalizers.py`
- `app/layer2_information_extraction/numbered_medicine_rows.py`
- `app/layer2_information_extraction/pipeline.py`
- `app/layer3_medicine_understanding/__init__.py`
- `app/layer3_medicine_understanding/dosage_parser.py`
- `app/layer3_medicine_understanding/instruction_parser.py`
- `app/layer3_medicine_understanding/medicine_normaliser.py`
- `app/layer3_medicine_understanding/medicine_parser.py`
- `app/layer3_medicine_understanding/pipeline.py`
- `app/layer4_medicine_intelligence/__init__.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/__init__.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/candidate_finder.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/catalogue_import_preparation.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/cdsco_approval_sources.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/cdsco_restriction_sources.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/database_writer.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/database_writer_audit.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/database_writer_stage_b_audit.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/dry_run.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/integration_audit.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/loader.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/local_catalogue_importer.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/mapper.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/merger.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/models.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/nlem_rxnorm_matching.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/normalizer.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/nppa_anticancer_mrp.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/nppa_price_sources.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/official_sources.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/pipeline.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/pmbi_product_sources.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/real_supabase_ingestion_test.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/run_ingestion.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/rxnorm_enrichment.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/transformer.py`
- `app/layer4_medicine_intelligence/dataset_ingestion/validator.py`
- `app/layer4_medicine_intelligence/runtime/__init__.py`
- `app/layer4_medicine_intelligence/runtime/candidate_ranker.py`
- `app/layer4_medicine_intelligence/runtime/candidate_retriever.py`
- `app/layer4_medicine_intelligence/runtime/explainability.py`
- `app/layer4_medicine_intelligence/runtime/match_classifier.py`
- `app/layer4_medicine_intelligence/runtime/normalizer.py`
- `app/layer4_medicine_intelligence/runtime/official_catalogue_provider.py`
- `app/layer4_medicine_intelligence/runtime/pipeline.py`
- `app/layer4_medicine_intelligence/runtime/recommendation_data_provider.py`
- `app/layer4_medicine_intelligence/runtime/recommendation_flow.py`
- `app/layer4_medicine_intelligence/runtime/repository.py`
- `app/layer4_medicine_intelligence/runtime/schemas.py`
- `app/layer5_recommendations/__init__.py`
- `app/layer5_recommendations/pipeline.py`
- `app/layer5_recommendations/schemas.py`
- `app/layer5_recommendations/scoring.py`
- `app/main.py`
- `app/schemas/__init__.py`
- `app/schemas/medicine.py`
- `app/schemas/ocr.py`
- `app/schemas/prescription.py`

Relevant test modules:
- `tests/integration/test_catalogue_connection.py`
- `tests/integration/test_contract_v1.py`
- `tests/integration/test_contract_v1_mapper.py`
- `tests/integration/test_document_input_security.py`
- `tests/integration/test_http_service.py`
- `tests/integration/test_local_pdf_pipeline.py`
- `tests/integration/test_local_pdf_worker.py`
- `tests/integration/test_offline_pipeline.py`
- `tests/integration/test_offline_pipeline_worker.py`
- `tests/integration/test_synthetic_worker.py`
- `tests/layer1/test_document_loader.py`
- `tests/layer1/test_google_vision_provider.py`
- `tests/layer1/test_hybrid_ocr.py`
- `tests/layer1/test_image_processor.py`
- `tests/layer1/test_ocr_engine.py`
- `tests/layer1/test_pdf_processor.py`
- `tests/layer1/test_pipeline.py`
- `tests/layer2/test_document_context.py`
- `tests/layer2/test_field_extractors.py`
- `tests/layer2/test_instruction_extractor.py`
- `tests/layer2/test_medicine_extractor.py`
- `tests/layer2/test_medicine_grouping.py`
- `tests/layer2/test_numbered_medicine_rows.py`
- `tests/layer2/test_pipeline.py`
- `tests/layer3/test_dosage_parser.py`
- `tests/layer3/test_instruction_parser.py`
- `tests/layer3/test_medicine_normaliser.py`
- `tests/layer3/test_medicine_parser.py`
- `tests/layer3/test_medicine_schema.py`
- `tests/layer3/test_pipeline.py`
- `tests/layer4/test_catalogue_import_preparation.py`
- `tests/layer4/test_cdsco_approval_ingestion.py`
- `tests/layer4/test_cdsco_restriction_ingestion.py`
- `tests/layer4/test_india_nlem_ingestion.py`
- `tests/layer4/test_layer4_runtime_e2e.py`
- `tests/layer4/test_layer4_runtime_matching.py`
- `tests/layer4/test_layer4_runtime_pipeline.py`
- `tests/layer4/test_layer4_supabase_readonly.py`
- `tests/layer4/test_local_catalogue_importer.py`
- `tests/layer4/test_nppa_anticancer_mrp_ingestion.py`
- `tests/layer4/test_nppa_price_ingestion.py`
- `tests/layer4/test_official_catalogue_link_replay_migration.py`
- `tests/layer4/test_official_catalogue_migration.py`
- `tests/layer4/test_official_catalogue_provider.py`
- `tests/layer4/test_official_dataset_ingestion.py`
- `tests/layer4/test_pmbi_product_ingestion.py`
- `tests/layer4/test_rxnorm_enrichment.py`
- `tests/layer5/test_pipeline.py`

Dependencies declared in `requirements.txt`: Pillow, PyMuPDF, numpy, PaddleOCR/PaddlePaddle, dotenv, Supabase, psycopg, boto3, Google Cloud Vision, FastAPI, uvicorn, Starlette and annotated-doc. Installed versions checked locally: EasyOCR 1.7.2, PaddleOCR 3.7.0, PaddlePaddle 3.2.2, torch 2.6.0+cpu, FastAPI 0.136.1, PyMuPDF 1.28.2; transformers and boto3 were not importable in this virtual environment. Package presence does not prove model initialization. Other versions and complete environment-variable inventory remain unverified.
