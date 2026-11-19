# RC-3 Python Reproducibility Result

Date: 2026-11-19 (Asia/Calcutta)
Branch: `main`
Starting commit: `10108a38d7e5bd9407f6ac2768aaf8c180bda957`
Result: PARTIAL; the Windows x64 local CPU profile is reproducible, while model provenance, vulnerability review, and hosted-gated tests remain open

## Scope and platform

The verified target is CPython 3.12.10, 64-bit, on Windows x64. The lock set is deliberately platform-specific and is not evidence for Linux, macOS, GPU, or container installations. The pre-existing `intelligence/.venv`, datasets, `MedDecode-dev`, and OCR caches were not changed.

## Dependency profiles

Human-reviewed inputs live under `intelligence/requirements/`:

- `runtime-local.in`: FastAPI, catalogue clients, document handling, EasyOCR 1.7.2, and explicit CPU PyTorch.
- `test.in`: local runtime plus pytest 9.1.1 and psutil 7.2.2.
- `runtime-adaptive-paddle.in`: optional PaddleOCR 3.7.0 and PaddlePaddle 3.2.2.
- `cloud-aws.in`: optional boto3.
- `cloud-google.in`: optional Google Cloud Vision.

The legacy top-level requirements files now delegate to the corresponding generated locks. Installing an optional profile does not activate its provider. PaddleOCR, Google Vision, and AWS OCR are absent from the local-default lock.

Generated Windows CPython 3.12 locks:

| Lock | SHA-256 |
| --- | --- |
| `win-py312-runtime-local.txt` | `2E32F019B82101165BC2EC4744663F97DC3E536FB59A76BD9F9E32D669A411C3` |
| `win-py312-test.txt` | `E0720FFE43934466996546D835D7C8A30FB26AB33D0523B111D53F33BEE0EF9F` |
| `win-py312-runtime-adaptive-paddle.txt` | `0DB7ABF1976C3796954A9E949BC9D4DBCBCDB670CFD074E48994590305E47772` |
| `win-py312-cloud-aws.txt` | `FCA12649D6FF23FBBCA4EA27F4A193E139A5D3A538039D18D36823098D6BCD45` |
| `win-py312-cloud-google.txt` | `13023F216CDD573E91B4312179E39F091B980803A765DC147838AAD5F9F9B622` |

Locks were generated with pip-tools 7.5.2, hashes enabled, the backtracking resolver, and unsafe dependencies included explicitly. The first installation attempt correctly failed because PyTorch's `setuptools` dependency was not hashed. The final locks pin and hash `setuptools==84.2.1`; no unhashed fallback was accepted.

## Package sources and PyTorch policy

PyPI is the only general package index. CPU PyTorch is not obtained through an unrestricted extra index. The inputs and locks use exact official wheel URLs:

- PyTorch 2.6.0+cpu: `download.pytorch.org`, wheel SHA-256 `4027d982eb2781c93825ab9527f17fbbb12dbabf422298e4b954be60016f87d8`.
- torchvision 0.21.0+cpu: `download.pytorch.org`, wheel SHA-256 `667f3d983240f41eaff5a3f78bdcbc144473978a37cd15a4db6dad92b1e8b6f0`.

Both clean environments reported `torch.cuda.is_available() == False`.

## Two clean installations

Two independent empty environments were created outside the repository from the existing CPython 3.12.10 interpreter. Each installed the local runtime and test locks with `--require-hashes --only-binary=:all:`.

Both environments:

- completed installation successfully;
- passed `pip check`;
- produced byte-for-byte identical `pip freeze --all` output;
- imported EasyOCR, FastAPI, PyMuPDF, NumPy, psycopg, Supabase, torch, and torchvision;
- returned HTTP 200 from `/health` and `/ready` against the disposable loopback catalogue;
- passed the same 46 OCR/supervisor/HTTP focused tests;
- passed the dependency and model-verifier tests (4 each).

The clean environments and lock-generation environment are task-owned disposable resources and are not part of the repository.

After evidence capture, all three virtual environments were removed, the PostgreSQL cluster was stopped, port 55440 was closed, and no RC-3 Python process remained. Seven pytest base directories under `C:\Users\dahiy\MedDecode\tmp` could not be removed because their restricted-token ACLs deny even elevated ACL inspection; they contain test-temporary material only and are recorded as a cleanup limitation rather than being removed with a broader or unsafe filesystem operation.

## Genuine supervised OCR

Each clean environment independently processed the same fictional scanned PDF through `ProcessingSupervisor` and its EasyOCR child. Runs were sequential, adaptive PaddleOCR and TrOCR were disabled, cloud providers were disabled, existing model files were used with downloads disabled, and the catalogue was a disposable loopback PostgreSQL 17 fixture.

| Environment | Contract | EasyOCR predictions | Medicines | Warnings | Elapsed | Peak child tree RSS |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| clean 1 | `completed_with_warnings` | 19 | 1 | 3 | 16,172 ms | 1,283,096,576 bytes |
| clean 2 | `completed_with_warnings` | 19 | 1 | 3 | 15,985 ms | 1,283,162,112 bytes |

