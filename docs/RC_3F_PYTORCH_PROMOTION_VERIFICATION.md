# RC-3F PyTorch promotion verification

Date: 2026-11-22

Branch: `main`
Starting checkpoint: `9ba0d9b35ad8f3abec7a4c8b439e281c6e7e6ead`

## Decision

**PASS.** The RC-3E Torch 2.13 CPU candidate was independently installed from
the final hash-locked test profile and passed every mandatory local promotion
gate. The unchanged 2 GiB process-tree guard remained active. No hosted service,
model cache, dataset, existing virtual environment, or RC-5 artifact changed.

## Recovered and reviewed work

The interrupted RC-3F work consisted of the RC-3E dependency candidate, five
generated locks, the child-only OMP/MKL thread bound, its regression test, and
the RC-3E report. Branch and remote were synchronized at the starting
checkpoint (`0 0`). The review added one narrow regression proving hostile
parent values (`32`) cannot override the child's required values (`1`).

The bound is written only into the environment passed to the supervised OCR
subprocess before child Python imports Torch. It does not mutate the parent
environment. Explicit test-only `environment_overrides` are applied afterward.
The 2,147,483,648-byte ceiling, 120-second processing timeout, cancellation,
bounded streams and process-tree termination are unchanged. Worker/job fencing,
authentication, catalogue isolation and OCR provenance code were untouched.

## Dependency integrity

| Lock | SHA-256 |
|---|---|
| `win-py312-runtime-local.txt` | `9C8DCB1A9A5A4C14E0E2C691D963A79D2C522AE833CC66CE55869EE943F7459B` |
| `win-py312-test.txt` | `63221B1A23315526D22BCA1B8011E683F716B416A5C31D935332EDE52708C3C9` |
| `win-py312-runtime-adaptive-paddle.txt` | `E2A001DC7B2B177C3BBEA2BFD05888E028B8DB4E7910E948A30C2E4824835277` |
| `win-py312-cloud-aws.txt` | `6B494D104033C806C4AD30FC5CF6166886B239EE84D8F74FB31C30BDFB683C7D` |
| `win-py312-cloud-google.txt` | `AFAEA69B24509B83CD4188DB4B759F2001CCEB855DEAD6C88621321338C31AC1` |

The independently created environment installed directly from the final test
lock with `--require-hashes`. Evidence:

- CPython 3.12.10, Windows x64.
- Torch 2.13.0+cpu and torchvision 0.28.0+cpu; CUDA unavailable.
- Pillow 13.0.0, Starlette 1.3.1 and FastAPI 0.136.1.
- `pip check`: no broken requirements.
- Official exact CPU wheel URLs and SHA-256 fragments are embedded in every
  applicable lock; no unrestricted extra index is configured.
- Paddle, AWS and Google remain separate opt-in input/lock profiles.

## Independent acceptance

- Full Python suite: **454 passed**, two third-party deprecation warnings,
  35.33 seconds.
- Focused supervisor group: **11 passed**, including hostile-parent override,
  timeout, cancellation, output bounding and process cleanup.
- Backend intelligence contracts: **53 passed**, zero failures/skips.
- Backend typecheck: passed.
- FastAPI `/health`: HTTP 200, `alive`.
- FastAPI `/ready`: HTTP 200, `ready`, against the restricted disposable
  PostgreSQL catalogue.
- Model cache: `MODEL_CACHE_VERIFY_OK`; weights were not downloaded or changed.

### Genuine sequential OCR

Both executions used the same fictional PDF SHA-256
`4920c32cbb5e4e5fe33b5fa253adc7ee0dcc6766567472fc9ab8356d35a6645b`
and the normal 2 GiB guard. Parent OMP/MKL values were absent, so the
supervisor-provided child values were exercised.

| Run | Status | Duration | Peak process-tree RSS | Predictions |
|---|---|---:|---:|---:|
| 1 | completed with warnings | 48,750 ms | 1,320,755,200 bytes | 19 EasyOCR |
| 2 | completed with warnings | 34,031 ms | 1,329,926,144 bytes | 19 EasyOCR |

Both output contracts were identical: `Examplemed`, `10 mg`, extraction
confidence `0.8076281193732882`, one medicine, three identical warnings,
identical recommendations and identical provenance. No result was fabricated
and no detection or recognition stage was omitted.

## Security rescan

A fresh OSV API query on 2026-11-22 returned zero reported findings for each
exact queried version: Torch 2.13.0, torchvision 0.28.0, Pillow 13.0.0,
Starlette 1.3.1, pip 26.3 and pip-tools 7.7.0. Aliases were inspected where
present; none were returned for these versions. This is database evidence at
scan time, not proof that the packages contain no unknown vulnerabilities.

The EasyOCR model cache passed its repository manifest/hash verifier and remains
outside Git. Model-specific redistribution/licensing provenance remains the
separate unresolved RC-3B limitation.

## Scoped promotion files

- `intelligence/app/integration/process_supervisor.py`
- `intelligence/tests/integration/test_process_supervisor.py`
- `intelligence/requirements/runtime-local.in`
- the five `intelligence/requirements/locks/win-py312-*.txt` profiles
- `docs/RC_3E_PYTORCH_MEMORY_INVESTIGATION.md`
- this report

Commit result is intentionally recorded after Git creates the commit; the
console handoff is authoritative for its final SHA and push result.

## Remaining limitations

- Evidence is local, Windows CPU-only and based on the reviewed fictional
  fixture; it is not clinical accuracy validation.
- Single-thread CPU inference trades latency for deterministic cold-start
  memory. Observed durations remained below the unchanged timeout.
- Adaptive PaddleOCR, TrOCR and cloud OCR were not activated.
- Model redistribution/licensing provenance remains unresolved.
