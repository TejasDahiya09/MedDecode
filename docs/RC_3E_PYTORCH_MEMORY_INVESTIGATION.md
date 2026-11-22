# RC-3E PyTorch memory investigation

Date: 2026-11-22

Branch: `main`
Starting checkpoint: `9ba0d9b35ad8f3abec7a4c8b439e281c6e7e6ead`

## Decision

**PASS for the local candidate; not committed or pushed.** The Torch 2.13 CPU
candidate can remain below the unchanged 2 GiB process-tree limit when the
supervised OCR child starts with both native CPU thread pools explicitly
bounded to one thread. The candidate passed independent cold and repeated
process runs, produced the same clinical extraction as Torch 2.6, and passed
the Python, backend-contract, readiness, cancellation, cleanup and OSV gates.

This is a narrowly scoped candidate promotion in the working tree only. No
hosted configuration or existing virtual environment changed.

## Root cause

The original failure was a reproducible **cold-start native CPU thread-pool
working-set spike**, not retained OCR tensors, duplicate model instances, the
PDF renderer, or steady-state Torch 2.13 memory.

A second newly created Torch 2.13 environment failed the normal 2 GiB
supervisor twice before any warm-up. Direct 20 ms sampling showed:

| Stage | Cold Torch 2.13 RSS after stage |
|---|---:|
| Python plus `import torch` | 201,035,776 bytes |
| after `import torchvision` | 285,249,536 bytes |
| after first `import easyocr` | 1,598,947,328 bytes |
| EasyOCR detector/recognizer model load | 1,786,384,384 bytes |
| decode and preprocessing | 1,820,524,544 bytes |
| detection stage end | 1,781,313,536 bytes |
| recognition stage end | 1,806,036,992 bytes |
| sampled cold peak | **2,602,319,872 bytes** |

The same environment's second direct process peaked at 1,313,603,584 bytes.
Its stage-end RSS after `import easyocr` was only 311,611,392 bytes. This
explains why warmed runs could pass while a clean deployment remained unsafe.

Setting `torch.set_num_threads(1)` after importing Torch did not solve the
cold spike: it still peaked at 2,561,826,816 bytes. Wrapping only inference in
`torch.inference_mode()` also could not explain the lower run because the
large variation occurred before the context was entered. The effective change
was setting `OMP_NUM_THREADS=1` and `MKL_NUM_THREADS=1` in the child environment
**before Python imports Torch and EasyOCR**.

The supervisor continues to measure the full Windows descendant working set
at 100 ms intervals and retains its original 2,147,483,648-byte limit.

## Experiments

| Experiment | Peak | Duration/result | Disposition |
|---|---:|---|---|
| Torch 2.13 default, original RC-3D run | 2,614,632,448 | functional only with measurement-only 4 GiB ceiling | rejected |
| Torch 2.13 new environment, default cold run | >2 GiB | `PROCESSING_MEMORY_LIMIT` | rejected |
| same environment, second default run | >2 GiB | `PROCESSING_MEMORY_LIMIT` | rejected |
| direct profile, threads changed after import | 2,561,826,816 | 19 predictions, 36.9 s | ineffective and slower |
| direct profile, warmed default | 1,313,603,584 | 19 predictions, 15.3 s | not acceptable as cold-start evidence |
| new cold environment, OMP/MKL set to 1 before import | **1,316,659,200** | completed, 19 predictions, 49.75 s | pass |
| independent second bounded child process | **1,318,043,648** | completed, 19 predictions, 39.94 s | pass |
| candidate evidence run with Contract output | 1,327,878,144 | completed, 19 predictions, 33.86 s | pass |
| Torch 2.6 baseline with the same thread bound | 1,296,936,960 | completed, 19 predictions, 49.77 s | pass |
| Torch 2.6 Contract comparison run | 1,299,832,832 | completed, 19 predictions, 37.27 s | pass |

The higher latency remains below the unchanged 120-second processing timeout.
No detector or recognizer stage was removed, no precision was reduced, and no
model file was changed.

## OCR comparison

Both versions returned `completed_with_warnings`, one medicine, three warnings,
19 EasyOCR predictions, and the same provenance route. Both extracted:

- identity: `Examplemed`
- strength: `10 mg`
- dosage form: unknown/null
- frequency, timing and duration: conservatively unknown
- catalogue status: unmatched
- instruction association warning: preserved
- recommendations: identical

