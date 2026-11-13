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
| WHISPER_DEVICE | cpu; also cuda or auto (auto uses conservative CPU defaults) |
| WHISPER_MODEL | CPU small; CUDA large-v3-turbo. base/small/medium/large-v3-turbo, local model directories or owner/repo IDs |
| WHISPER_COMPUTE_TYPE | CPU int8; CUDA float16. Other CTranslate2 types depend on hardware |
| WHISPER_CPU_THREADS | auto min(4, visible CPUs/affinity/cgroup quota); explicit 1..64 |
| WHISPER_BEAM_SIZE | 5; integer 1..10 |
| WHISPER_VAD_FILTER | false; true/false |
| WHISPER_CONDITION_ON_PREVIOUS_TEXT | true; true/false |
| WHISPER_MODEL_CACHE | Optional writable model cache directory |

The auto thread cap leaves capacity for Nest and decoding. A smaller CPU model
trades accuracy for speed. The previous fast profile (beam1/VAD on/conditioning
off) worsened small's synthetic WER, so it is configurable but not the default.
CUDA keeps large-v3-turbo/float16; GPU speed has not been measured.

Nest uses `WHISPER_STT_BASE_URL` and a **60000 ms** HTTP deadline by default.
Existing `WHISPER_STT_TIMEOUT_MS` is retained; nonempty `VMI_STT_TIMEOUT_MS` takes
precedence. The re-review supplied a CPU `small` measurement up to 180 seconds
with maximum processing time about 7.6s; this task did not repeat that recording.
A 60s deadline leaves headroom and returns clean 504 if STT hangs. It is separate
from the 10s NFR target. Python has no competing inference deadline; its two
ffprobe/ffmpeg phases each have a 10s processing timeout, not an audio-duration
limit. The default 195s recording cap remains unchanged. Budgeting both phase
caps plus the supplied inference time still leaves substantial headroom in 60s.
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
python scripts/measure-stt-latency.py --models small large-v3-turbo \
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

`large-v3-turbo` is faster-whisper 1.2.1's alias for the CTranslate2 conversion
`mobiuslabsgmbh/faster-whisper-large-v3-turbo` of OpenAI's model. Initial download
needs network and substantial disk/RAM. Sources: [OpenAI model card](https://huggingface.co/openai/whisper-large-v3-turbo),
[faster-whisper alias mapping](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/faster_whisper/utils.py),
[CTranslate2 unload API](https://opennmt.net/CTranslate2/python/ctranslate2.models.Whisper.html#ctranslate2.models.Whisper.unload_model),
[tqdm public lock API](https://tqdm.github.io/docs/tqdm/#set_lock).
Model and faster-whisper are MIT licensed; preserve notices when redistributing.
