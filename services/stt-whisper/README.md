# VMI Whisper STT (CPU/GPU)

Requires Python 3.11+ (tested locally on 3.14.7), ffmpeg and ffprobe in PATH.
Install those system tools yourself if missing; the service never installs them.
From `backend/services/stt-whisper/`:

```bash
python3 -m venv /tmp/hireus-whisper-venv
source /tmp/hireus-whisper-venv/bin/activate
pip install -r requirements.txt
export WHISPER_DEVICE=cpu
unset WHISPER_MODEL WHISPER_CPU_THREADS WHISPER_COMPUTE_TYPE
export VMI_AUDIO_MAX_BYTES=15728640 VMI_AUDIO_MAX_DURATION_MS=195000
python -c 'import logging, uvicorn; logging.basicConfig(level=logging.INFO); uvicorn.run("main:app", host="127.0.0.1", port=8001, access_log=False)'
```

`GET /health` returns `{status:"ok"}` after the model loads once at startup.
Bind to loopback: this service has no user authentication. Nest enforces ownership
and sends language from the saved session. Python never loads `.env`; export its
settings explicitly. `POST /transcribe` takes multipart `audio` + `language=vi|en`
and returns `{text, language, durationMs}`. The public VMI endpoint strips duration,
returns a draft, and never submits `/answers` automatically.

| Environment | Default / valid settings |
| --- | --- |
| WHISPER_DEVICE | cpu; also cuda or auto; all devices default to the small model |
| WHISPER_MODEL | small on CPU, CUDA and auto. Explicit base/small/medium/large-v3-turbo, local paths or owner/repo overrides remain accepted |
| WHISPER_COMPUTE_TYPE | CPU int8; CUDA float16. Other CTranslate2 types depend on hardware |
| WHISPER_CPU_THREADS | auto min(4, visible CPUs/affinity/cgroup quota); explicit 1..64 |
| WHISPER_BEAM_SIZE | 5; integer 1..10 |
| WHISPER_VAD_FILTER | false; true/false |
| WHISPER_CONDITION_ON_PREVIOUS_TEXT | true; true/false |
| WHISPER_INITIAL_PROMPT | Empty/off; optional keyword string, max 1000 characters, no control characters |
| WHISPER_MODEL_CACHE | Optional writable model cache directory |

The auto thread cap leaves capacity for Nest and decoding. A smaller CPU model
trades accuracy for speed. The previous fast profile (beam1/VAD on/conditioning
off) worsened small's synthetic WER, so it is configurable but not the default.
The configured model is **small for every device** (CPU int8, CUDA float16).
Real human voice on i5-12500H CPU, four threads: clips up to about 20s take
2–4.3s; the 80s clip averages 12.4s (max 13.2s). Earlier espeak results
(120s: 5.2s; 180s: 7.5–7.6s) are historical and not representative of human
voice. They do not establish the 10s NFR through 180s. Rough interpolation
suggests 45s has headroom and 60s is near the limit; neither duration has been
measured with real voice. Refinement adds latency. Medium was slower and less
accurate overall than large-v3-turbo on these Vietnamese samples and is no
longer a recommended fallback. GPU remains unmeasured.

Open decision: reconcile NFR-VMI-01 (10s, ordinary ~30s clips) with BR-VMI-03 /
FR-VMI-14 (180s answers): limit recording, allow longer waits with progress,
or send chunks during recording. No option is selected; business rules remain.

Nest uses `WHISPER_STT_BASE_URL` and a **60000 ms** HTTP deadline by default.
Existing `WHISPER_STT_TIMEOUT_MS` is retained; nonempty `VMI_STT_TIMEOUT_MS` takes
precedence. This is a failure deadline, separate from the 10s NFR target.
Python inference has no competing deadline; ffprobe/ffmpeg each have a 10s
processing timeout. The 195s recording cap is unchanged. There is no measured
end-to-end guarantee for a 180s human recording.
Startup/model download has a separate 600s benchmark readiness budget, outside
a student's STT request. If explicitly selecting a larger CPU model, increase
the HTTP deadline based on measurements first. A timeout cannot interrupt native
CTranslate2; the existing overload gate remains held until native work finishes.

Upload limits are 15 MiB and 195 seconds (180 + 15 margin). Byte limit can be
lowered; duration can be 180000..600000 ms. Use identical `VMI_AUDIO_MAX_BYTES`
and `VMI_AUDIO_MAX_DURATION_MS` in Nest and Python. Supported MIME: WebM, Ogg,
WAV, MP3, MP4/M4A (see OpenAPI). ffprobe validates the container; ffmpeg decodes
only to the duration cap plus 100 ms, with a timeout and only cache/pipe protocols.
Its request-scoped temporary cache supports M4A with trailing metadata and is
closed/unlinked after subprocess exit. Multipart is bounded before parsing;
upload spool files are closed after the request. No audio/transcript is retained.

Errors: 400 empty audio; 413 excessive bytes; 415 invalid format; 422 excessive
duration or no recognized speech; 503 overload/inference failure; 504 timeout.
One owned inference thread, no unbounded request queue. Cancelling an HTTP waiter
keeps the overload gate until native work finishes. Shutdown waits for that worker,
unloads CTranslate2, clears cached VAD sessions and collects references. tqdm uses
a thread RLock before Hugging Face model loading: this service does not need its
default multiprocessing lock. No resource-tracker warnings are filtered/disabled.
Model small and large were both transcribed then stopped with SIGTERM without the
previous leaked-semaphore warning. Restart a worker if native inference hangs.

## Measure and verify

From `backend/`, using this venv's Python:

```bash
python scripts/measure-stt-latency.py --models small \
  --lengths 5 15 30 60 --repeats 3 --with-comparison \
  --cache-dir /tmp/hireus-stt-models --output-dir /tmp/hireus-stt-benchmark
```

Default profile is beam5/VAD off/conditioning on; `--with-comparison` adds the
fast profile. The script generates whole repeated espeak utterances plus silence,
measures sequential HTTP latency after warmup, computes word-error counts against
known text and inspects shutdown warnings. It never prints/saves transcripts.
Synthetic repeated speech has very high WER here, so it cannot establish human
speech accuracy. See `backend/docs/vmi/tts-stt-integration-notes.md` for real
measurements and limitations. Record real vi/en speech with technical terms
before choosing a production model.

Offline tests use mocks, never download a model:

```bash
pip install 'httpx>=0.27,<1'
# From backend/:
python -m unittest discover -s services/stt-whisper -p 'test_*.py' -v
python -m unittest discover -s scripts -p 'test_*.py' -v
```

The deployed selection is the faster-whisper `small` alias, loaded once and
configurable through `WHISPER_MODEL`. Initial download needs network/disk/RAM;
CI tests mock loading. Historical large-model benchmarks are reference data only;
the 180s large-model measurement mentioned in re-review was affected by parallel
work and is not a deployment recommendation. Sources: [faster-whisper alias mapping](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/faster_whisper/utils.py),
[CTranslate2 unload API](https://opennmt.net/CTranslate2/python/ctranslate2.models.Whisper.html#ctranslate2.models.Whisper.unload_model),
[tqdm public lock API](https://tqdm.github.io/docs/tqdm/#set_lock).
Model and faster-whisper are MIT licensed; preserve notices when redistributing.

`WHISPER_INITIAL_PROMPT` is passed only when nonempty. Keep it disabled until a
paired real-voice comparison checks accuracy and hallucinated keywords. Installed
faster-whisper 1.2.1 supports `hotwords` (signature inspected), but it is unused.
Nest's optional Gemini refinement runs after STT; see the integration notes.
