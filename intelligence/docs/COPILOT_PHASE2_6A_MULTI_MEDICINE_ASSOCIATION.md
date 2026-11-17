# COPILOT PHASE 2.6A — MULTI-MEDICINE ASSOCIATION

## Summary

Layer 2 previously kept a single "current medicine" and attached any later
instruction-like line to it until another medicine appeared. It did not split
inline instructions from medicine text, validate spatial proximity, preserve
uncertain ownership, join medicine name/strength lines, or collapse duplicate
OCR text. Those behaviors could cause false entries or silently associate an
instruction with the wrong medicine.

The revised extraction keeps entry boundaries, attaches instructions only with
same-line evidence, clear same-page adjacency, or a unique explicit medicine
reference, and emits a prescription warning when ownership remains unresolved.
No medicine is selected based on usual clinical usage or catalogue popularity.

All measurements below use deterministic fictional inputs. They are test
evidence, not clinical or real-handwriting accuracy.

## Algorithm implemented

1. Reconstruct lines in page-coordinate order. When identical text blocks
   overlap by at least 80% of the smaller bounding-box area, use the text once
   while retaining all original block indexes in the line evidence. Identical
   text at separate positions is not deduplicated.
2. Recognize numbered list prefixes for extraction, but keep the original
   numbered OCR text and block indexes in source evidence.
3. Split an explicitly recognizable inline schedule/timing/duration suffix
   from the medicine text. Keep its source line as the evidence for both
   fields.
4. Join an adjacent strength-only continuation to the current medicine entry.
   The line must be on the same page, within the adjacency bounds below, and
   no unrelated line or new medicine may have closed the entry.
5. Attach a separate instruction line only when it is on the same page, is
   within `max(40 coordinate units, 2.5 × line height)` vertically and
   `max(45 coordinate units, 2.5 × line height)` horizontally, and no
   intervening non-entry line has closed the association.
6. Resolve an explicit `Medicine reference: instruction` only when the text
   identifies exactly one medicine by substring. References encountered
   before their medicine are deferred until all medicine entries have been
   collected. Similar-name matches remain unresolved.
7. Preserve unresolved instruction text and source location in a
   `medicine_instruction_association` extraction warning. Conflicting
   instructions with clear ownership stay with that medicine; existing Layer
   3 conflict handling leaves conflicting structured values unknown.

The thresholds are based on OCR coordinates and line heights. They are
conservative heuristics, not universal document-layout rules.

## Fixtures and measured results

`tests/layer2/multi_medicine_fixtures.py` creates the same 30 fictional
prescriptions for each run, with 100 labelled entries total: ten each with
two, three, or five medicines. Fifteen prescriptions exercise adversarial or
ambiguous conditions. The evaluation suite covers inline and multiline
strengths, numbered lists, missing dose/duration, conflicting instructions,
English and Romanized Hindi timing, fractional schedules, repeated OCR blocks,
out-of-order OCR blocks, fixed-dose combinations, decimal strengths, and
spatially ambiguous instructions. Focused tests additionally cover similar
medicine names and explicit references.

Baseline was evaluated from committed revision
`503336431a31e47a38b98d6ff668818e7aa8d178` using the same final fixture module.
Results are exact fixture outcomes; they are not estimates of clinical
performance.

| Metric | Baseline | Updated |
| --- | ---: | ---: |
| Medicine entry precision | 74/103 (71.84%) | 100/100 (100%) |
| Medicine entry recall | 74/100 (74.00%) | 100/100 (100%) |
| Medicine entry F1 | 72.91% | 100% |
| Correct instruction associations | 71/97 (73.20%) | 97/97 (100%) |
| Strength association | 74/100 (74%) | 100/100 (100%) |
| Duration association | 71/100 (71%) | 100/100 (100%) |
| Frequency/schedule association | 71/100 (71%) | 100/100 (100%) |
| Cross-medicine/unexpected instruction assignments | 3 | 0 |
| Unsafe numeric strength substitutions | 0 | 0 |
| Ambiguous ownership preserved | 0/3 | 3/3 |

Baseline produced 29 non-matching extra entries and missed 26 labelled entries.
The three cross-medicine/unexpected assignments were spatially remote
instructions that the previous implementation attached to the latest medicine.
The updated implementation abstained and retained those lines in warnings.

### Error analysis

The measured baseline failures came from multiline strength lines being treated
as separate records, inline instructions remaining inside medicine text,
numbered list prefixes not being recognized, duplicate OCR text, and remote
instructions being attached without checking layout. The updated fixture run
had no incorrect entry, strength, duration, or frequency values, and no
cross-medicine assignments. The three deliberately ambiguous instructions were
not assigned and remained visible in extraction warnings.

