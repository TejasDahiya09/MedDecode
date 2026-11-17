# MedDecode Copilot Phase 2.3 TrOCR Real Inference

## 1. Installation and compatibility summary

Approved checkpoint and dependency install proceeded under a safety rule: the active intelligence venv is kept stable for EasyOCR and PaddleOCR, and the TrOCR stack was installed in a dedicated isolated environment so the working OCR baseline was not destabilized.

Compatibility findings before installation:

- Python: 3.12.10
- PyTorch: 2.6.0+cpu in the main intelligence environment
- EasyOCR: 1.7.2
- PaddleOCR: 3.7.0
- PaddlePaddle: 3.2.2
- available RAM: ~475.7 GB
- available disk: ~23.3 GB free on C:
- active model dependency state: `transformers` not installed

Critical compatibility conflict discovered:

- `transformers==4.49.0` requires `huggingface-hub<1.0` and `>=0.26.0`
- `paddlepaddle==3.2.2` requires `safetensors>=0.6.0`
- installing `safetensors==0.5.3` into the main venv would break the working PaddleOCR stack
- therefore, the approved install was isolated to a separate environment instead of modifying the main OCR baseline

The dedicated TrOCR environment uses:

- `C:\Users\dahiy\MedDecode-integration\intelligence\.venv-trocr`

Exact install command used:

```powershell
cd C:\Users\dahiy\MedDecode-integration\intelligence
.\.venv-trocr\Scripts\python.exe -m pip install --no-cache-dir "torch==2.6.0" "transformers==4.49.0" "huggingface-hub==0.26.5" "safetensors==0.5.3" "tokenizers==0.21.4" "pillow==12.3.0" "numpy==2.2.6" "psutil"
```

The main working venv remained unchanged after the conflict was detected and mitigated.

## 2. Official model and exact revision

Official model reviewed and downloaded:

- `microsoft/trocr-base-handwritten`

Exact model repository revision used:

- `eaacaf452b06415df8f10bb6fad3a4c11e609406`

The repository metadata reported the model as MIT licensed and as image-to-text.

The model was downloaded into the dedicated local cache directory:

- `C:\Users\dahiy\.cache\meddecode\trocr\microsoft-trocr-base-handwritten`

Important policy result:

- no redundant `pytorch_model.bin` checkpoint was downloaded
- only the approved configuration and `model.safetensors` were kept
- the checkpoint is stored outside the Git repository and is not committed to source control

## 3. Model artifact inventory and integrity

Local artifact inventory:

- `config.json`
- `generation_config.json`
- `merges.txt`
- `model.safetensors`
- `preprocessor_config.json`
- `special_tokens_map.json`
- `tokenizer_config.json`
- `vocab.json`

Artifact sizes:

- `model.safetensors`: 1,333,384,464 bytes (~1.33 GB)

SHA-256 for the actual model weight:

- `25A40CDDC7E6120140A3D5B9E3DD3878A92ADA7B4F312953AB22EDC19C2A5ACC`

## 4. Download command and local model configuration

The exact checkpoint acquisition used a local-only snapshot with an explicit revision and a non-redundant pattern list:

```powershell
cd C:\Users\dahiy\MedDecode-integration\intelligence
.\.venv-trocr\Scripts\python.exe -c "from pathlib import Path; from huggingface_hub import snapshot_download; repo='microsoft/trocr-base-handwritten'; rev='eaacaf452b06415df8f10bb6fad3a4c11e609406'; out=Path(r'C:\Users\dahiy\.cache\meddecode\trocr\microsoft-trocr-base-handwritten'); out.parent.mkdir(parents=True, exist_ok=True); path=snapshot_download(repo_id=repo, revision=rev, local_dir=str(out), local_dir_use_symlinks=False, allow_patterns=['*.json','*.txt','*.safetensors'], ignore_patterns=['*.bin'], resume_download=True); print(path)"
```

This uses `local_files_only=True` for runtime inference and prevents implicit remote downloads during processing.

## 5. Real local inference verification

The approved checkpoint was loaded locally with CPU-only inference. The model was tested against synthetic handwritten prescription lines created with a cursive-like Windows font to keep the inputs fictional and privacy-safe.

Ground-truth lines used for the benchmark:

1. `Miraform 250 mg`
2. `Zoradex 10 mg`
3. `Take one tablet twice daily`
4. `Use 0.5 ml at bedtime`
5. `Lunivar 500 mg once daily`
6. `Asterca 50 mg every 12 hours`

