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

## CPU/GPU tuning (review)

With `WHISPER_DEVICE=cpu`, an **unset** `WHISPER_MODEL` selects `small` and unset
`WHISPER_COMPUTE_TYPE` selects `int8`. With `WHISPER_DEVICE=cuda`, defaults are
`large-v3-turbo` / `float16`. Set model explicitly to `base`, `small`, `medium`, or
`large-v3-turbo`; existing local model directories and owner/repo IDs remain valid.
A smaller model trades multilingual/technical-term accuracy for speed; choose it
from measured target-machine results, not parameter count alone.

Unset `WHISPER_CPU_THREADS` for `min(4, visible CPU count/affinity/cgroup quota)`;
4 is a capacity cap to leave room for Nest and decoding. Explicit 1..64 overrides
are supported. `WHISPER_BEAM_SIZE=1..10`, `WHISPER_VAD_FILTER=true|false` and
`WHISPER_CONDITION_ON_PREVIOUS_TEXT=true|false` expose these choices. The new defaults are **5/false/true**: the fast
1/true/false profile worsened synthetic WER for small in the comparison, so it is
not enabled by default. No automatic model downgrade or language detection is performed.

The earlier launch example's explicit `large-v3-turbo` and 2 threads overrides
these defaults. For the new CPU defaults instead use:

```bash
unset WHISPER_MODEL WHISPER_CPU_THREADS WHISPER_COMPUTE_TYPE
export WHISPER_DEVICE=cpu
export WHISPER_BEAM_SIZE=5 WHISPER_VAD_FILTER=false WHISPER_CONDITION_ON_PREVIOUS_TEXT=true
```

Backend HTTP timeout now defaults to **600000 ms**, preserving explicit
`WHISPER_STT_TIMEOUT_MS`; the optional new `VMI_STT_TIMEOUT_MS` alias takes
precedence when nonempty. This accommodates long CPU clips; it does not assert
that the 10-second user-visible target is met. A real abort still maps to clean
504. CPU runtime depends on speech density and model; 180-second processing time
must be measured separately before claiming a timeout guarantee. The backend
cannot trust a client-provided duration to select a shorter timeout.

Run the CPU measurement script with the service venv's Python:

```bash
python ../../scripts/measure-stt-latency.py --models small large-v3-turbo \
  --lengths 5 15 30 60 --repeats 3 --with-comparison \
  --cache-dir /tmp/hireus-stt-models --output-dir /tmp/hireus-stt-benchmark
```

It generates exact-length synthetic speech-plus-silence, starts loopback services,
measures sequential HTTP round trips after warmup, compares WER against known
text, and checks shutdown logs. Results contain error counts, never transcripts.
The default comparison profile uses beam 5 / VAD off / previous-text conditioning on;
`--with-comparison` additionally measures the fast profile. Both profiles cover
the same duration matrix per model; it evaluates the combined configuration, not an
isolated causal effect for each flag. Synthetic WER is not human speech accuracy.