The test fixtures independently label the source strings, strengths, schedules,
and durations. The evaluation asserts exact numerators/denominators and exits
nonzero on regression. Run the benchmark from `intelligence\`:

```powershell
.\.venv\Scripts\python.exe tests\layer2\benchmark_multi_medicine.py --baseline 503336431a31e47a38b98d6ff668818e7aa8d178
.\.venv\Scripts\python.exe tests\layer2\benchmark_multi_medicine.py
```

The benchmark script accepts another git revision through `--baseline` to
reproduce the before/after comparison.

## Files changed for this phase

- `intelligence/app/layer2_information_extraction/document_context.py`
  - Suppresses exact duplicate text from overlapping OCR regions while
    retaining all source block indexes.
- `intelligence/app/layer2_information_extraction/medicine_extractor.py`
  - Adds inline splitting, numbered-entry handling, strength-line continuation,
    adjacency checks, explicit-reference matching, duplicate-safe evidence,
    and fail-closed unresolved-association warnings.
- `intelligence/app/layer2_information_extraction/pipeline.py`
  - Carries unresolved association warnings into the existing
    `PrescriptionRecord.warnings`.
- `intelligence/tests/layer2/multi_medicine_fixtures.py`
  - Deterministic fictional labelled fixture generator.
- `intelligence/tests/layer2/test_multi_medicine_evaluation.py`
  - Benchmark assertions and focused adversarial association tests.
- `intelligence/tests/layer2/benchmark_multi_medicine.py`
  - Reproducible current/baseline benchmark runner.

Pre-existing uncommitted Layer 2/3 work, including numbered-row handling and
other parser tests, was inspected and left intact. No Layer 1, FastAPI,
Contract v1, backend, frontend, database, Layer 4, or Layer 5 files were changed
for this phase. No model or external service was used.

## Test evidence

Run from `C:\Users\dahiy\MedDecode-integration\intelligence` with the project
virtual environment:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\layer2 tests\layer3 -q
.\.venv\Scripts\python.exe -m pytest tests\integration\test_contract_v1_mapper.py -q
.\.venv\Scripts\python.exe -m pytest -q
```

Final results:

- Layer 2 and Layer 3: **111 passed**
- Contract v1 mapper: **6 passed**
- Full Python suite: **394 passed, 1 pre-existing Starlette deprecation warning**

The Contract v1 mapper and schema were not changed. Association warnings use
the existing prescription warning channel and are covered by the mapper
regression tests.

## Provenance and schema limitations

- `RawMedicineEntry` retains the raw medicine text, instructions, page number,
  confidence, and `SourceEvidence` containing source text and OCR block indexes.
  Inline text is split for extraction, but evidence retains the original
  unmodified OCR line.
- `PrescriptionRecord.warnings` can preserve an unassigned instruction with
  page and block indexes. The current schema cannot represent the set of
  candidate medicine entries for that instruction, a field-level abstention
  state, or an editable instruction-to-entry correction link.
- `MedicineUsageRecord` has no structured route or quantity fields. Notes that
  cannot be safely parsed remain in source/additional instruction text rather
  than being promoted to invented fields.
- The current source-evidence schema has no bounding-box field on each
  `SourceEvidence`; layout is used during extraction but only page and block
  indexes are propagated with the medicine record.

### Codex integration handoff

Keep the current Layer 2/3 and Contract v1 interfaces unchanged for this
integration. For the Architecture V3 review experience, define a separate
review representation for unassociated source instructions that carries raw
text, page/block evidence, an explicit unresolved status, and optionally
candidate medicine sequence numbers only when supported by evidence. Do not
silently convert global warnings into a medicine association. Route and
quantity support require an agreed schema extension before structured values
can be exposed.

## Remaining limitations and safety risks

- Multiple medicine entries concatenated into one visual OCR line or separate
  columns are not split by this implementation.
- Association thresholds may abstain on unusual page scaling, rotated pages,
  large gaps, handwriting layout, or OCR coordinates with inconsistent units.
- Explicit references are limited to simple unique text references; aliases,
  pronouns, and fuzzy/similar-name references are not inferred.
- Instructions that cannot be uniquely associated are retained as global
  extraction warnings, not as medicine-owned instructions.
- Real prescriptions, real handwriting, clinical outcomes, and production
  association accuracy were not evaluated.
- Layer 3 does not currently represent route or quantity as structured fields.

## Rollback

No commit was created. To back out this phase, revert only the Phase 2.6A
changes in the three Layer 2 implementation files and remove the three new
Phase 2.6A test/benchmark files plus this report. Do not restore whole files
from Git: the working tree already contained unrelated and prior-phase changes
in these files, which must be preserved.

## Final status

MEDICINE_ENTRY_SEGMENTATION: VERIFIED

INSTRUCTION_ASSOCIATION: VERIFIED

MULTILINE_SUPPORT: VERIFIED

STRENGTH_ASSOCIATION: VERIFIED

AMBIGUITY_PRESERVATION: VERIFIED

DUPLICATE_HANDLING: VERIFIED

ADVERSARIAL_TESTING: VERIFIED

CONTRACT_V1_COMPATIBILITY: VERIFIED

FULL_PYTHON_SUITE: VERIFIED

READY_FOR_INTEGRATION: YES

`YES` means ready for Codex integration review of the unchanged interfaces; it
does not certify real-world or production prescription accuracy.
