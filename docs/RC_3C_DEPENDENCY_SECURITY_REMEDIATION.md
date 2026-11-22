# RC-3C Dependency Security Remediation

Date: 2026-11-20 (Asia/Calcutta)
Branch: `main`
Starting commit: `dfcfbc35f418594cbde45da9b0f5e71172b81153`
Result: **PARTIAL** — the authorized Pillow and Starlette findings are remediated and functionally verified, but PyTorch advisories and model-weight licensing remain release review items.

## Scope and preserved state

RC-3C changed only the shared local-runtime dependency input and its five generated Windows locks. Existing RC-5 through RC-5D artifacts, `intelligence/.venv`, datasets, OCR caches, `MedDecode-dev`, migrations, and unrelated reports were preserved. No hosted service, cloud OCR provider, package mirror other than the existing official sources, or production environment was changed.

Target platform: CPython 3.12.10, Windows x64 (`AMD64`).

## Authorized version changes

| Package | Before | After | Compatibility evidence |
| --- | ---: | ---: | --- |
| Pillow | 12.3.0 | 13.0.0 | Resolves in all profiles; Windows CPython 3.12 binary wheel installed; genuine EasyOCR and document parsing passed. |
| Starlette | 1.0.0 | 1.3.1 | Compatible with FastAPI 0.136.1's declared `starlette>=0.46.0`; installs and passes HTTP, readiness, timeout, cancellation, and full-suite tests. |

FastAPI remains 0.136.1 and EasyOCR remains directly declared at 1.7.2. PaddleOCR/PaddlePaddle remain confined to `runtime-adaptive-paddle.in`; boto3 and Google Cloud Vision remain confined to their optional profiles. PyPI remains the only general index.

## Lock integrity

All locks were regenerated with pip-tools 7.5.2, the backtracking resolver, hashes, unsafe-package inclusion, and binary-only clean-install verification.

| Lock | SHA-256 |
| --- | --- |
| `win-py312-runtime-local.txt` | `6E0CA8376D23F963821FF702F28E4EFF3F83DAF25C6317AA2712967605B5A1F8` |
| `win-py312-test.txt` | `EA160DC9A1E0D8550A5585EF244E3DD14FDA60D5405380A0808E9EA5516ACDA6` |
| `win-py312-runtime-adaptive-paddle.txt` | `E76C43F9C942B302CA4664BA91507D568E3EFD13E52FDEA6D47477D370ACAFF8` |
| `win-py312-cloud-aws.txt` | `72C3C71BF80A8B5DAA5E5A651D62ECD5C6EECEA7E685537153A739D673A8A5CD` |
| `win-py312-cloud-google.txt` | `2C048B7C50559DAB6369BEFAC00401EAF82CA7D566109F530D5853C9DF288FE1` |

Every lock contains Pillow 13.0.0 and Starlette 1.3.1. The exact official CPU wheels and hashes are unchanged:

- PyTorch 2.6.0+cpu: `download.pytorch.org`, SHA-256 `4027D982EB2781C93825AB9527F17FBBB12DBABF422298E4B954BE60016F87D8`.
- torchvision 0.21.0+cpu: `download.pytorch.org`, SHA-256 `667F3D983240F41EAFF5A3F78BDCBC144473978A37CD15A4DB6DAD92B1E8B6F0`.

The lock diff consists of the two direct version changes and their official artifact hashes. Each profile retained its established generator options: the adaptive-Paddle lock uses `--strip-extras`; runtime, test, AWS, and Google retain their existing non-stripped form. No provider, index, or unrelated version changed.

## Two clean installations

Two independent empty environments were created outside the repository. Each installed `win-py312-test.txt` with `--require-hashes --only-binary=:all:`.

| Check | Clean A | Clean B |
| --- | --- | --- |
| Python / architecture | 3.12.10 / AMD64 | 3.12.10 / AMD64 |
| Pillow / Starlette / FastAPI | 13.0.0 / 1.3.1 / 0.136.1 | 13.0.0 / 1.3.1 / 0.136.1 |
| EasyOCR / torch | 1.7.2 / 2.6.0+cpu | 1.7.2 / 2.6.0+cpu |
| `pip check` | PASS | PASS |
| Full Python suite | 453 passed | 453 passed |
| Dependency/model tests | 4 passed | 4 passed |

Sorted `pip freeze --all` inventories were byte-for-byte identical. Optional Paddle and cloud packages were not introduced into the default/test installation.

## Genuine OCR and supervision

Both clean environments ran genuine EasyOCR sequentially against the same generated fictional printed fixture with downloads, PaddleOCR, TrOCR, and cloud OCR disabled. Each recovered two of two medicine names and the expected strengths, units, schedules, timings, and durations, with zero critical numeric substitutions.

| Evidence | Clean A | Clean B |
| --- | ---: | ---: |
| Fixture count | 1 | 1 |
| Total benchmark time | 22.148 s | 25.242 s |
| Medicine names correct | 2/2 | 2/2 |
| Critical numeric substitutions | 0 | 0 |

An independent supervised run used fictional scanned PDF SHA-256 `4920C32CBB5E4E5FE33B5FA253ADC7EE0DCC6766567472FC9AB8356D35A6645B` (1,043,066 bytes). It completed with warnings in 16,750 ms, recorded 19 EasyOCR predictions, returned one review-eligible medicine and four conservative warnings, and measured peak child process-tree RSS of 1,287,426,048 bytes. This remained below the unchanged 2 GiB supervisor limit. Supervisor shutdown completed and no OCR child remained.

