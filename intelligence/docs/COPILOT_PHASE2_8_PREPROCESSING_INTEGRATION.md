# COPILOT PHASE 2.8 — PREPROCESSING INTEGRATION

## Summary

Phase 2.8 connects the Phase 2.7 native-PDF and safe-image helpers to an
additive Layer 1 pipeline entry point. The legacy `process_document` and
`process_document_with_ocr` functions remain available and unchanged in their
behavior. Callers opt into the new routed path through
`process_document_with_preprocessing`.

The adapter validates the staged input with the existing document-safety
limits before PDF extraction, raster decoding, or OCR. It processes PDF pages
independently, does not alter source files, and uses the existing OCR engine
only for image pages or PDF pages whose native text is absent or suspicious.
TrOCR and cloud OCR are not invoked.

## Files changed

- `intelligence/app/layer1_document_processing/document_preprocessing.py`
  - Bounded skew analysis to a thumbnail and corrected blur/shadow diagnostics.
  - Made deskew bounded and conditional; removed automatic denoising because
    it could erase small characters.
- `intelligence/app/layer1_document_processing/pdf_text_extractor.py`
  - Added bounded text/word output, per-word PDF coordinates, and warnings for
    truncated or suspicious text encodings.
- `intelligence/app/layer1_document_processing/preprocessing_adapter.py`
  - New page-by-page routing adapter, safety validation, raster preprocessing,
    native-PDF conversion, blank-page handling, and additive provenance.
- `intelligence/app/layer1_document_processing/pipeline.py`
  - Added `process_document_with_preprocessing(...)` as the Layer 1 pipeline
    entry point. Existing uncommitted changes in this file were preserved.
- `intelligence/tests/layer1/test_preprocessing_adapter.py`
  - Added fictional searchable, scanned, mixed, blank, numeric, rotated,
    invalid, and oversized document cases.
- `intelligence/tests/layer1/test_pdf_text_extractor.py`
  - Existing tests retained; bounded word evidence is also exercised by the
    adapter suite.
- `intelligence/docs/COPILOT_PHASE2_8_PREPROCESSING_INTEGRATION.md`

No backend, frontend, Contract v1, worker, provider-selection, or process
supervision files were changed.

## Routing and page behavior

`app.layer1_document_processing.pipeline.process_document_with_preprocessing`
accepts the existing local document path and an optional object implementing
`process_page(PIL.Image) -> OCRPageResult`.

Before any raster processing, it calls the existing
`validate_staged_document` safety boundary. This preserves configured byte,
page, dimension, rendered-pixel, aggregate-pixel, and supported-MIME limits.
PDF rendering defaults to 120 DPI, matching the existing preflight's default.

For each PDF page:

1. Native text and bounded word coordinates are extracted in page order.
2. Pages with adequate text, at least three extracted words, and no
   suspicious/incomplete/truncation indicators use the native-text route.
3. Missing or suspicious native text uses raster rendering and the existing
   OCR engine.
4. Blank pages without usable native text return an empty page result with a
   page-specific warning; OCR is not invoked for that page.
5. A mixed document can therefore use native text, raster OCR, and blank-page
   handling on different pages without joining page content.

The native-text eligibility thresholds are deterministic triage heuristics,
not a guarantee that a PDF text layer is accurate or complete.

## Image preprocessing and evidence preservation

JPEG, PNG, and rasterized PDF pages pass through:

- existing EXIF orientation normalization for image inputs
- measurable quality assessment, including blur/low edge detail, contrast,
  brightness, skew, clipping, resolution, small-text risk, and uneven corner
  illumination
- conservative autocontrast when contrast/brightness diagnostics justify it
- deskew only within a five-degree bound and away from detected page edges
- no automatic denoising or perspective warp

The original file is never modified. The source image remains available during
candidate validation and OCR selection. A transformed candidate is rejected
if it exceeds safety dimensions/pixels, changes image geometry, removes
detected ink, weakens dark strokes, or uses the removed noise-reduction step.
When rejected, the original image is passed to the existing OCR engine.

These pixel checks reduce transformation risk but do not prove that every
decimal stroke will be interpreted correctly by an OCR model.

## OCR schema and native-text provenance

Every page returns an existing `OCRPageResult`, wrapped in additive
`PreprocessedOCRPage` metadata containing:

- one-based `page_number`
- `route` (`native_pdf_text`, `raster_ocr`, or `blank`)
- native PDF text evidence, including available word bounding boxes
- quality metrics and applied transform names for raster pages
- page-specific warnings

`PreprocessedOCRDocument` contains the ordered page results and document-level
warnings. The established `OCRPageResult` and Contract v1 schemas were not
modified.

The existing OCR schema requires a numeric block confidence but cannot encode
“confidence unavailable.” Native PDF word blocks use `0.0` and carry an
explicit warning that this is a compatibility placeholder, not a measured OCR
confidence. Consumers must inspect the additive `route` metadata and must not
interpret native PDF text as OCR evidence. A future unified consumer should
preserve the wrapper metadata when forwarding page results.

## Fictional acceptance coverage

The focused fixtures cover:

