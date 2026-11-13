# VMI Whisper STT (CPU)

Requires Python (3.11/3.12 recommended), ffmpeg and ffprobe in PATH. Install the
ffmpeg package for your OS if absent; the service never installs system packages.
From `backend/services/stt-whisper/`:

```bash
python3 -m venv /tmp/hireus-whisper-venv
source /tmp/hireus-whisper-venv/bin/activate
pip install -r requirements.txt
export WHISPER_MODEL=large-v3-turbo
export WHISPER_DEVICE=cpu
export WHISPER_COMPUTE_TYPE=int8
export WHISPER_CPU_THREADS=2
export VMI_AUDIO_MAX_BYTES=15728640
export VMI_AUDIO_MAX_DURATION_MS=195000
# Optional writable model cache: export WHISPER_MODEL_CACHE=/tmp/whisper-models
python -c 'import logging, uvicorn; logging.basicConfig(level=logging.INFO); uvicorn.run("main:app", host="127.0.0.1", port=8001, access_log=False)'
```

`GET /health` returns `{status:"ok"}` after model loading. Bind to loopback: this
internal service has no user authentication. Nest enforces ownership and passes
language from the saved session. Python does not read `.env`; export its settings
explicitly. Set `WHISPER_STT_BASE_URL` and `WHISPER_STT_TIMEOUT_MS` in the backend
runtime; no API key is required. Use the same limits in both processes.

`POST /transcribe`: multipart `audio` file and `language=vi|en`; returns
`{text, language, durationMs}`. The public Nest route `/vmi/sessions/:id/transcribe`
accepts only `audio` and returns `{text, language}`. A client must confirm/edit
this draft then submit through the existing text-only `/answers` route.

Default maximum 15 MiB and **195 seconds** (180 seconds plus 15-second margin).
Byte limit can be lowered; duration can be set between 180000 and 600000 ms.
MIME: WebM, Ogg, WAV, MP3, MP4/M4A (see contract). ffprobe verifies the actual
container; ffmpeg decodes only up to the duration limit plus 100 ms, with timeout
and network protocols disabled (`cache,pipe` only). The request-scoped ffmpeg
cache supports seeking in MP4/M4A with trailing metadata; its temporary file is
closed/unlinked on process exit. All streams must be audio. Multipart is bounded
before parsing; temporary upload spool files are closed on every request, and
no audio or transcript is retained. Do not enable request-body or debug logging.

Errors: 400 empty audio; 413 excessive bytes; 415 unsupported/invalid audio;
422 excessive decoded duration or no recognized speech; 503 overload/inference
failure; 504 decode timeout. One inference at a time; excess requests get 503.
Nest's timeout stops waiting but cannot interrupt an ongoing CTranslate2 call.
Restart a stuck worker if needed. Timing logs contain only event and milliseconds.

The model loads once at startup. `large-v3-turbo` is faster-whisper's documented
alias for the CTranslate2 conversion of **openai/whisper-large-v3-turbo**,
currently `mobiuslabsgmbh/faster-whisper-large-v3-turbo`. It is not the smaller
Whisper tiny/base model. Initial download requires network and substantial disk/RAM;
CPU int8 performance must be measured on target hardware.

Sources: [OpenAI model card](https://huggingface.co/openai/whisper-large-v3-turbo),
[faster-whisper](https://github.com/SYSTRAN/faster-whisper),
[alias mapping](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/faster_whisper/utils.py).
Model and faster-whisper are MIT licensed. Preserve license notices when redistributing.

Offline tests use a mock model, no model download or external API:
Install test tooling with `pip install "httpx>=0.27,<1"` first. Then run
`python -m unittest discover -s . -p 'test_*.py' -v`.