This evidence demonstrates functional processing of fictional data, not clinical accuracy.

## FastAPI and contract verification

- FastAPI `/health` and `/ready`: HTTP 200 in both clean environments against the disposable restricted PostgreSQL 17 catalogue.
- Restricted catalogue query and ACL fixture: PASS; four synthetic records, read-only identity.
- Focused Python supervisor, HTTP, parsing, Layers 2, 4, and 5 set: 227 passed.
- Focused backend intelligence contracts: 53 passed, including genuine confirmed-review Python Layers 4-5.
- Backend typecheck: PASS.
- `git diff --check`: PASS.

Starlette 1.3.1 emits two upstream transition warnings in tests: FastAPI's TestClient import warns that httpx support is deprecated in favor of httpx2, and Starlette references AnyIO's deprecated `anyio.abc.BlockingPortal` alias. These are warnings, not assertion or runtime failures, and remain tracked rather than suppressed.

## Vulnerability rescan

Source: OSV query API (`https://api.osv.dev/v1/querybatch` and advisory detail API).
Query date: 2026-11-20.
Scope: 126 unique package/version identities across all five locks. Aliases were grouped by shared GHSA/CVE identifiers.

- Pillow 13.0.0: no OSV advisory returned. The previously reported Pillow findings are cleared at the locked identity.
- Starlette 1.3.1: no OSV advisory returned. The previously reported Starlette findings are cleared at the locked identity.
- Residual locked-package finding: PyTorch 2.6.0+cpu returned 22 OSV records representing 19 normalized vulnerability groups after duplicate GHSA/PYSEC aliases were combined. Fixed versions range from 2.7.0 through 2.13.0 depending on the issue; several are local memory-corruption or denial-of-service issues, and at least one concerns untrusted checkpoint deserialization. MedDecode uses hash-verified local EasyOCR weights and does not accept checkpoint uploads, reducing exposure to the untrusted-checkpoint path, but torch remains a reachable OCR runtime dependency. This is unresolved and must receive a separately reviewed compatible PyTorch/torchvision upgrade; RC-3C did not auto-upgrade it.
- Tooling-only finding: the venv bootstrap's pip 25.0.1 is not a locked application identity, but OSV reports six canonical advisory groups (twelve alias records), with fixes spanning pip 25.3 through 26.2.0. Installations used fully hashed binary artifacts and official sources, reducing but not eliminating tooling risk. Bootstrap pip should be explicitly updated and locked in a separate reproducibility change.

No claim of a vulnerability-free environment is made.

## Model integrity and licensing

The model verifier passed in both clean environments without downloading assets.

| Model | SHA-256 |
| --- | --- |
| `craft_mlt_25k.pth` | `4A5EFBFB48B4081100544E75E1E2B57F8DE3D84F213004B14B85FD4B3748DB17` |
| `english_g2.pth` | `E2272681D9D67A04E2DFF396B6E95077BC19001F8F6D3593C307B9852E1C29E8` |

The bytes match the existing approved manifest and EasyOCR's published MD5 identities. Weight-specific origin and redistribution licensing remain incompletely established; the source project's Apache-2.0 license alone is not treated as proof of the model weights' redistribution terms. Therefore full RC-3 closure is not claimed.

## Files changed

- `intelligence/requirements/runtime-local.in`
- `intelligence/requirements/locks/win-py312-runtime-local.txt`
- `intelligence/requirements/locks/win-py312-test.txt`
- `intelligence/requirements/locks/win-py312-runtime-adaptive-paddle.txt`
- `intelligence/requirements/locks/win-py312-cloud-aws.txt`
- `intelligence/requirements/locks/win-py312-cloud-google.txt`
- `docs/RC_3C_DEPENDENCY_SECURITY_REMEDIATION.md`

## Cleanup and remaining blockers

The disposable PostgreSQL catalogue was stopped after verification. Task-owned clean environments, compiler environment, temporary inventories, OCR evidence, and pytest directories were retained until all evidence had been recorded, then are eligible for task-owned cleanup. No hosted mutation occurred.

Remaining release blockers:

1. separately review and test a compatible PyTorch/torchvision security upgrade;
2. pin a non-vulnerable packaging/bootstrap pip version without changing the runtime graph unexpectedly;
3. establish model-weight-specific license and redistribution evidence;
4. address the upstream FastAPI/Starlette TestClient transition warnings when the supported contract is available.

```text
RC_3C_STATUS: PARTIAL
PILLOW_VERSION: 13.0.0
STARLETTE_VERSION: 1.3.1
FASTAPI_VERSION: 0.136.1
CLEAN_INSTALL_1: PASS
CLEAN_INSTALL_2: PASS
INVENTORY_COMPARISON: IDENTICAL
VULNERABILITY_RESCAN: PARTIAL - Pillow and Starlette cleared; PyTorch and bootstrap pip findings remain
GENUINE_EASYOCR: PASS
PEAK_MEMORY: 1,287,426,048 bytes process-tree RSS
PYTHON_TESTS: 453 passed in each clean environment
BACKEND_CONTRACT_TESTS: 53 passed
FASTAPI_READINESS: PASS in both clean environments
MODEL_INTEGRITY: PASS
MODEL_LICENSES: PARTIAL
HOSTED_MUTATIONS: NONE
```
