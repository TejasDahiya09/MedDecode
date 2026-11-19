# RC-3 Python Dependency Reproducibility Plan

Plan date: 2026-11-19 (Asia/Calcutta)
Baseline branch: `main`
Baseline commit: `10108a38d7e5bd9407f6ac2768aaf8c180bda957`
Status: planning only; no package installation, upgrade, or model download performed

## Objective and release boundary

RC-3 will turn the currently working but resolver-dependent Python environment into a reproducible Windows x64 CPython environment. It must preserve the verified local EasyOCR default, keep adaptive PaddleOCR and cloud OCR explicit, and prove installation from empty virtual environments without relying on the existing `.venv`.

This work is required for a controlled fictional-data pilot or production packaging. It is not permission to change provider selection, download models, call a cloud service, or modify hosted configuration.

## Current baseline

The inspected host is Windows x64 (`win-amd64`) with CPython 3.12.10 and pip 25.0.1. The current environment passes `pip check`. Important installed versions include:

- EasyOCR 1.7.2
- PyTorch 2.6.0+cpu and torchvision 0.21.0+cpu
- PaddleOCR 3.7.0 and PaddlePaddle 3.2.2
- NumPy 2.2.6, Pillow 12.3.0, PyMuPDF 1.28.2
- FastAPI 0.136.1, Starlette 1.0.0, Uvicorn 0.46.0
- psycopg 3.3.9, Supabase 2.34.1, python-dotenv 1.2.4
- pytest 9.1.1

The current files are dependency declarations, not locks:

- `intelligence/requirements.txt`
- `intelligence/requirements-test.txt`
- `intelligence/requirements-cloud-aws.txt`
- `intelligence/requirements-cloud-google.txt`

Several runtime packages are unpinned. More importantly, EasyOCR and its CPU PyTorch runtime are not declared directly even though EasyOCR is the default provider. PaddleOCR and PaddlePaddle are currently in the mandatory runtime despite adaptive PaddleOCR being disabled by default. Optional cloud SDKs are already separated and are correctly absent from the local-default profile.

## Target interpreter and platform

The first reproducible target will be exactly:

```text
CPython: 3.12.10, 64-bit
ABI tag: cpython-312
Platform: win-amd64
Operating system family: supported Windows x64
```

The repository should add a machine-readable Python-version declaration and make bootstrap scripts reject a different major/minor or architecture. Patch-version policy must be explicit: use 3.12.10 for the first lock verification; a later patch upgrade requires lock regeneration and the full RC-3 gate.

Locks are platform-specific because OCR packages contain native wheels. Linux or GPU deployments require separately generated and verified lock sets; the Windows lock must not be presented as portable.

## Proposed dependency profiles

Keep small human-reviewed input files separate from generated fully pinned lock files:

```text
requirements/runtime-local.in
requirements/runtime-adaptive-paddle.in
requirements/test.in
requirements/cloud-aws.in
requirements/cloud-google.in

requirements/locks/win-py312-runtime-local.txt
requirements/locks/win-py312-runtime-adaptive-paddle.txt
requirements/locks/win-py312-test.txt
requirements/locks/win-py312-cloud-aws.txt
requirements/locks/win-py312-cloud-google.txt
```

Profile rules:

1. `runtime-local.in` declares every direct dependency needed by FastAPI, catalogue access, PDF/image processing, and EasyOCR. EasyOCR and the approved CPU PyTorch packages must be direct declarations.
2. `runtime-adaptive-paddle.in` extends local runtime and adds PaddleOCR/PaddlePaddle. It is not installed for the default release profile.
3. `test.in` extends local runtime and adds pytest/test tooling only.
4. Each cloud input extends the minimal compatible runtime and adds exactly one SDK. Installing a cloud profile still does not enable the provider.
5. TrOCR stays in its existing isolated environment and is out of scope for these locks unless separately approved.

Before implementing this split, confirm whether any non-OCR production code genuinely requires the Supabase Python client. Do not remove it merely because the new local catalogue path uses psycopg.

## Lock generation and integrity strategy

Use a pinned `pip-tools` version in a disposable lock-generation environment. Generate each Windows CPython 3.12 lock independently with backtracking resolution and `--generate-hashes`. Record the exact compile command, Python executable version, pip version, pip-tools version, index origin, input-file hashes, and output-file hash.

Installation must use:

```powershell
py -3.12 -m pip install --require-hashes --only-binary=:all: -r <lock-file>
```

Any package without an approved Windows wheel is a stop condition; do not silently fall back to source builds. PyTorch CPU wheel provenance requires special review because its canonical wheels may use a dedicated index. Do not add an unrestricted extra index that could introduce dependency-confusion risk. Prefer pinned direct URLs with hashes or a separately approved, allowlisted package source and document the choice.

Run `pip check`, capture `pip list --format=freeze`, and create a normalized inventory containing package, version, wheel filename, and SHA-256. Two clean installs must produce identical inventories and lock hashes. Lock generation and clean-install verification must be separate steps so a resolver cache cannot masquerade as reproducibility.

## Model-cache strategy

Package locks do not lock OCR weights. Models remain outside Git and outside the virtual environment in an explicitly configured, read-only cache. Runtime download stays disabled.

The current EasyOCR cache contains:

| File | Size | SHA-256 |
| --- | ---: | --- |
| `craft_mlt_25k.pth` | 83,152,330 bytes | `4A5EFBFB48B4081100544E75E1E2B57F8DE3D84F213004B14B85FD4B3748DB17` |
| `english_g2.pth` | 15,143,997 bytes | `E2272681D9D67A04E2DFF396B6E95077BC19001F8F6D3593C307B9852E1C29E8` |

