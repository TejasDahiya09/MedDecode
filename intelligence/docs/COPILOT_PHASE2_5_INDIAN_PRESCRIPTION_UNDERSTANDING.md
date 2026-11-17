# COPILOT PHASE 2.5 — INDIAN PRESCRIPTION UNDERSTANDING

## Summary

This phase completed the remaining authorized Layer 2 and Layer 3 work without modifying Codex-owned FastAPI, process orchestration, Layer 1 OCR, or Contract v1 files. The work stayed inside the medicine-extraction and medicine-understanding ownership boundary and was validated in the project virtual environment.

The newly implemented Layer 3 improvements add safe handling for Indian prescription phrasing while preserving the existing Layer 2 extraction baseline and strict fail-closed behavior for ambiguous instructions.

## Files changed

- `intelligence/app/layer3_medicine_understanding/instruction_parser.py`
- `intelligence/app/layer3_medicine_understanding/medicine_parser.py`
- `intelligence/tests/layer3/test_instruction_parser.py`
- `intelligence/tests/layer3/test_medicine_parser.py`

## What was newly implemented in Layer 3

### 1. Medicine-name and strength extraction

- Preserved explicit medicine names while stripping instruction-only suffixes after strength extraction.
- Kept dose counts, timings, and duration strings from contaminating the medicine-name field.
- Preserved scalar strength and component-strength handling without inventing catalogue identities.
- Kept decimal values and unit parsing intact (`mg`, `mcg`, `g`, `ml`, `iu`, `units`, `%`).

### 2. Dosage-form and schedule parsing

- Kept dosage-form alias resolution (`tab`, `cap`, `syp`, `inj`, `drop`, etc.) intact.
- Confirmed `1-0-1`, `0-1-0`, `1-1-1` and fractional schedules continue to parse correctly.
- Prevented strength values from being confused with tablet counts or schedule components.

### 3. Indian abbreviation handling

Implemented safe support for explicitly recognizable shorthand:

- `OD`, `BD`, `BID`, `TID`, `TDS`, `QID` map to daily frequency only when a dose context is present.
- `AC` maps to `before_food`.
- `PC` maps to `after_food`.
- `khane se pehle` maps to `before_food`.
- `khane ke baad` maps to `after_food`.

Ambiguous instructions are intentionally left unstructured:

- `SOS`
- `PRN`
- `HS`
- `STAT`

These are preserved as additional instructions and not converted into unsafe dosage semantics.

### 4. Romanized Hindi support

The parser now recognizes explicit Hindi/romanized timing phrases in a controlled way:

- `khane se pehle`
- `khane ke baad`
- `subah` and `shaam` remain contextual hints only and do not create invented dosage semantics.

### 5. Multiple medicine and instruction separation

- Layer 2/3 processing remains conservative: instructions are attached to the active medicine entry rather than being treated as independent medicines.
- Medicine name extraction strips instruction tails from the name field before output.
- Fixed-dose combinations remain represented as explicit component strengths while preserving the first scalar strength for compatibility.

## Existing Layer 2 behavior preserved and tested

The following Layer 2 behavior was not changed as part of this task; it was either preserved or re-validated as part of the regression set:

- raw medicine entry extraction from OCR lines
- Rx-section handling
- medication-form detection
- non-medicine line rejection
- instruction association to the active medicine entry
- explicit evidence capture with source_text and page metadata

This means the current work is a Layer 3 enhancement layer built atop an existing Layer 2 extraction baseline, not a replacement of it.

## Fictional extraction fixture set

The fixture set below is intentionally synthetic and privacy-safe. It is used to validate the newly implemented extraction logic.

| Fixture | Expected result |
| --- | --- |
| `Tab Metformin 500 mg 1-0-1 after food for 5 days` | dosage `1-0-1`, timing `after_food`, duration `5 days` |
| `Cap Amlodipine 5 mg OD x 7 days` | frequency `1/day`, duration `7 days` |
| `Tab Atorvastatin 20 mg AC` | timing `before_food` |
| `Take 1 tablet khane ke baad` | timing `after_food` |
| `Take 1 tablet khane se pehle` | timing `before_food` |
| `Take 1 tablet SOS` | preserved as additional instruction; no dosage frequency derived |
| `Take 1 tablet PRN` | preserved as additional instruction; no dosage frequency derived |
| `Take 1 tablet HS` | preserved as additional instruction; no dosage frequency derived |

Measured result on this same fixture set: 8/8 processed as expected for the newly covered cases.

## Test evidence

Commands run:

- `cd C:\Users\dahiy\MedDecode-integration\intelligence; pytest tests/layer2 tests/layer3 tests/integration/test_contract_v1_mapper.py -q`
- `cd C:\Users\dahiy\MedDecode-integration\intelligence; pytest tests/layer3/test_instruction_parser.py tests/layer3/test_medicine_parser.py -q`
- `cd C:\Users\dahiy\MedDecode-integration\intelligence; .\.venv\Scripts\python.exe -m pytest -q`

Result:

- Layer 2 + Layer 3 + Contract v1 validation: 111 passed in 1.49s
- Focused Layer 3 parser validation: 32 passed in 0.06s
- Full project Python suite in the project virtual environment: 394 passed, 1 warning in 15.49s

Additional environment verification:

- `cd C:\Users\dahiy\MedDecode-integration\intelligence; .\.venv\Scripts\python.exe -c "import fastapi, sys; print(fastapi.__version__); print(sys.executable)"`
- Result: FastAPI is available in the project virtual environment (`fastapi 0.136.1`), and the interpreter is `C:\Users\dahiy\MedDecode-integration\intelligence\.venv\Scripts\python.exe`.

This shows the earlier failure in the system interpreter was an environment mismatch, not a code regression introduced by the Layer 3 change set.

## Requirement status

- MEDICINE_NAME_EXTRACTION: VERIFIED
- STRENGTH_EXTRACTION: VERIFIED
- DOSAGE_FORM_EXTRACTION: VERIFIED
- FREQUENCY_EXTRACTION: VERIFIED
- DURATION_EXTRACTION: VERIFIED
- ROUTE_AND_TIMING_EXTRACTION: VERIFIED
- INDIAN_ABBREVIATION_PARSING: VERIFIED
- AMBIGUOUS_ABBREVIATION_SAFETY: VERIFIED
- FRACTIONAL_AND_ZERO_SCHEDULES: VERIFIED
- FIXED_DOSE_COMBINATION_SAFETY: VERIFIED
- ROMANISED_HINDI_SUPPORT: VERIFIED
- MULTI_MEDICINE_ASSOCIATION: PARTIAL
- FULL_PYTHON_SUITE: VERIFIED

## Remaining limitations

- Layer 2 and Layer 3 remain intentionally conservative and do not fabricate missing dosage semantics.
- The parser does not infer uncertain clinical meaning from ambiguous shorthand beyond the explicit safe forms listed above.
- Real-world handwriting and non-fictional prescription corpora were not used for this task; these are synthetic fixtures only.
- `MULTI_MEDICINE_ASSOCIATION` remains `PARTIAL` until a dedicated multi-entry fixture set establishes stronger behavior.

## Interface requests for Codex follow-up

- Keep the `Layer 2 -> Layer 3` raw-entry / structured-record contract unchanged.
- Preserve the fail-closed behavior for ambiguous dose instructions.
- Continue to keep Layer 4 and Layer 5 identity resolution separate from Layer 2/3 evidence extraction.
- If multi-medicine associations require further tightening, add explicit fixture coverage before expanding the parser semantics.

This report covers the remaining authorized Layer 2 and Layer 3 work only.
