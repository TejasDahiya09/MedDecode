"""Bounded parent-side IPC for the isolated local TrOCR environment.

The model runtime deliberately lives in a different virtual environment.  This
module sends only versioned JSON plus bounded PNG crops to a child interpreter;
it never sends paths supplied by document content and never uses pickle.
"""

from __future__ import annotations

import base64
import io
import json
import os
import signal
import subprocess
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from PIL import Image

from app.layer1_document_processing.hybrid_ocr import OCRPrediction, OCRRegion

IPC_VERSION = "1.0"
MAX_REGIONS = 4
MAX_CROP_PIXELS = 1_000_000
MAX_TOTAL_CROP_PIXELS = 2_000_000
MAX_CROP_DIMENSION = 2048
MAX_REQUEST_BYTES = 8 * 1024 * 1024
MAX_RESPONSE_BYTES = 1024 * 1024
# The isolated interpreter plus its native PyTorch descendants measured
# 3,270,017,024 bytes peak working set on the approved checkpoint.  Keep a
# conservative reserve so the unchanged 2 GiB request-tree ceiling rejects the
# launch before native allocation rather than relying on an OOM kill.
TROCR_MEMORY_RESERVE_BYTES = 3_400_000_000


class TrOCRIPCError(RuntimeError):
    """A safe, classified failure of the isolated provider boundary."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class TrOCRSubprocessConfig:
    interpreter: Path
    model_directory: Path
    timeout_seconds: float = 20.0
    max_process_tree_rss_bytes: int = 2 * 1024 * 1024 * 1024
    # Default preserves the monolithic-path fail-closed guard. A staged
    # coordinator may supply a separately measured isolated-runtime reserve;
    # the outer request supervisor still enforces the hard process-tree limit.
    memory_reserve_bytes: int = TROCR_MEMORY_RESERVE_BYTES


def _current_rss_bytes() -> int | None:
    if sys.platform != "win32":
        try:
            for line in Path(f"/proc/{os.getpid()}/status").read_text(encoding="utf-8").splitlines():
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
        except (OSError, ValueError, IndexError):
            return None
        return None
    try:
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel.OpenProcess.restype = wintypes.HANDLE
        handle = kernel.OpenProcess(0x0400 | 0x0010, False, os.getpid())
        if not handle:
            return None
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        try:
            if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
                return None
            return int(counters.WorkingSetSize)
        finally:
            kernel.CloseHandle(handle)
    except Exception:
        return None


def _png_base64(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="PNG", optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _terminate_tree(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW,
            timeout=5,
        )
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


class TrOCRSubprocessProvider:
    """Invoke Copilot's existing provider through the isolated interpreter."""

    engine_name = "trocr_base_handwritten"

    def __init__(self, config: TrOCRSubprocessConfig) -> None:
        if config.timeout_seconds <= 0:
            raise ValueError("TrOCR timeout must be positive.")
        if not config.interpreter.is_file():
            raise ValueError("TrOCR interpreter is unavailable.")
        if not config.model_directory.is_dir():
            raise ValueError("TrOCR model directory is unavailable.")
        self.config = config
        self.last_status_code = "not_invoked"

    def _bounded_regions(self, regions: Sequence[OCRRegion]) -> list[OCRRegion]:
        selected: list[OCRRegion] = []
        total_pixels = 0
        for region in regions:
            width, height = region.image.size
            pixels = width * height
            if (
                width < 1 or height < 1 or width > MAX_CROP_DIMENSION
                or height > MAX_CROP_DIMENSION or pixels > MAX_CROP_PIXELS
                or total_pixels + pixels > MAX_TOTAL_CROP_PIXELS
            ):
                continue
            selected.append(region)
            total_pixels += pixels
            if len(selected) >= MAX_REGIONS:
                break
        return selected

    def recognize_regions(
        self,
        regions: Sequence[OCRRegion],
        page_number: int,
        timeout_seconds: float,
    ) -> list[OCRPrediction]:
        selected = self._bounded_regions(regions)
        if not selected:
            self.last_status_code = "no_bounded_candidates"
            return []
        current_rss = _current_rss_bytes()
        # Process-tree accounting must be available before launching a native
        # model.  An unavailable probe is not permission to hide memory from
        # the request supervisor.
        if (
            current_rss is None
            or self.config.memory_reserve_bytes <= 0
            or current_rss + self.config.memory_reserve_bytes > self.config.max_process_tree_rss_bytes
        ):
            self.last_status_code = "resource_budget_unavailable"
            return []

        request_id = str(uuid.uuid4())
        payload = {
            "schema_version": IPC_VERSION,
            "request_id": request_id,
            "page_number": page_number,
            "regions": [
                {
                    "region_id": str(index),
                    "polygon": [[float(x), float(y)] for x, y in region.polygon],
                    "image_png_base64": _png_base64(region.image),
                }
                for index, region in enumerate(selected)
            ],
        }
        request_bytes = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(request_bytes) > MAX_REQUEST_BYTES:
            self.last_status_code = "request_too_large"
            raise TrOCRIPCError(self.last_status_code)

        intelligence_root = Path(__file__).resolve().parents[2]
        environment = {
            "PATH": os.environ.get("PATH", ""),
            "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
            "WINDIR": os.environ.get("WINDIR", ""),
            "TEMP": os.environ.get("TEMP", ""),
            "TMP": os.environ.get("TMP", ""),
            "PYTHONPATH": str(intelligence_root),
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "CUDA_VISIBLE_DEVICES": "",
            "OMP_NUM_THREADS": "1",
            "MKL_NUM_THREADS": "1",
        }
        command = [
            str(self.config.interpreter), "-m", "app.integration.trocr_ipc_worker",
            "--model-directory", str(self.config.model_directory),
        ]
        options: dict[str, object] = {
            "stdin": subprocess.PIPE,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "env": environment,
            "shell": False,
        }
        if sys.platform == "win32":
            options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        else:
            options["start_new_session"] = True
        process = subprocess.Popen(command, **options)  # type: ignore[arg-type]
        effective_timeout = min(timeout_seconds, self.config.timeout_seconds)
        try:
            stdout, stderr = process.communicate(request_bytes, timeout=effective_timeout)
        except subprocess.TimeoutExpired as error:
            _terminate_tree(process)
            self.last_status_code = "timeout"
            raise TrOCRIPCError(self.last_status_code) from error
        except BaseException:
            _terminate_tree(process)
            raise
        if len(stdout) > MAX_RESPONSE_BYTES or len(stderr) > 64 * 1024:
            self.last_status_code = "output_too_large"
            raise TrOCRIPCError(self.last_status_code)
        if process.returncode != 0:
            self.last_status_code = "child_failed"
            raise TrOCRIPCError(self.last_status_code)
        try:
            response = json.loads(stdout)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            self.last_status_code = "invalid_response"
            raise TrOCRIPCError(self.last_status_code) from error
        if (
            not isinstance(response, dict)
            or response.get("schema_version") != IPC_VERSION
            or response.get("request_id") != request_id
            or response.get("status") != "ok"
            or not isinstance(response.get("predictions"), list)
        ):
            self.last_status_code = "invalid_response"
            raise TrOCRIPCError(self.last_status_code)
        predictions: list[OCRPrediction] = []
        for item in response["predictions"]:
            if not isinstance(item, dict) or not isinstance(item.get("text"), str):
                raise TrOCRIPCError("invalid_response")
            polygon_value = item.get("polygon")
            if not isinstance(polygon_value, list) or len(polygon_value) != 4:
                raise TrOCRIPCError("invalid_response")
            polygon = tuple((float(point[0]), float(point[1])) for point in polygon_value)
            predictions.append(OCRPrediction(
                engine_name=self.engine_name,
                engine_version="microsoft-trocr-base-handwritten",
                page_number=page_number,
                text=item["text"],
                polygon=polygon,  # type: ignore[arg-type]
                raw_confidence=None,
                content_style="handwritten",
                model_provenance="microsoft/trocr-base-handwritten@eaacaf452b06415df8f10bb6fad3a4c11e609406",
            ))
        self.last_status_code = "ok"
        return predictions