Create a version-controlled manifest containing logical model name, upstream source, expected filename, byte size, SHA-256, provider version compatibility, license/source review, and approved languages. The manifest must not contain credentials or a private local path. A bootstrap verifier checks the supplied cache directory against the manifest before FastAPI readiness. Missing or mismatched weights fail closed and never trigger download.

Paddle model directories are optional and must have their own manifest. The currently observed `PP-OCRv6_medium_det` and `PP-OCRv6_medium_rec` directories are availability clues only—not approved integrity evidence—until every required file, source, license, and checksum is inventoried. RC-3 does not download or validate them through genuine inference; that remains RC-6.

For offline deployment, publish a separately retained, access-controlled wheelhouse and model bundle after license review. Verify every artifact against the committed manifests before use. Do not commit the binary models or wheelhouse to Git.

## Clean-install verification procedure

After explicit package-index and disk-space approval:

1. Create two new task-owned virtual environments from CPython 3.12.10; do not clone `.venv`.
2. Upgrade only pip/setuptools/wheel to the versions explicitly recorded by the lock-generation procedure.
3. Install `win-py312-runtime-local.txt` using hashes and binary wheels only.
4. Assert cloud SDKs, PaddleOCR, PaddlePaddle, and TrOCR dependencies are absent from the default environment.
5. Run import probes for FastAPI, Uvicorn, psycopg, Pillow, PyMuPDF, NumPy, EasyOCR, torch, and all five application layers.
6. Point the environment at a copied/read-only approved EasyOCR cache; verify the model manifest before importing the provider.
7. Start loopback FastAPI with a random test token and synthetic local catalogue, check `/health` and `/ready`, then stop it.
8. Run the full Python suite and `pip check`.
9. Run one genuine supervised fictional scanned-PDF smoke test. Require Contract v1 correlation, a draft-review-compatible medicine result, bounded memory, no cloud calls, no model download, and no orphan child.
10. Repeat steps 3-9 in the second clean environment and compare package/model inventories and behavioral results.
11. Separately install and test the adaptive Paddle and cloud profiles only when their own approvals exist. Cloud negative tests must run without credentials or network access; no live cloud call is part of RC-3.
12. Remove only the two task-owned environments and smoke-test artifacts after evidence capture.

## Security and supply-chain checks

- Run `pip check` and an approved vulnerability scanner against each locked inventory. Scanner findings need severity, exploitability, reachability, and remediation review; do not auto-upgrade.
- Review package licenses, especially OCR engines, native runtimes, and model weights.
- Reject yanked releases, unapproved indexes, editable installs, local path dependencies, VCS dependencies, and unhashed artifacts.
- Verify that test execution clears dotenv/Supabase variables and blocks network access as it does today.
- Search generated locks and install logs for credentials and local private paths before committing.
- Retain the current provider-selection tests: missing optional SDKs fail safely, and package installation alone cannot activate cloud or adaptive OCR.
- Produce an SBOM or equivalent normalized dependency inventory for the release candidate.

## Windows reproducibility commands to implement

The eventual checked-in bootstrap should use explicit commands equivalent to:

```powershell
py -3.12 -c "import sys,struct; assert sys.version_info[:3] == (3,12,10); assert struct.calcsize('P') == 8"
py -3.12 -m venv <task-owned-path>
& <task-owned-path>\Scripts\python.exe -m pip install --require-hashes --only-binary=:all: -r requirements\locks\win-py312-test.txt
& <task-owned-path>\Scripts\python.exe -m pip check
& <task-owned-path>\Scripts\python.exe -m pytest -q --basetemp <task-owned-temp>
```

The actual script must resolve paths relative to its own location, reject hosted configuration, use no inherited credentials, avoid modifying the existing `.venv`, and record sanitized versions/hashes only.

## Required completion evidence

RC-3 is complete only when all of the following are true:

- direct dependency inputs and all five Windows lock profiles are reviewed and committed;
- every installed artifact is pinned and hashed;
- two empty CPython 3.12.10 environments install successfully with identical inventories;
- default imports and FastAPI readiness pass without Paddle or cloud SDKs;
- full Python tests meet or exceed the current 451-test baseline with no assertion failure;
- genuine fictional EasyOCR succeeds through the supervisor without download or cloud access;
- memory remains below the unchanged 2 GiB limit and all children/temporary files are cleaned;
- model files match the approved manifest;
- vulnerability/license findings are reviewed rather than silently suppressed;
- Windows setup documentation is executable from a clean checkout.

## Approval boundaries and blockers

Implementation requires separate approval for package-index network access, temporary disk space for two clean environments, and use of an approved vulnerability database. Any package version change, source build, model acquisition, cloud call, or new package index is a separate stop point.

Known blockers requiring resolution during implementation:

1. default EasyOCR/PyTorch dependencies are installed but not directly declared;
2. several direct and all transitive dependencies are unpinned;
3. Paddle is mandatory in the current declaration despite being optional in the release profile;
4. CPU PyTorch wheel source and hash policy must be reviewed;
5. EasyOCR model provenance/license metadata must accompany the verified hashes;
6. Paddle model directories lack a reviewed per-file manifest;
7. a Windows-only lock does not cover Linux deployment.

No package, environment, model cache, dataset, hosted system, or worker was changed while preparing this plan.

## Readiness

```text
RC_3_READINESS: READY_FOR_SEPARATE_IMPLEMENTATION_APPROVAL
PYTHON_VERSION: CPython 3.12.10 win-amd64
DEPENDENCY_LOCK_STRATEGY: profile-specific hashed pip-tools locks plus two clean-install inventory comparisons
MODEL_CACHE_STRATEGY: external read-only caches with committed provenance/size/SHA-256 manifests and runtime download disabled
HOSTED_MUTATIONS: NONE
```