Observed local inference outputs:

| Sample | Ground truth | Output | Exact match |
| --- | --- | --- | --- |
| 1 | `Miraform 250 mg` | `miraform 250 mg.` | No |
| 2 | `Zoradex 10 mg` | `Zoradex 10 mg. 1` | No |
| 3 | `Take one tablet twice daily` | `Take one tablet twice daily` | Yes |
| 4 | `Use 0.5 ml at bedtime` | `use 0.5ml at bedtime` | No |
| 5 | `Lunivar 500 mg once daily` | `Lunivar 500 mg once daily` | Yes |
| 6 | `Asterca 50 mg every 12 hours` | `America 50 mg every 12 hours` | No |

This is genuine local handwritten inference, not mocked output.

## 6. Measured performance

Metrics computed from the real handwritten benchmark above:

- Character Error Rate (CER): 0.0754
- Word Error Rate (WER): 0.2611
- Exact-text match rate: 0.3333 (2/6)
- Mean inference latency: 2.10 s per crop
- Peak process RSS during the benchmark: ~1,633.6 MB

Cold-start versus warmed behavior (single-line sample `Miraform 250 mg`):

- initialization time: 6.79 s
- first inference: 1.04 s
- second inference: 0.95 s
- output: `miraform 250 mg.` on both runs

Interpretation:

- this is a real local inference benchmark, but it is not a clinical accuracy claim
- the benchmark uses fictional handwritten lines and should be treated as engineering evidence only
- more representative handwriting benchmark data is still needed for robust medical-performance claims

## 7. TrOCR adapter verification

The adapter was validated with the real model as follows:

- local model loading works with `local_files_only=True`
- CPU inference succeeds without external API calls
- output decoding works correctly
- bounded generation is used
- the model is initialized lazily and reused
- invalid crop rejection remains fail-closed
- blank and near-empty handwriting inputs are rejected
- page polygon coordinates are preserved in the output prediction structure

The primary provider interface remains local-only, CPU-safe, and compatible with the project’s supervised-process architecture.

## 8. Regression test evidence

Main intelligence suite after the isolated installation and real benchmark work:

```powershell
cd C:\Users\dahiy\MedDecode-integration\intelligence
.\.venv\Scripts\python.exe -m pytest -q
```

Result:

- 340 passed
- 1 warning
- passed in 10.53s

This confirms the working OCR baseline remained stable and the TrOCR implementation did not destabilize the broader intelligence stack.

## 9. Codex integration interface

The exact model directory for Codex integration is:

- `C:\Users\dahiy\.cache\meddecode\trocr\microsoft-trocr-base-handwritten`

Provider constructor used by the local adapter:

```python
TrOCRHandwrittenProvider(
    *,
    model_directory: Path,
    processor: Any | None = None,
    model: Any | None = None,
    max_new_tokens: int = 64,
    max_pixels: int = 2_000_000,
)
```

Call pattern:

```python
provider.recognize_regions(regions, page_number, timeout_seconds)
```

Expected behavior:

- accepts single-line handwritten crop regions
- converts input to RGB
- rejects empty and near-empty crops
- validates minimum and maximum dimensions
- loads the local checkpoint only once per provider lifetime
- keeps region/page coordinates in the returned prediction polygon
- raises `OCRProviderError` on missing assets or invalid inputs
- does not call external APIs and does not bypass the supervision timeout model

Memory footprint estimate for the current environment:

- initialization cost: ~6.8 s
- model memory footprint at runtime: ~1.6 GB RSS during the benchmark
- practical note: keep a single model instance per worker lifetime and avoid repeated initialization

## 10. Remaining limitations

- the handwriting benchmark is still synthetic and fictional; it is not a clinical or deidentified medical handwriting corpus
- the sample size is too small to claim robust production accuracy
- the model behaves as a line-level handwritten recognizer, not a whole-document physician handwriting solver
- no patient data or real prescription images were used
- the True OCR value is local-only; this environment was intentionally isolated from the core OCR stack to avoid breaking EasyOCR/PaddleOCR

## 11. Final status

TROCR_ADAPTER: VERIFIED
TROCR_DEPENDENCIES: VERIFIED
TROCR_CHECKPOINT: AVAILABLE
TROCR_REAL_INFERENCE: VERIFIED
HANDWRITING_EVALUATION: VERIFIED
CODEX_INTEGRATION_INTERFACE: READY
