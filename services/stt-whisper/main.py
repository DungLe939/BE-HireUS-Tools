"""Loopback-only Whisper service. No audio/transcript/filename logging."""
import asyncio
import gc
import json
import logging
import os
import re
import shutil
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Literal

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.responses import JSONResponse

HARD_MAX_BYTES = 15 * 1024 * 1024
SAMPLE_RATE = 16000
MIME = re.compile(r"audio/(webm|ogg|wav|x-wav|mpeg|mp3|mp4|m4a|x-m4a)(?:\s*;[^\r\n]*)?", re.I)
logger = logging.getLogger("vmi.stt")


def limits():
    try:
        max_bytes = int(os.environ.get("VMI_AUDIO_MAX_BYTES", str(HARD_MAX_BYTES)))
        max_ms = int(os.environ.get("VMI_AUDIO_MAX_DURATION_MS", "195000"))
        if not 1 <= max_bytes <= HARD_MAX_BYTES or not 180000 <= max_ms <= 600000:
            raise ValueError()
        return max_bytes, max_ms
    except ValueError:
        raise RuntimeError("Invalid audio limit configuration.") from None


def failure(status, code):
    return HTTPException(status_code=status, detail={"code": code})


def available_cpu_threads():
    # Leave capacity for Nest/decoding; respect affinity and a cgroup CPU quota.
    visible = getattr(os, 'process_cpu_count', os.cpu_count)() or 1
    try:
        visible = min(visible, len(os.sched_getaffinity(0)))
    except AttributeError:
        pass
    try:
        quota, period = Path('/sys/fs/cgroup/cpu.max').read_text().split()
        if quota != 'max': visible = min(visible, max(1, int(quota) // int(period)))
    except (OSError, ValueError):
        pass
    return max(1, min(4, visible))


@dataclass(frozen=True)
class WhisperConfig:
    model: str
    device: str
    compute_type: str
    cpu_threads: int
    beam_size: int
    vad_filter: bool
    condition_on_previous_text: bool


def whisper_config():
    def integer_setting(name, default, low, high):
        raw = os.environ.get(name, str(default))
        if not re.fullmatch(r'[0-9]+', raw) or not low <= int(raw) <= high:
            raise ValueError(f'Invalid {name}.')
        return int(raw)

    def flag(name, default):
        raw = os.environ.get(name, str(default)).lower()
        if raw not in ('true', 'false'): raise ValueError(f'Invalid {name}.')
        return raw == 'true'

    device = os.environ.get('WHISPER_DEVICE', 'cpu')
    if device not in ('cpu', 'cuda', 'auto'): raise ValueError('Invalid WHISPER_DEVICE.')
    model = os.environ.get('WHISPER_MODEL', 'large-v3-turbo' if device == 'cuda' else 'small')
    if model not in ('large-v3-turbo', 'medium', 'small', 'base') and not Path(model).is_dir() and not re.fullmatch(r'[\w.-]+/[\w.-]+', model):
        raise ValueError('Invalid WHISPER_MODEL.')
    # Empty means unset only for optional device-dependent defaults, not numeric values.
    if not model: raise ValueError('Invalid WHISPER_MODEL.')
    compute = os.environ.get('WHISPER_COMPUTE_TYPE', 'float16' if device == 'cuda' else 'int8')
    if compute not in ('default', 'auto', 'int8', 'int8_float32', 'int8_float16', 'int8_bfloat16', 'int16', 'float16', 'bfloat16', 'float32'):
        raise ValueError('Invalid WHISPER_COMPUTE_TYPE.')
    return WhisperConfig(model, device, compute,
        integer_setting('WHISPER_CPU_THREADS', available_cpu_threads(), 1, 64),
        integer_setting('WHISPER_BEAM_SIZE', 5, 1, 10),
        flag('WHISPER_VAD_FILTER', False), flag('WHISPER_CONDITION_ON_PREVIOUS_TEXT', True))


def create_model(config):
    # Hugging Face/tqdm otherwise creates a multiprocessing RLock, although this
    # single-process service only uses threads. Configure its public lock API
    # before importing/downloading the model; no tracker warnings are suppressed.
    from tqdm import tqdm
    tqdm.set_lock(threading.RLock())
    from faster_whisper import WhisperModel
    return WhisperModel(config.model, device=config.device, compute_type=config.compute_type,
                        cpu_threads=config.cpu_threads, num_workers=1,
                        download_root=os.environ.get('WHISPER_MODEL_CACHE'))


def clear_vad_cache():
    from faster_whisper.vad import get_vad_model
    get_vad_model.cache_clear()


@asynccontextmanager
async def lifespan(app):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("Install ffmpeg and ffprobe and add both to PATH.")
    limits()
    app.state.config = whisper_config()
    model = create_model(app.state.config)
    executor = None
    try:
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='vmi-asr')
        app.state.executor = executor
        app.state.dispatch_lock = threading.Lock()
        app.state.model = model
        app.state.lock = threading.Lock()
        app.state.ready = True
        yield
    finally:
        app.state.ready = False
        if executor is not None:
            executor.shutdown(wait=True, cancel_futures=True)
        try:
            model.model.unload_model()
        finally:
            clear_vad_cache()
            for name in ('model', 'executor', 'dispatch_lock', 'lock', 'config'):
                if hasattr(app.state, name): delattr(app.state, name)
            del model
            gc.collect()


async def run_in_threadpool(operation, *args):
    gate = app.state.dispatch_lock
    if not gate.acquire(blocking=False):
        raise failure(503, 'VMI_STT_UNAVAILABLE')
    try:
        future = app.state.executor.submit(operation, *args)
    except Exception:
        gate.release()
        raise
    # Keep overload protection until native inference actually finishes, even
    # when its HTTP waiter is cancelled (cancellation cannot stop CTranslate2).
    future.add_done_callback(lambda _: gate.release())
    return await asyncio.wrap_future(future)


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


class UploadLimitMiddleware:
    """Cap the multipart request before parsing/spooling it; no content logging."""
    def __init__(self, app):
        self.application = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") != "/transcribe":
            return await self.application(scope, receive, send)
        max_bytes, _ = limits()
        # Multipart headers/fields need a small envelope beyond the actual file limit.
        cap = max_bytes + 65536
        data = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(data) + len(chunk) > cap:
                return await JSONResponse(status_code=413, content={"detail": {"code": "VMI_STT_AUDIO_TOO_LARGE"}})(scope, receive, send)
            data.extend(chunk)
            if not message.get("more_body", False):
                break
        sent = False
        async def bounded_receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": bytes(data), "more_body": False}
            return await receive()
        return await self.application(scope, bounded_receive, send)


app.add_middleware(UploadLimitMiddleware)


def decode_audio(data, mime, max_ms):
    try:
        info = json.loads(subprocess.run(
            ["ffprobe", "-v", "error", "-protocol_whitelist", "cache,pipe", "-read_ahead_limit", "-1", "-i", "cache:pipe:0", "-show_entries",
             "format=format_name:stream=codec_type", "-of", "json"],
            input=data, capture_output=True, timeout=10, check=True,
        ).stdout)
        container = info.get("format", {}).get("format_name", "")
        streams = info.get("streams", [])
        if not streams or any(stream.get("codec_type") != "audio" for stream in streams):
            raise ValueError()
        kind = mime.split(";", 1)[0].strip().lower()
        expected = {
            "audio/webm": "matroska,webm", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav",
            "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "mov,mp4,m4a,3gp,3g2,mj2",
            "audio/m4a": "mov,mp4,m4a,3gp,3g2,mj2", "audio/x-m4a": "mov,mp4,m4a,3gp,3g2,mj2",
        }
        if container != expected.get(kind):
            raise ValueError()
        pcm = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "cache,pipe", "-read_ahead_limit", "-1", "-i", "cache:pipe:0", "-map", "0:a:0",
             "-vn", "-t", str(max_ms / 1000 + 0.1), "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1"],
            input=data, capture_output=True, timeout=10, check=True,
        ).stdout
        samples = np.frombuffer(pcm, dtype="<f4").copy()
    except subprocess.TimeoutExpired:
        raise failure(504, "VMI_STT_TIMEOUT") from None
    except (subprocess.SubprocessError, ValueError, KeyError, TypeError):
        raise failure(415, "VMI_STT_UNSUPPORTED_AUDIO") from None
    if not samples.size or not np.isfinite(samples).all():
        raise failure(415, "VMI_STT_UNSUPPORTED_AUDIO")
    if samples.size * 1000 / SAMPLE_RATE > max_ms:
        raise failure(422, "VMI_STT_AUDIO_TOO_LONG")
    return samples


