# Batch 2 clinical extraction safety

Date: 2026-11-17

Branch: `main`

Scope: AUD-INT-001 and AUD-INT-002 only

## Outcome

Batch 2 is complete locally. OCR rows explicitly retained as unverified evidence can no longer silently enter automatic medicine matching, recommendations, or Contract v1 medicines. Legitimate numbered medicine entries without review-only provenance continue through the existing extraction path.

No hosted service, database, worker, prescription, dataset, nested repository, migration, or historical result was accessed or changed.

## Root cause

Layer 1 correctly attached four `UnverifiedNumberedRow` records to the OCR page. Layer 2 independently reconstructed the same blocks as lines and accepted each `unclear once daily` line because its numbered prefix satisfied the permissive numbered-candidate branch. The warning list and medicine list then traveled independently:

1. the unverified rows produced `UNVERIFIED_NUMBERED_ROWS`;
2. the overlapping medicine candidates continued through Layer 3;
3. Layer 4 attempted catalogue matching;
4. Layer 5 constructed recommendation results; and
5. the mapper emitted four medicines while merely adding a warning.

The missing control was a shared provenance disposition between row classification and medicine extraction.

## Before and after

Synthetic source rows:

```text
1. unclear once daily
2. unclear once daily
3. unclear once daily
4. unclear once daily
```

Before:

- four unverified numbered-row evidence records;
- four Contract v1 medicines named `unclear`;
- four unmatched Layer 4 results; and
- a warning claiming the rows were not treated as medicines.

After:

- four unverified numbered-row evidence records remain;
- four per-candidate `medicine_identity` review warnings are retained;
- zero Layer 3 medicine records originate from those rows;
- zero Layer 4/5 processing occurs for them; and
- Contract v1 contains zero medicines plus `UNVERIFIED_NUMBERED_ROWS`.

When a valid `Tab Paracetamol 500 mg` line is adjacent but outside the unverified evidence, it remains the sole medicine and maps normally.

## Clinical boundary invariant

An OCR candidate is eligible for automatic medicine processing only when its source evidence is provably disjoint from every explicitly unverified numbered row on that page.

The invariant is enforced as follows:

- Layer 2 compares stable page numbers and source block indexes.
- Exact OCR block identity/fingerprints catch copied evidence objects.
- Geometric intersection catches equivalent provider/crop evidence where object identity differs.
- Missing or invalid block provenance on a page containing unverified rows fails closed.
- An internal `automatic_identity_eligible` disposition is carried by raw and understood medicine records.
- Layer 4 refuses matching when that disposition is false.
- Contract mapping excludes any ineligible entry as defense in depth.

This does not globally reject numbered text. `1. Paracetamol`, `2. Diclofenac`, and `3. Ibuprofen` continue to extract when they have not been explicitly classified as review-only evidence.

## Evidence and warning preservation

`PrescriptionRecord.unverified_numbered_rows` remains unchanged and retains raw text, page number, confidence, bounding region, observed/candidate sequence numbers, and OCR block evidence. Exclusion adds a manual-review warning without copying prescription content into logs. Contract v1 remains structurally unchanged and exposes the established `UNVERIFIED_NUMBERED_ROWS` warning.

## Files changed

- `intelligence/app/schemas/prescription.py`
- `intelligence/app/schemas/medicine.py`
- `intelligence/app/layer2_information_extraction/provenance_safety.py`
- `intelligence/app/layer2_information_extraction/pipeline.py`
- `intelligence/app/layer3_medicine_understanding/medicine_parser.py`
- `intelligence/app/layer4_medicine_intelligence/runtime/pipeline.py`
- `intelligence/app/integration/contract_v1_mapper.py`
- `intelligence/tests/layer2/test_numbered_medicine_rows.py`
- `backend/docs/PLATFORM_ISSUE_REGISTER.md`
- `backend/docs/BATCH_2_CLINICAL_EXTRACTION_SAFETY.md`

## Regression coverage

New or strengthened coverage includes:

- original four unverified numbered rows;
- mixed verified and unverified entries;
- a valid adjacent medicine;
- copied/overlapping OCR evidence;
- duplicate-region resistance;
- missing provenance fail-closed behavior;
- legitimate numbered medicine names;
- multipage provenance isolation;
- Contract v1 defense-in-depth exclusion; and
- Layer 4 `NOT_ATTEMPTED` behavior for rejected identities.

Existing Layer 2/3 tests continue to cover duplicate OCR blocks, label-only/empty identities, numbered templates, and liquid concentration uncertainty. Existing integration tests cover Contract v1 serialization and Layers 4-5 behavior.

## Verification evidence

| Gate | Result |
|---|---|
| Original numbered-row regression | 4 passed |
| Focused extractor/parser/mapper group | 44 passed |
| Complete Layer 2 and Layer 3 | 128 passed |
| Intelligence integration tests | 111 passed |
| Full Python suite | 447 passed, 0 failed |
| Backend Contract/worker consumers | 45 passed, 0 failed |
| Python dependency consistency | `pip check` passed |

The first integration invocation encountered an inaccessible sandbox-owned default pytest temp directory. It was rerun unchanged with a task-owned `--basetemp`; all 111 tests passed. Pytest still warns that the pre-existing `intelligence/.pytest_cache` is inaccessible, but this does not affect test execution.

All extraction tests used synthetic OCR blocks or mocked provider output. No genuine EasyOCR/PaddleOCR/TrOCR inference was necessary or claimed in Batch 2.

## Contract and backend compatibility

No public Contract v1 fields, status values, or response shapes changed. The eligibility flag is internal and defaults to eligible for established constructors and confirmed-review inputs. The backend validation, result mapper, HTTP client, initial V3 worker, and confirmed-review worker tests all passed.

## Remaining limitations

- Provenance is scoped to page/block evidence generated during one processing request; it is not a globally persistent evidence identifier.
- Provider regions with incomplete evidence intentionally fail closed and may require more manual review.
- Genuine OCR accuracy and resource behavior remain the separate AUD-INT-003 coverage task.
- The inaccessible pytest cache should be repaired only through an ownership-aware maintenance action, not by weakening test configuration.
- This local fix has not been committed or pushed.

## Future OCR accuracy improvements

- Persist provider-neutral evidence IDs alongside review evidence without changing Contract v1.
- Measure false-positive/false-negative exclusion on privacy-safe genuine OCR fixtures.
- Add calibrated provider disagreement signals before identity extraction.
- Keep uncertain text available for human correction without promoting it to catalogue matching.

## Final safety review

- Unverified evidence accepted as medicine: NO.
- Legitimate numbered medicines preserved: YES.
- Duplicate/overlapping evidence bypass: prevented and tested.
- Layer 4/5 generated from rejected identities: NO.
- Label-as-medicine regression: existing tests pass.
- Liquid concentration uncertainty: existing tests pass.
- Warning/evidence retained: YES.
- Backend consumers compatible: YES.

BATCH_2_STATUS: COMPLETE
