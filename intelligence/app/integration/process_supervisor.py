"""Supervise one native-OCR process with a real termination boundary."""
from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.integration.document_safety import DocumentSafetyLimits


class SupervisionError(RuntimeError):
    code = "PROCESSING_FAILED"


class ProcessingTimeout(SupervisionError):
    code = "PROCESSING_TIMEOUT"


class ProcessingMemoryLimit(SupervisionError):
    code = "PROCESSING_MEMORY_LIMIT"


class ProcessingOutputLimit(SupervisionError):
    code = "PROCESSING_OUTPUT_LIMIT"


class ProcessingChildExit(SupervisionError):
    code = "PROCESSING_CHILD_EXIT"

    def __init__(self, message: str, return_code: int | None = None, diagnostic_code: str = "CHILD_RUNTIME_ERROR") -> None:
        super().__init__(message)
        self.return_code = return_code
        self.diagnostic_code = diagnostic_code


class ProcessingResponseInvalid(SupervisionError):
    code = "PROCESSING_RESPONSE_INVALID"


@dataclass(frozen=True)
class SupervisedResult:
    payload: dict[str, Any]
    elapsed_ms: int
    peak_rss_bytes: int | None
    diagnostic_code: str | None = None
    provider_counts: dict[str, int] | None = None


async def _read_limited(stream: asyncio.StreamReader, limit: int, overflow: asyncio.Event) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await stream.read(64 * 1024)
        if not chunk:
            return b"".join(chunks)
        total += len(chunk)
        if total > limit:
            overflow.set()
        elif not overflow.is_set():
            chunks.append(chunk)


def _rss_bytes(pid: int) -> int | None:
    if sys.platform == "win32":
        try:
            import ctypes
            from ctypes import wintypes

            class Counters(ctypes.Structure):
                _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                            ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                            ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]
            class ProcessEntry(ctypes.Structure):
                _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD),
                            ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_size_t),
                            ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
                            ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG),
                            ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260)]

            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            psapi = ctypes.WinDLL("psapi", use_last_error=True)
            kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
            kernel.OpenProcess.restype = wintypes.HANDLE
            kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
            kernel.CloseHandle.restype = wintypes.BOOL
            psapi.GetProcessMemoryInfo.argtypes = (wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD)
            psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
            kernel.CreateToolhelp32Snapshot.argtypes = (wintypes.DWORD, wintypes.DWORD)
            kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
            kernel.Process32FirstW.argtypes = (wintypes.HANDLE, ctypes.POINTER(ProcessEntry))
            kernel.Process32FirstW.restype = wintypes.BOOL
            kernel.Process32NextW.argtypes = (wintypes.HANDLE, ctypes.POINTER(ProcessEntry))
            kernel.Process32NextW.restype = wintypes.BOOL

            parents: dict[int, int] = {}
            snapshot = kernel.CreateToolhelp32Snapshot(0x00000002, 0)
            if snapshot and snapshot != ctypes.c_void_p(-1).value:
                try:
                    entry = ProcessEntry()
                    entry.dwSize = ctypes.sizeof(entry)
                    present = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
                    while present:
                        parents[int(entry.th32ProcessID)] = int(entry.th32ParentProcessID)
                        present = kernel.Process32NextW(snapshot, ctypes.byref(entry))
                finally:
                    kernel.CloseHandle(snapshot)
            process_ids = {pid}
            changed = True
            while changed:
                changed = False
                for child, parent in parents.items():
                    if parent in process_ids and child not in process_ids:
                        process_ids.add(child)
                        changed = True

            def working_set(process_id: int) -> int | None:
                handle = kernel.OpenProcess(0x0400 | 0x0010, False, process_id)
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

            values = [value for process_id in process_ids if (value := working_set(process_id)) is not None]
            return sum(values) if values else None
        except Exception:
            return None
    try:
        for line in Path(f"/proc/{pid}/status").read_text(encoding="utf-8").splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


