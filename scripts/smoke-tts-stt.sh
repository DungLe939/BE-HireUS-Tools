#!/usr/bin/env bash
# Direct service smoke only. No .env loading, API key, or transcript output.
set -euo pipefail
for binary in curl python3 ffprobe; do command -v "$binary" >/dev/null || { printf 'Missing tool: %s\n' "$binary" >&2; exit 1; }; done
SMOKE_TMP_DIR=$(mktemp -d /tmp/hireus-vmi-smoke.XXXXXX)
trap 'rm -rf "$SMOKE_TMP_DIR"' EXIT
TTS_BASE=${ZONOS_TTS_BASE_URL:-http://127.0.0.1:1919}
STT_BASE=${WHISPER_STT_BASE_URL:-http://127.0.0.1:8001}
SMOKE_LANGUAGE=${SMOKE_LANGUAGE:-vi}
export SMOKE_LANGUAGE
STT_SECONDS=$(python3 - <<'PY'
import os
raw = os.environ.get('VMI_STT_TIMEOUT_MS', '').strip() or os.environ.get('WHISPER_STT_TIMEOUT_MS', '60000')
print((int(raw) + 999) // 1000)
PY
)
if ! curl --silent --fail --max-time 5 "${TTS_BASE%/}/v2/health" -o "$SMOKE_TMP_DIR/tts-health.json"; then
  printf 'TTS health failed; start the native Zonos server first.\n' >&2; exit 1
fi
if ! curl --silent --fail --max-time 5 "${STT_BASE%/}/health" -o "$SMOKE_TMP_DIR/stt-health.json"; then
  printf 'STT health failed; start the Whisper service first.\n' >&2; exit 1
fi
python3 - "$SMOKE_TMP_DIR/tts-request.json" <<'PY'
import json, os, sys
lang = os.environ['SMOKE_LANGUAGE']
if lang not in ('vi', 'en'): raise SystemExit('SMOKE_LANGUAGE must be vi or en.')
voice = os.environ.get('ZONOS_TTS_VOICE_VI' if lang == 'vi' else 'ZONOS_TTS_VOICE_EN') or 'default_34370fd91e3484ef'
body = {'model':'zonos3', 'input':'Xin chào. Tôi đang luyện phỏng vấn.' if lang == 'vi' else 'Hello. I am practicing an interview.',
        'language':'vi' if lang == 'vi' else 'en_us', 'voice':voice, 'response_format':'wav'}
with open(sys.argv[1], 'w') as f: json.dump(body, f)
PY
if ! TTS_TIME=$(curl --silent --fail --max-time 180 -H 'Content-Type: application/json' \
  --data-binary "@$SMOKE_TMP_DIR/tts-request.json" "${TTS_BASE%/}/v1/audio/speech" \
  -o "$SMOKE_TMP_DIR/question.wav" --write-out '%{time_total}'); then
  printf 'TTS synthesis failed.\n' >&2; exit 1
fi
ffprobe -v error -show_entries stream=codec_name,sample_rate,channels -of json "$SMOKE_TMP_DIR/question.wav" > "$SMOKE_TMP_DIR/wav.json"
python3 - "$SMOKE_TMP_DIR/wav.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f: streams=json.load(f).get('streams', [])
assert len(streams)==1 and streams[0]['codec_name']=='pcm_s16le' and streams[0]['sample_rate']=='44100' and streams[0]['channels']==1, 'Invalid Zonos WAV'
PY
# Default roundtrip uses freshly generated TTS audio; optionally pass your own file.
SMOKE_AUDIO=${1:-$SMOKE_TMP_DIR/question.wav}
SMOKE_MIME=${SMOKE_MIME:-audio/wav}
if ! STT_TIME=$(curl --silent --fail --max-time "$STT_SECONDS" \
  -F "audio=@${SMOKE_AUDIO};type=${SMOKE_MIME}" -F "language=${SMOKE_LANGUAGE}" \
  "${STT_BASE%/}/transcribe" -o "$SMOKE_TMP_DIR/draft.json" --write-out '%{time_total}'); then
  printf 'STT transcription failed.\n' >&2; exit 1
fi
python3 - "$SMOKE_TMP_DIR/draft.json" <<'PY'
import json, os, sys
with open(sys.argv[1]) as f: body=json.load(f)
assert isinstance(body.get('text'), str) and body['text'].strip(), 'Empty STT draft'
assert body.get('language')==os.environ['SMOKE_LANGUAGE'], 'STT language mismatch'
PY
printf 'Service smoke passed. TTS: %ss; STT: %ss. Transcript omitted.\n' "$TTS_TIME" "$STT_TIME"
