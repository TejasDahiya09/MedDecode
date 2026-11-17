# MedDecode final demonstration readiness

## Overall status: PARTIAL — not ready for account seeding or live alternatives

The local, nonclinical demonstration is complete and verified. No hosted account data was created. Production-ready Cabinet/Reminder seeding and live prescription alternatives remain blocked by missing authorization and source/API evidence.

| Workstream | Status | Verified outcome |
|---|---|---|
| Alternative evidence gate | PASS | Result matches and proposed records are withheld unless exact ingredient/strength/unit/form plus complete structured salt, route, release, product, manufacturer, and source-record identity are present and consistent. |
| Live alternatives from normal results | BLOCKED | The offline mapper still returns an empty alternatives list. Current catalogue/result contracts do not supply all required identity fields. No worker/V3 path or deployed API was changed by this task. |
| Local Cabinet/Reminder preview | PASS | Five NLEM-backed catalogue rows are paired with five clearly fictional local Cabinet entries and five linked reminder previews. Changes remain in page memory only. |
| Authenticated Cabinet/Reminder seed | BLOCKED | No authenticated profile and explicitly approved non-production project/session were verified. NLEM source IDs are not accepted Cabinet UUIDs. Reminder writes also await separate deployment and verification of the pending ownership-policy remediation. |
| Nonclinical source-backed PDF | PASS | One-page PDF contains five source formulations, their NLEM IDs and provenance, the exact watermark `FICTIONAL ACADEMIC DEMONSTRATION — NOT VALID FOR TREATMENT`, and `DOSAGE NOT SPECIFIED IN SOURCE DATA` on every medicine row. It contains no dosage schedule or treatment directions. |
| Local OCR measurement | PASS, narrowly scoped | The generated PDF was rendered by MedDecode's `process_document()` and recognized by `HybridOCREngine` with local `EasyOCRProvider`; downloads were disabled. This is a sample-only engineering measurement, not clinical or handwriting accuracy. |
| Hosted database work | PASS | No hosted SQL, database mutation, import, link creation, migration execution, or worker execution was performed for this completion task. |

## Source-backed local fixtures

The five selected formulation records are from the repository's normalized first-50 NLEM 2022 export. They are source references, not production catalogue UUIDs, and NLEM inclusion does not establish marketing authorization or local availability.

| NLEM source record ID | Formulation shown |
|---|---|
| `2.1.5:f1` | Paracetamol, tablet, 500 mg |
| `2.1.5:f3` | Paracetamol, oral liquid, 120 mg/5 mL |
| `2.1.2:f1` | Diclofenac, tablet, 50 mg |
| `2.1.3:f1` | Ibuprofen, tablet, 200 mg |
| `2.1.4:f2` | Mefenamic acid, oral liquid, 100 mg/5 mL |

The displayed Cabinet associations, reminder times, and taken/skipped events are synthetic preview data. They are not written to a user's profile and are not dosage instructions.

## Alternative evidence contract and blockers

The local verifier now fails closed when any of the following is missing or inconsistent:

- exact ingredient composition, strength, units, and dosage form;
- explicit salt identity, administration route, and release characteristics;
- product ID, manufacturer ID/name, and source-record ID;
- agreement between the result's reported identity and the authenticated source detail.

Free-text names and aliases are not used to infer salt, route, or release. Alternative cards display verified source-record and catalogue identifiers only after the full check passes.

No current candidate is eligible from the normal result pipeline: the local mapper still emits `alternatives: []`, and the current catalogue detail/result contracts omit required structured identity fields. Completing this requires a separately reviewed source-backed contract and API/data change; do not activate or deploy it as part of this demo task.

## OCR measurement

The run in [`ocr-evaluation.json`](../../demos/phase-d1/ocr-evaluation.json) measured **21/25 fields (84%)** across five rows using exact contiguous normalized matches:

- medicine name, strength, dosage form, and explicit missing-dosage notice: **20/20**;
- NLEM source-record ID: **1/5**. Four source IDs were not recognized exactly and must not be recovered from OCR without verification.

Run details: EasyOCR **1.7.2**, PyTorch **2.6.0+cpu**, PyMuPDF **1.28.2**, Pillow **12.3.0**; 51 predictions; mean raw confidence **0.8569** (range **0.2293–1.0000**, not calibrated); PDF rendering **22.34 ms**; hybrid recognition **14,731.59 ms**, including **6,407.80 ms** EasyOCR initialization. Timings are machine/run-specific.

This is one generated, clearly printed digital document. It does not measure handwriting, camera capture, real prescriptions, clinical entity resolution, or safety and must not be generalized to production accuracy.

## Account-data approval boundary

No account seed was attempted. The current environment did not provide a verified authenticated demo profile together with explicit approval of a non-production project/session. In addition, the NLEM fixture IDs are incompatible with the current Cabinet medicine UUID contract. The Reminder ownership-policy remediation remains pending separate deployment and verification. Do not bypass these boundaries, weaken RLS, or substitute fabricated production IDs.

## Validation

- Frontend unit tests: **370 passed**.
- Frontend typecheck: **passed**.
- Frontend production build: **passed**; Vite reported the existing large-chunk advisory (>500 kB).
- Targeted ESLint on modified frontend files: **passed**.
- Full frontend ESLint: **blocked by two errors in the separate `frontend/tests/e2e/genuine-hosted-results-verification.spec.ts` file** (`no-explicit-any` and `no-useless-assignment`). That concurrent file was not modified; no hosted E2E test was run.
- Python Layer 1 document/OCR tests: **36 passed**.
- Python Layer 4 and Layer 5 tests: **96 passed**.
- Pylance diagnostics for the PDF generator and OCR evaluator: **no diagnostics**.
- PDF generator: **27 source/text assertions passed**.
- Local browser preview: five catalogue entries, five Cabinet entries, five reminders and a skipped fixture event displayed; no horizontal overflow at a 375px viewport. No authenticated account was accessed.
- Backend tests: **not run**; no backend files were changed.

The shared worktree contained concurrent worker and Reminder changes. They were left untouched; no cleanup or reset was performed.

## Changed files for this completion

- Alternative evidence and API parsing: [`same-formulation-alternatives.ts`](../../frontend/src/features/prescriptions/same-formulation-alternatives.ts), [`VerifiedAlternativesSection.tsx`](../../frontend/src/features/prescriptions/VerifiedAlternativesSection.tsx), [`medicine-catalogue-api.ts`](../../frontend/src/features/catalogue/medicine-catalogue-api.ts), [`prescription-api.ts`](../../frontend/src/features/prescriptions/prescription-api.ts).
- Local demo and tests: [`PhaseD1DemoPage.tsx`](../../frontend/src/features/demo/PhaseD1DemoPage.tsx), [`fixtures.json`](../../frontend/public/demo/phase-d1/fixtures.json), [`expected-output.json`](../../frontend/public/demo/phase-d1/expected-output.json), and focused tests under [`frontend/tests/unit/`](../../frontend/tests/unit/).
- PDF and OCR artifacts: [`generate_sample.py`](../../demos/phase-d1/generate_sample.py), [`evaluate_phase_d1_ocr.py`](../../intelligence/evaluate_phase_d1_ocr.py), [`sample-prescription.pdf`](../../frontend/public/demo/phase-d1/sample-prescription.pdf), [`ocr-evaluation.json`](../../demos/phase-d1/ocr-evaluation.json), and [`README.md`](../../demos/phase-d1/README.md).

## Final readiness decision: NO

The local demonstration is ready to present with its limitations. The authenticated seed and live alternatives are not ready; both require separate authorization and, for alternatives, source-backed API/data-contract work.
