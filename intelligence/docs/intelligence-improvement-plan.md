# Intelligence improvement plan ? design only

P0: bound PDF page count, rendered dimensions and aggregate pixel memory before allocation (`pdf_processor.py`, `local_pdf_pipeline.py`); test multi-page/decompression abuse, dependency failure and controlled shutdown. Complexity medium; no backend contract change anticipated. Preserve explicit review of extraction uncertainty and do not expose ranked substitutes as medical equivalence (`contract_v1_mapper.py`). Clinical claim validation and source evidence are prerequisites before any alternative feature.

P1: establish a consented, fictional/deidentified and carefully labeled Indian printed/handwritten evaluation set, with held-out cases and medicine/strength/abbreviation ground truth. Measure CER, WER, entity precision and recall, abstention and error severity by document type. Examine page segmentation, rotation/skew, noisy photos, crowded layouts and multi-line prescription instructions in Layer 1?3; preserve conflicting evidence. Add restricted catalogue read-only integration verification and explicit matching/unmatched and provenance tests. Copilot owns these Python changes. Avoid implying synthetic ground truth is medically validated.

P2: add bounded OCR-process isolation and killable timeout with startup/model caching metrics; verify one-request gate and resource budgets. Add clear provider configuration and evidence-preserving reconciliation tests. Review the duplicate Google Vision adapters before selecting one; do not silently enable cloud transfer. Check model licenses, release provenance and dependency pinning. Preserve current service contract unless a separately agreed interface change is demonstrably required.

P3: investigate optional consented cloud OCR only after data-transfer, retention, region, cost and permission review.

## Two architecture options

A. Incremental offline default: retain EasyOCR for all pages, invoke local PaddleOCR selectively for low-confidence or ambiguous regions when independently validated, and optionally TrOCR on detected line crops. Agree/conflict evidence rather than confidence alone determines review; no automatic cross-engine clinical conclusion. CPU cost and model memory need measurement; transformer assets not installed. Incrementally preserves current HTTP interface.

B. Privacy-gated hybrid: same local first pass, then explicitly authorized cloud Textract or Vision on narrowly selected regions for unresolved cases. Requires patient-data transfer assessment, network identity, retention and budget controls, plus adversarial tests. Adds operational cost and latency. Neither option implies that all five categories are needed or that more providers improve medical accuracy.

Choose A first, subject to measured accuracy/latency on representative labeled data. Five existing categories map to EasyOCR, PaddleOCR, TrOCR, Textract and Vision; page preprocessing and fusion are mechanisms, not independent providers. No latency, memory or licensing figures have been measured in this audit. No backend or database change is established as necessary for the initial evaluation; any new response fields or cloud data flows require separately reviewed contracts and approvals.
