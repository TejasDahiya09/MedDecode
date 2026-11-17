# Phase D.1 local demonstration

This package is an isolated, local-only preview. It does not create hosted records, call prescription workers, enable a processing generation, or write to Cabinet or Reminders APIs.

## Run the preview

1. Start the frontend using the repository's normal local development command.
2. Open `/demo/phase-d1`.
3. Use **Download sample PDF** to inspect the clearly watermarked academic catalogue document.
4. Use **Expected OCR JSON** to review the independent field targets.
5. Edit or pause/resume a reminder in the preview. Those changes exist only in the current page session and reset on refresh.

The sample PDF is generated reproducibly from `frontend/public/demo/phase-d1/fixtures.json` and `expected-output.json` by:

```powershell
Push-Location intelligence
.\.venv\Scripts\python.exe ..\demos\phase-d1\generate_sample.py
Pop-Location
```

The generator checks the five selected source records against the independent expected-output fixture, embeds the exact fictional-document watermark, includes each NLEM source identifier, and verifies that every medicine row states `DOSAGE NOT SPECIFIED IN SOURCE DATA`. It requires the repository's existing PyMuPDF dependency and makes no network requests.

## Offline OCR measurement

Run the measured evaluation with the already-downloaded local EasyOCR model files:

```powershell
Push-Location intelligence
.\.venv\Scripts\python.exe .\evaluate_phase_d1_ocr.py --model-directory "$HOME\.EasyOCR\model"
Pop-Location
```

The evaluator uses MedDecode's `process_document()` PDF renderer and `HybridOCREngine` with `EasyOCRProvider`; EasyOCR downloads are disabled. The evaluator is at `intelligence/evaluate_phase_d1_ocr.py`; the recorded local run is saved to `demos/phase-d1/ocr-evaluation.json`.

Measured results for this single generated, clearly printed PDF:

- **21/25 fields (84%)** matched exactly after Unicode normalization, case-folding, and punctuation/spacing removal, within each printed medicine row.
- Medicine name, strength, dosage form, and the explicit missing-dosage statement matched **20/20** times.
- The NLEM source-record identifier matched **1/5** times. Do not rely on OCR to recover these identifiers; use the printed document or authoritative catalogue record.
- 51 OCR predictions had mean raw confidence **0.8569** (range **0.2293–1.0000**); raw confidence is not a calibrated probability.
- PDF rendering took **22.34 ms**; hybrid page recognition took **14,731.59 ms**, including **6,407.80 ms** EasyOCR initialization, on the recorded local run.
- Versions: EasyOCR **1.7.2**, PyTorch **2.6.0+cpu**, PyMuPDF **1.28.2**, Pillow **12.3.0**.

These are sample-specific engineering measurements, not handwriting accuracy, clinical validation, or evidence that OCR is suitable for care. The report file contains per-record matches, raw recognized row text, confidence, timing, package versions, and limitations.

## Data provenance and limitations

The five source formulations come from the repository's normalized first-50 export for the 2022 National List of Essential Medicines (NLEM), published by the Ministry of Health and Family Welfare, Government of India. The source URL is [NPPA's NLEM 2022 page](https://nppa.gov.in/en/nlem2022). Each NLEM item/formulation identifier is a source-record identifier, **not** a production MedDecode UUID and not proof that the formulation is marketed or available.

The PDF contains no treatment directions, dosage schedule, real patient, clinician, facility, diagnosis, manufacturer, or price. Its fictional watermark is `FICTIONAL ACADEMIC DEMONSTRATION — NOT VALID FOR TREATMENT`; each source row explicitly says `DOSAGE NOT SPECIFIED IN SOURCE DATA`. Reminder times and taken/skipped events exist only in the isolated preview fixture and are not written to an account.

The local first-50 NLEM/RxNorm comparison export contains 0 exact, 6 uncertain, and 44 unmatched records. This is not a full-catalogue absence claim. The current offline result mapper emits an empty alternatives array. The verifier now requires complete structured salt, route, release, product, manufacturer, and source-record identity in addition to exact ingredient, strength, and dosage-form evidence. The existing catalogue detail and result contracts do not supply all those fields, so no alternative is currently eligible; free-text name similarity cannot fill the gap.

## Account-data approval boundary

No Cabinet or Reminder seed is performed. NLEM source identifiers are not accepted as Cabinet production UUIDs, and no explicitly approved non-production project/session has been verified. Reminder writes are additionally blocked until the pending Reminder ownership-policy remediation is separately deployed and verified. Do not bypass these constraints or use the preview fixture as account data.

## Cleanup

No persistent fixture records are created. Stop the local frontend process to end the preview. To remove this demo package, delete only `frontend/public/demo/phase-d1`, `frontend/src/features/demo/PhaseD1DemoPage.tsx`, `demos/phase-d1`, and the focused Phase D.1 frontend tests. Do not remove any account data; none is read or written by this preview.