def recognize(data, mime, language):
    if not app.state.lock.acquire(blocking=False):
        raise failure(503, "VMI_STT_UNAVAILABLE")
    try:
        _, max_ms = limits()
        samples = decode_audio(data, mime, max_ms)
        config = getattr(app.state, 'config', None) or whisper_config()
        segments, _ = app.state.model.transcribe(samples, language=language, task="transcribe", beam_size=config.beam_size,
                                                vad_filter=config.vad_filter, condition_on_previous_text=config.condition_on_previous_text)
        # faster-whisper is lazy: inference finishes only after consuming segments.
        text = " ".join(segment.text.strip() for segment in segments).strip()
        if not text:
            raise failure(422, "VMI_STT_EMPTY_TRANSCRIPT")
        return {"text": text, "language": language, "durationMs": samples.size * 1000 / SAMPLE_RATE}
    except HTTPException:
        raise
    except Exception:
        raise failure(503, "VMI_STT_UNAVAILABLE") from None
    finally:
        app.state.lock.release()


@app.get("/health")
async def health():
    if not getattr(app.state, "ready", False):
        raise failure(503, "VMI_STT_UNAVAILABLE")
    return {"status": "ok"}


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...), language: Literal["vi", "en"] = Form(...)):
    began = perf_counter()
    try:
        mime = audio.content_type or ""
        if not MIME.fullmatch(mime):
            raise failure(415, "VMI_STT_UNSUPPORTED_AUDIO")
        max_bytes, _ = limits()
        data = await audio.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise failure(413, "VMI_STT_AUDIO_TOO_LARGE")
        if not data:
            raise failure(400, "VMI_STT_EMPTY_AUDIO")
        return await run_in_threadpool(recognize, data, mime, language)
    finally:
        await audio.close()
        logger.info("event=stt durationMs=%.3f", (perf_counter() - began) * 1000)