- two-page searchable PDF with independent native text per page
- two-page image-only/scanned PDF with existing-engine fallback per page
- mixed three-page PDF: native page, scanned page, blank page
- page ordering and page/word coordinates
- searchable PDF numeric text containing `0.5 mg`, `5 mg`, `500 mcg`,
  `1-0-1`, and `1-1-1`
- PNG and JPEG image inputs
- JPEG EXIF rotation normalization
- low-contrast synthetic image
- invalid PDF and invalid image signatures
- oversized image rejected by configured safety limits
- bounded PDF text and word-coordinate output

All OCR engine calls in the new integration tests use a mock to verify routing
and output compatibility. No mocked output is presented as genuine OCR
accuracy. No live model inference was run in this phase; running heavyweight
EasyOCR/PaddleOCR inference was avoided to prevent competing for machine
resources with concurrent frontend testing.

## Tested formats and support

The adapter accepts only the existing application-supported inputs:

- PDF
- JPEG/JPG
- PNG

TIFF, BMP, WebP, and HEIC/HEIF remain unsupported by the application path.
This phase does not widen MIME or extension acceptance.

## Commands and actual results

Run from `C:\Users\dahiy\MedDecode-integration\intelligence`:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/layer1/test_preprocessing_adapter.py tests/layer1/test_document_preprocessing.py tests/layer1/test_pdf_text_extractor.py tests/layer1/test_pipeline.py -q
.\.venv\Scripts\python.exe -m pytest tests/layer2/test_multi_medicine_evaluation.py tests/layer2/test_medicine_extractor.py tests/layer3 -q
.\.venv\Scripts\python.exe -m compileall -q app/layer1_document_processing
.\.venv\Scripts\python.exe -m pytest -q
```

Results:

- Layer 1 integration/preprocessing tests:
  `21 passed in 0.89s`.
- Layer 2 multi-medicine and Layer 3 regressions: `82 passed`.
- Layer 1 compilation: passed.
- Full Python suite: `412 passed, 1 warning in 10.67s`.

The warning is the existing Starlette/AnyIO deprecation warning and is
unrelated to this change.

## Resource and runtime limits

- Existing `DocumentSafetyLimits` preflight is reused; no limits were raised.
- PDF pages are rendered sequentially at the adapter's default 120 DPI.
- Native PDF text evidence is bounded to 100,000 characters and 20,000 word
  coordinate records per page by default.
- No heavyweight OCR model is initialized for a fully native-text PDF.
- The injected existing OCR engine is called sequentially for raster pages.
- No new process, thread pool, OCR provider, or model is created by the
  adapter; the default OCR engine is initialized lazily only when a raster
  page needs OCR.
- No TrOCR, Google OCR, or hosted worker was activated.

## Exact Codex handoff

To opt into this integration without changing existing schemas, call:

```python
from app.layer1_document_processing.pipeline import process_document_with_preprocessing

document = process_document_with_preprocessing(
    staged_document_path,
    ocr_engine=existing_ocr_engine,
)
```

The caller should preserve each `PreprocessedOCRPage` wrapper until it has
recorded `route`, `native_text_evidence`, and warnings alongside
`page.result`. Do not flatten or concatenate different page text. For native
PDF routes, the `0.0` block confidence is explicitly “not measured”; if
downstream code cannot preserve that distinction, use the raster OCR path
instead until the representation is agreed.

The existing `process_document_with_ocr` remains unchanged and is not
automatically rerouted. This keeps current callers and output semantics stable.
Codex must explicitly migrate the intended local caller to the new entry point
after confirming it can preserve the additive provenance. No FastAPI or
backend connection was made here.

## Remaining limitations

- Native PDF text completeness and correctness are assessed heuristically.
- An image with content embedded in a PDF may still be too low-resolution for
  OCR; the adapter cannot recover truly illegible source detail.
- No genuine EasyOCR/PaddleOCR result was measured for the new path, and no
  before/after OCR numeric benchmark is claimed.
- Rotated PDFs are rendered by PyMuPDF; arbitrary orientation correction is
  not inferred from page content. JPEG/PNG EXIF orientation is normalized.
- The existing OCR schema cannot natively label text source or represent an
  unavailable confidence value. The additive wrapper is required to preserve
  this provenance.

## Final status

NATIVE_PDF_TEXT_ROUTING: VERIFIED

SCANNED_PDF_FALLBACK: VERIFIED

SAFE_IMAGE_PREPROCESSING: VERIFIED

MULTIPAGE_SUPPORT: VERIFIED

ORIGINAL_EVIDENCE_PRESERVED: VERIFIED

OCR_COMPATIBILITY: VERIFIED

NUMERIC_SAFETY: PARTIAL

RESOURCE_LIMITS: VERIFIED

FULL_PYTHON_REGRESSION: VERIFIED

LIVE_FASTAPI_INTEGRATION: NOT_IN_SCOPE

READY_FOR_E2E_HANDOFF: YES

The handoff is ready for an explicit Codex integration and genuine local OCR
smoke test. The status does not claim clinical accuracy or verified numeric
OCR performance.