Both runs used input SHA-256 `4920c32cbb5e4e5fe33b5fa253adc7ee0dcc6766567472fc9ab8356d35a6645b`. Peak supervised memory remained below the unchanged 2 GiB limit. Supervisor shutdown completed and no OCR child was left running. This is genuine fictional local inference, not evidence of clinical accuracy.

## Model cache manifest

`intelligence/model-cache-manifest.json` records the two required EasyOCR files. `intelligence/tools/verify_model_cache.py` checks presence, exact byte size, and SHA-256 without downloading or changing files.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `craft_mlt_25k.pth` | 83,152,330 | `4A5EFBFB48B4081100544E75E1E2B57F8DE3D84F213004B14B85FD4B3748DB17` |
| `english_g2.pth` | 15,143,997 | `E2272681D9D67A04E2DFF396B6E95077BC19001F8F6D3593C307B9852E1C29E8` |

The files are compatible with the installed EasyOCR 1.7.2 runtime. Their artifact origin and model redistribution/licensing position were not independently established during RC-3 and remain a release review item. Existing Paddle directories (`PP-OCRv6_medium_det` and `PP-OCRv6_medium_rec`) were observed but are explicitly unverified: no RC-3 Paddle inference or per-file provenance claim is made.

## Verification results

- Local/offline Python suite: 453 passed, 0 failed, with five hosted Supabase integration cases excluded because hosted access was prohibited. An earlier root-directory diagnostic run produced two subprocess import failures plus the same five missing-hosted-configuration cases; rerunning from the correct `intelligence` working directory resolved the subprocess failures.
- Focused tests in each clean environment: 46 passed.
- New dependency/model tests in each clean environment: 4 passed.
- Backend intelligence-contract tests: 43 passed, including a real confirmed-review Python Layers 4-5 adapter test.
- `pip check`: passed in both clean environments.
- Lock inventories: identical.
- `git diff --check`: passed.

No vulnerability-database scan was run because no scanner/database source was separately approved. Package hashes and dependency consistency were verified; a vulnerability and license review remains a release governance task.

## Installation

From a clean checkout on Windows x64 with CPython 3.12.10:

```powershell
py -3.12 -c "import sys,struct; assert sys.version_info[:3] == (3,12,10); assert struct.calcsize('P') == 8"
py -3.12 -m venv C:\path\to\task-owned-venv
& C:\path\to\task-owned-venv\Scripts\python.exe -m pip install --require-hashes --only-binary=:all: -r intelligence\requirements\locks\win-py312-test.txt
& C:\path\to\task-owned-venv\Scripts\python.exe -m pip check
& C:\path\to\task-owned-venv\Scripts\python.exe intelligence\tools\verify_model_cache.py C:\path\to\EasyOCR\model
```

Model assets must be supplied out of band and verified before readiness. The verifier never downloads weights. Optional Paddle and cloud locks require their respective explicit runtime configuration and do not enable providers by installation alone.

## Files changed

- `intelligence/.python-version`
- `intelligence/requirements.txt`
- `intelligence/requirements-test.txt`
- `intelligence/requirements-cloud-aws.txt`
- `intelligence/requirements-cloud-google.txt`
- `intelligence/requirements/*.in`
- `intelligence/requirements/locks/*.txt`
- `intelligence/model-cache-manifest.json`
- `intelligence/tools/verify_model_cache.py`
- `intelligence/tests/test_dependency_profiles.py`
- `intelligence/tests/test_model_cache_verifier.py`
- `docs/RC_3_PYTHON_REPRODUCIBILITY_RESULT.md`

## Remaining limitations

- Windows x64 CPython 3.12 only; Linux, macOS, GPU, and container locks are not established.
- EasyOCR model origin/license redistribution review remains open despite verified local hashes.
- Paddle model provenance and genuine inference remain RC-6 scope.
- Cloud profiles were resolved but not installed or invoked.
- Hosted Supabase integration tests were not run.
- A vulnerability scanner and formal SBOM/license audit remain approval-gated.

No hosted service was contacted or mutated, no cloud OCR call occurred, and no model was downloaded.

```text
RC_3_STATUS: PARTIAL
PYTHON_VERSION: CPython 3.12.10 win-amd64
LOCKFILES: five platform-specific hashed profiles verified
CPU_PYTORCH_SOURCE: exact official download.pytorch.org CPU wheel URLs and hashes
EASYOCR_DECLARED: YES
PADDLE_OPTIONAL: YES
CLOUD_PROVIDERS_OPTIONAL: YES
CLEAN_INSTALL_1: PASS
CLEAN_INSTALL_2: PASS
INVENTORY_COMPARISON: IDENTICAL
GENUINE_OCR: PASS in both environments
MODEL_PROVENANCE: PARTIAL - bytes/hashes verified; origin/license review remains
PYTHON_TESTS: 453 local/offline passed; 5 hosted cases excluded
BACKEND_CONTRACT_TESTS: 43 passed
HOSTED_MUTATIONS: NONE
```
