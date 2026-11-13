from concurrent.futures import ThreadPoolExecutor
import asyncio
import io
import shutil
import subprocess
import threading
import tempfile
import unittest
import wave
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import numpy as np
from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
from starlette.datastructures import Headers
import main


def wav(seconds=0.25):
    out = io.BytesIO()
    with wave.open(out, "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000)
        f.writeframes(b"\0\0" * int(seconds * 16000))
    return out.getvalue()


class WhisperTests(unittest.TestCase):
    def setUp(self):
        main.app.state.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vmi-asr-test")
        main.app.state.dispatch_lock = threading.Lock()
        main.app.state.lock = threading.Lock()
        main.app.state.model = Mock()
        main.app.state.model.transcribe.return_value = (iter([SimpleNamespace(text=" Draft fixture ")]), None)

    def tearDown(self):
        main.app.state.executor.shutdown(wait=True, cancel_futures=True)

    def test_forces_language_and_consumes_lazy_segments(self):
        for language in ("vi", "en"):
            main.app.state.model.transcribe.return_value = (iter([SimpleNamespace(text=" Draft fixture ")]), None)
            with patch.object(main, "decode_audio", return_value=np.zeros(16000)):
                result = main.recognize(b"fixture", "audio/wav", language)
            self.assertEqual(result, {"text": "Draft fixture", "language": language, "durationMs": 1000})
            self.assertEqual(main.app.state.model.transcribe.call_args.kwargs["language"], language)
            self.assertEqual(main.app.state.model.transcribe.call_args.kwargs["task"], "transcribe")

    def test_initial_prompt_is_only_forwarded_when_configured(self):
        from dataclasses import replace
        config = main.whisper_config()
        for value in ('', 'Redis, Jest'):
            main.app.state.model.transcribe.return_value = (iter([SimpleNamespace(text='Draft')]), None)
            with patch.object(main, 'decode_audio', return_value=np.zeros(16000)), patch.object(main, 'whisper_config', return_value=replace(config, initial_prompt=value)):
                main.recognize(b'fixture', 'audio/wav', 'vi')
            kwargs = main.app.state.model.transcribe.call_args.kwargs
            if value: self.assertEqual(kwargs['initial_prompt'], 'Redis, Jest')
            else: self.assertNotIn('initial_prompt', kwargs)

    def test_empty_result_and_model_failure_release_lock(self):
        for result, status in [(iter([]), 422), (None, 503)]:
            main.app.state.model.transcribe.return_value = (result, None)
            with patch.object(main, "decode_audio", return_value=np.zeros(16000)):
                with self.assertRaises(HTTPException) as error:
                    main.recognize(b"fixture", "audio/wav", "vi")
            self.assertEqual(error.exception.status_code, status)
            self.assertFalse(main.app.state.lock.locked())

    def test_overload_rejected_without_queue(self):
        main.app.state.lock.acquire()
        with self.assertRaises(HTTPException) as error:
            main.recognize(b"fixture", "audio/wav", "vi")
        self.assertEqual(error.exception.status_code, 503)

    def test_upload_validation_and_timing(self):
        for data, mime, status in [(b"", "audio/wav", 400), (b"a", "text/plain", 415), (b"12345", "audio/wav", 413)]:
            upload = UploadFile(io.BytesIO(data), headers=Headers({"content-type": mime}))
            with patch.object(main, "limits", return_value=(4, 195000)), patch.object(main.logger, "info") as log:
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(main.transcribe(upload, "vi"))
            self.assertEqual(error.exception.status_code, status)
            self.assertEqual(log.call_args.args[0], "event=stt durationMs=%.3f")
            self.assertTrue(upload.file.closed)

    def test_endpoint_returns_draft_without_logging_content(self):
        upload = UploadFile(io.BytesIO(b"fixture"), headers=Headers({"content-type": "audio/wav"}))
        with patch.object(main, "run_in_threadpool", new=AsyncMock(return_value={"text": "private fixture", "language": "en", "durationMs": 1000})), patch.object(main.logger, "info") as log:
            result = asyncio.run(main.transcribe(upload, "en"))
        self.assertEqual(result["language"], "en")
        self.assertNotIn("private", str(log.call_args))

    def test_http_multipart_health_and_envelope_limit(self):
        main.app.state.ready = True
        client = TestClient(main.app)  # No context manager: no real model lifespan.
        try:
            self.assertEqual(client.get('/health').json(), {'status': 'ok'})
            with patch.object(main, 'recognize', return_value={'text': 'Draft fixture', 'language': 'vi', 'durationMs': 1000}):
                response = client.post('/transcribe', files={'audio': ('fixture.wav', b'fixture', 'audio/wav')}, data={'language': 'vi'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['text'], 'Draft fixture')
            with patch.object(main, 'limits', return_value=(4, 195000)):
                response = client.post('/transcribe', content=b'x' * 65541, headers={'content-type': 'multipart/form-data; boundary=fixture'})
            self.assertEqual(response.status_code, 413)
        finally:
            client.close()

    def test_decode_timeout_is_sanitized(self):
        with patch.object(main.subprocess, "run", side_effect=subprocess.TimeoutExpired("ffmpeg", 10)):
            with self.assertRaises(HTTPException) as error:
                main.decode_audio(b"fixture", "audio/wav", 195000)
        self.assertEqual(error.exception.status_code, 504)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg absent")
    def test_nonfragmented_m4a_with_metadata_at_end(self):
        # A normal M4A file requires seeking back after reading its final moov atom.
        out = io.BytesIO()
        noise = np.random.default_rng(17).integers(-16000, 16000, 160000, dtype=np.int16)
        with wave.open(out, 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000); f.writeframes(noise.tobytes())
        with tempfile.TemporaryDirectory(prefix='hireus-stt-test-', dir='/tmp') as directory:
            path = directory + '/fixture.m4a'
            subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-c:a', 'aac', '-b:a', '128k', path],
                           input=out.getvalue(), capture_output=True, check=True)
            with open(path, 'rb') as f:
                encoded = f.read()
        self.assertGreater(main.decode_audio(encoded, 'audio/m4a', 195000).size, 0)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg absent")
    def test_real_decoding_formats_and_duration(self):
        self.assertEqual(main.decode_audio(wav(), "audio/wav", 195000).size, 4000)
        for fmt, codec, mime in [("webm", "libopus", "audio/webm"), ("ogg", "libopus", "audio/ogg"), ("mp3", "libmp3lame", "audio/mpeg"),
                                 ("mp4", "aac", "audio/mp4")]:
            command = ["ffmpeg", "-v", "error", "-i", "pipe:0", "-c:a", codec]
            if fmt == "mp4": command += ["-movflags", "frag_keyframe+empty_moov"]
            encoded = subprocess.run(command + ["-f", fmt, "pipe:1"], input=wav(), capture_output=True, check=True).stdout
            self.assertGreater(main.decode_audio(encoded, mime, 195000).size, 0)
        for data, mime, status in [(b"bad", "audio/wav", 415), (wav(), "audio/mp4", 415), (wav(196), "audio/wav", 422)]:
            with self.assertRaises(HTTPException) as error:
                main.decode_audio(data, mime, 195000)
            self.assertEqual(error.exception.status_code, status)


if __name__ == "__main__":
    unittest.main()