Warnings and recommendations were byte-equivalent after JSON normalization.
Medicine data differed only in extraction confidence:
`0.8076282581125733` on Torch 2.6 versus `0.8076281193732882` on Torch 2.13
(absolute delta approximately 1.39e-7). No identity, strength, unit, timing,
duration, warning, provenance or recommendation changed.

## Candidate implementation

`ProcessingSupervisor` now explicitly supplies `OMP_NUM_THREADS=1` and
`MKL_NUM_THREADS=1` to its isolated OCR child. This happens after filtering the
parent environment, so arbitrary parent values cannot silently weaken the
bound. Explicit `environment_overrides` remain available for isolated tests.
A regression test confirms both child values.

The dependency input uses the official CPU-only pair:

- `torch 2.13.0+cpu`, CPython 3.12 Windows x64 wheel SHA-256
  `a8b450c1e58e5800e5b4691dac412f8d2d65a1dc3298166f91596603a3531e6f`
- `torchvision 0.28.0+cpu`, CPython 3.12 Windows x64 wheel SHA-256
  `d88db83abbdfb97199979ec94dd427bc372c1b9ab01f0dbed20af05b0bd644b1`

The five current candidate lock hashes are:

| Lock | SHA-256 |
|---|---|
| `win-py312-runtime-local.txt` | `9C8DCB1A9A5A4C14E0E2C691D963A79D2C522AE833CC66CE55869EE943F7459B` |
| `win-py312-test.txt` | `63221B1A23315526D22BCA1B8011E683F716B416A5C31D935332EDE52708C3C9` |
| `win-py312-runtime-adaptive-paddle.txt` | `E2A001DC7B2B177C3BBEA2BFD05888E028B8DB4E7910E948A30C2E4824835277` |
| `win-py312-cloud-aws.txt` | `6B494D104033C806C4AD30FC5CF6166886B239EE84D8F74FB31C30BDFB683C7D` |
| `win-py312-cloud-google.txt` | `AFAEA69B24509B83CD4188DB4B759F2001CCEB855DEAD6C88621321338C31AC1` |

Two disposable environments built by the same baseline-lock-plus-reviewed-wheel
procedure contained 71 identical sorted distributions. Both reported
`torch 2.13.0+cpu`, `torchvision 0.28.0+cpu`, CUDA unavailable, and clean
dependency checks. A subsequent clean install should use the candidate lock
directly before commit review.

## Verification

- Full candidate Python suite: **453 passed**, two third-party deprecation
  warnings, 34.99 seconds.
- Focused supervisor suite: **10 passed**, including timeout, cancellation,
  process-tree termination, bounded output and the new thread-bound assertion.
- Backend intelligence-contract suite: **53 passed**, zero failures/skips.
- Backend TypeScript typecheck: passed.
- FastAPI candidate `/health`: `200`, `status=alive`.
- FastAPI candidate `/ready`: `200`, `status=ready`, against the disposable
  restricted local catalogue.
- EasyOCR cache: `MODEL_CACHE_VERIFY_OK`; no model was downloaded or modified.
- Candidate direct OSV query on 2026-11-22: zero findings for `torch 2.13.0`,
  `torchvision 0.28.0`, `pip 26.3`, and `pip-tools 7.7.0`.
- `git diff --check`: passed.

## Safety and limitations

- The 2 GiB guard was never weakened. A 4 GiB limit was used only by RC-3D to
  measure the rejected configuration and is not present in source/configuration.
- The production OCR provider remains EasyOCR; adaptive PaddleOCR, TrOCR and
  cloud OCR were not activated.
- This evidence covers the reviewed fictional scanned PDF, not clinical
  accuracy or arbitrary document populations.
- The single-thread bound trades throughput/latency for deterministic cold
  memory. Concurrency remains one, so it does not weaken queue controls.
- Model redistribution/licensing provenance remains the separate RC-3B issue.
- Changes remain uncommitted and require independent review before release.

## Promotion decision

**Candidate eligible for review and later commit, but not committed here.** It
meets RC-3E's local acceptance gate: genuine OCR, two independent bounded
processes below 2 GiB, stable extraction, full Python and backend tests,
readiness, cancellation/cleanup, reproducible inventories and intended OSV
improvement. No hosted promotion or runtime activation occurred.