class ProcessingSupervisor:
    def __init__(
        self,
        limits: DocumentSafetyLimits,
        model_directory: Path,
        *,
        worker_module: str = "app.integration.local_pdf_worker",
        environment_overrides: dict[str, str] | None = None,
        preprocessing_enabled: bool = False,
        adaptive_ocr_enabled: bool = False,
        paddle_detection_model_directory: Path | None = None,
        paddle_recognition_model_directory: Path | None = None,
        trocr_enabled: bool = False,
        trocr_interpreter: Path | None = None,
        trocr_model_directory: Path | None = None,
        trocr_timeout_seconds: float = 20.0,
        safe_ocr_diagnostics: bool = False,
    ) -> None:
        self._limits = limits
        self._model_directory = model_directory
        self._worker_module = worker_module
        self._environment_overrides = environment_overrides or {}
        self._preprocessing_enabled = preprocessing_enabled
        self._adaptive_ocr_enabled = adaptive_ocr_enabled
        self._paddle_detection_model_directory = paddle_detection_model_directory
        self._paddle_recognition_model_directory = paddle_recognition_model_directory
        self._trocr_enabled = trocr_enabled
        self._trocr_interpreter = trocr_interpreter
        self._trocr_model_directory = trocr_model_directory
        self._trocr_timeout_seconds = trocr_timeout_seconds
        self._safe_ocr_diagnostics = safe_ocr_diagnostics
        if adaptive_ocr_enabled and (
            paddle_detection_model_directory is None
            or paddle_recognition_model_directory is None
        ):
            raise ValueError("Adaptive OCR requires explicit local PaddleOCR model directories.")
        if trocr_enabled and (
            not adaptive_ocr_enabled or trocr_interpreter is None or trocr_model_directory is None
        ):
            raise ValueError("TrOCR requires adaptive OCR and explicit isolated runtime assets.")
        self._active: dict[int, asyncio.subprocess.Process] = {}
        self._closing = False

    @property
    def active_process_count(self) -> int:
        return len(self._active)

    async def _terminate(self, process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        if sys.platform == "win32":
            try:
                killer = await asyncio.create_subprocess_exec(
                    "taskkill", "/PID", str(process.pid), "/T", "/F",
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
                await asyncio.wait_for(killer.wait(), timeout=5.0)
            except Exception:
                process.kill()
        else:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except Exception:
                process.kill()
        try:
            await asyncio.wait_for(process.wait(), timeout=5.0)
        except TimeoutError:
            process.kill()
            await process.wait()

    async def _monitor_memory(self, process: asyncio.subprocess.Process) -> int | None:
        peak: int | None = None
        while process.returncode is None:
            value = await asyncio.to_thread(_rss_bytes, process.pid)
            if value is not None:
                peak = value if peak is None else max(peak, value)
                if value > self._limits.max_child_rss_bytes:
                    raise ProcessingMemoryLimit("Processing child exceeded its memory limit")
            await asyncio.sleep(0.1)
        return peak

    async def run(self, document_path: Path, metadata: dict[str, Any]) -> SupervisedResult:
        if self._closing:
            raise SupervisionError("Processing supervisor is shutting down")
        request_bytes = json.dumps(metadata, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(request_bytes) > 1024 * 1024:
            raise ProcessingResponseInvalid("Processing request is too large")
        worker_module = (
            "app.integration.staged_local_pdf_worker"
            if self._trocr_enabled and self._worker_module == "app.integration.local_pdf_worker"
            else self._worker_module
        )
        command = [sys.executable, "-m", worker_module, "--local-pdf-path", str(document_path),
                   "--ocr-provider", "easyocr", "--easyocr-model-directory", str(self._model_directory),
                   "--official-catalogue"]
        if self._adaptive_ocr_enabled:
            assert self._paddle_detection_model_directory is not None
            assert self._paddle_recognition_model_directory is not None
            command.extend([
                "--adaptive-ocr",
                "--paddle-detection-model-directory", str(self._paddle_detection_model_directory),
                "--paddle-recognition-model-directory", str(self._paddle_recognition_model_directory),
            ])
        if self._trocr_enabled:
            assert self._trocr_interpreter is not None
            assert self._trocr_model_directory is not None
            command.extend([
                "--trocr",
                "--trocr-python", str(self._trocr_interpreter),
                "--trocr-model-directory", str(self._trocr_model_directory),
                "--trocr-timeout-seconds", str(self._trocr_timeout_seconds),
                "--max-process-tree-rss-bytes", str(self._limits.max_child_rss_bytes),
            ])
        if self._preprocessing_enabled:
            command.append("--preprocessing")
        system_keys = {
            "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "USERPROFILE",
            "APPDATA", "LOCALAPPDATA", "PGPASSFILE", "CUDA_VISIBLE_DEVICES", "OMP_NUM_THREADS", "MKL_NUM_THREADS",
        }
        child_environment = {
            key: value for key, value in os.environ.items()
            if key.startswith("MEDDECODE_CATALOGUE_") or key.upper() in system_keys
        }
        if self._adaptive_ocr_enabled:
            # Explicit local model directories are supplied on the command
            # line. Disable PaddleX source discovery so the child cannot turn
            # a missing local asset into an implicit network lookup.
            child_environment["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
        if self._safe_ocr_diagnostics:
            child_environment["MEDDECODE_SAFE_OCR_DIAGNOSTICS"] = "1"
        options: dict[str, Any] = {
            "stdin": asyncio.subprocess.PIPE,
            "stdout": asyncio.subprocess.PIPE,
            "stderr": asyncio.subprocess.PIPE,
            # The OCR child does not receive the HTTP bearer token, backend
            # credentials, worker credentials, or unrelated process secrets.
            "env": {**child_environment, **self._environment_overrides},
        }
        if sys.platform == "win32":
            options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        else:
            options["start_new_session"] = True
        started = time.monotonic()
        process = await asyncio.create_subprocess_exec(*command, **options)
        self._active[process.pid] = process
        stdout_overflow = asyncio.Event()
        stderr_overflow = asyncio.Event()
        stdout_task = asyncio.create_task(_read_limited(process.stdout, self._limits.max_response_bytes, stdout_overflow))
        stderr_task = asyncio.create_task(_read_limited(process.stderr, 64 * 1024, stderr_overflow))
        stdout_overflow_task = asyncio.create_task(stdout_overflow.wait())
        stderr_overflow_task = asyncio.create_task(stderr_overflow.wait())
        memory_task = asyncio.create_task(self._monitor_memory(process))
        try:
            assert process.stdin is not None
            process.stdin.write(request_bytes)
            await process.stdin.drain()
            process.stdin.close()
            wait_task = asyncio.create_task(process.wait())
            try:
                done, _ = await asyncio.wait(
                    {wait_task, memory_task, stdout_overflow_task, stderr_overflow_task}, timeout=self._limits.processing_timeout_seconds,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if not done:
                    raise ProcessingTimeout("Processing deadline exceeded")
                if stdout_overflow_task in done or stderr_overflow_task in done:
                    raise ProcessingOutputLimit("Processing child output exceeded its limit")
                if memory_task in done and memory_task.exception() is not None:
                    raise memory_task.exception()  # type: ignore[misc]
                await wait_task
            except BaseException:
                await self._terminate(process)
                raise
            stdout = await stdout_task
            stderr = await stderr_task  # Bounded and never exposed verbatim.
            peak = await memory_task
            safe_diagnostic = None
            safe_markers = re.findall(
                rb"SAFE_WORKER_FAILURE:([A-Z_]+):([A-Z0-9_]+)",
                stderr,
            )
            if safe_markers:
                stage, category = safe_markers[-1]
                safe_diagnostic = "WORKER_" + stage.decode("ascii") + "_" + category.decode("ascii")
            provider_counts = None
            route_markers = re.findall(
                rb"SAFE_OCR_ROUTE:EASYOCR=([0-9]+):PADDLEOCR=([0-9]+)",
                stderr,
            )
            if route_markers:
                easy_count, paddle_count = route_markers[-1]
                provider_counts = {
                    "easyocr": int(easy_count),
                    "paddleocr": int(paddle_count),
                }
                trocr_markers = re.findall(rb":TROCR=([0-9]+)", stderr)
                if trocr_markers:
                    provider_counts["trocr"] = int(trocr_markers[-1])
            if process.returncode != 0:
                lowered = stderr.decode("utf-8", errors="ignore").casefold()
                diagnostic = (
                    "CHILD_IMPORT_ERROR" if "modulenotfounderror" in lowered or "importerror" in lowered
                    else "CHILD_NATIVE_DEPENDENCY_ERROR" if "dll load failed" in lowered
                    else "CATALOGUE_CONFIGURATION_ERROR" if "catalogue configuration error" in lowered
                    else "CHILD_PERMISSION_ERROR" if "permissionerror" in lowered or "access is denied" in lowered
                    else "CHILD_RUNTIME_ERROR"
                )
                if diagnostic == "CHILD_RUNTIME_ERROR":
                    winerror = re.findall(r"\[winerror\s+(\d+)\]", lowered)
                    if winerror:
                        diagnostic = "CHILD_WINERROR_" + winerror[-1]
                    exception_types = re.findall(r"(?m)^([A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception)):", lowered, flags=re.IGNORECASE)
                    if diagnostic == "CHILD_RUNTIME_ERROR" and exception_types:
                        diagnostic = "CHILD_EXCEPTION_" + exception_types[-1].upper().replace(".", "_")
                raise ProcessingChildExit("Processing child exited unsuccessfully", process.returncode, diagnostic)
            try:
                payload = json.loads(stdout)
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ProcessingResponseInvalid("Processing child returned invalid JSON") from error
            if not isinstance(payload, dict) or payload.get("job_id") != metadata.get("job_id") or payload.get("prescription_id") != metadata.get("prescription_id") or payload.get("status") not in {"completed", "completed_with_warnings", "failed"}:
                raise ProcessingResponseInvalid("Processing child returned an invalid response identity")
            return SupervisedResult(
                payload=payload,
                elapsed_ms=round((time.monotonic() - started) * 1000),
                peak_rss_bytes=peak,
                diagnostic_code=safe_diagnostic,
                provider_counts=provider_counts,
            )
        except asyncio.CancelledError:
            await self._terminate(process)
            raise
        finally:
            for task in (stdout_task, stderr_task, memory_task, stdout_overflow_task, stderr_overflow_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(stdout_task, stderr_task, memory_task, stdout_overflow_task, stderr_overflow_task, return_exceptions=True)
            self._active.pop(process.pid, None)

    async def shutdown(self) -> None:
        self._closing = True
        processes = list(self._active.values())
        await asyncio.gather(*(self._terminate(process) for process in processes), return_exceptions=True)


