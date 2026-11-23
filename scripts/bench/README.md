# Benchmark âm thanh VMI

Chạy từ thư mục `backend/`. Cần `uv`, Python 3.12, FFmpeg/ffprobe và Node 24
cùng dependencies Nest có sẵn để gọi normalizer TypeScript trực tiếp. Các venv,
trọng số, nhãn cục bộ, audio và kết quả thô đều ở thư mục Git bỏ qua.

## Nhãn và môi trường ASR

Script hiện có `scripts/eval-real-voice.py` đọc `vi-*.mp3` và `en-*.mp3`
trong Downloads. Lần đầu, chạy mặc định để tạo gợi ý và BẮT BUỘC nghe, sửa từng
nhãn trong `scripts/bench/file_labels.json` trước khi dùng `--confirmed-labels`.
Chỉ gán `NATURAL` nếu clip không có câu đọc chuẩn tương ứng. Cờ
`--without-suggestions` chỉ dùng khi chưa cài được Whisper small.

```bash
b=scripts/bench
# Mỗi cấu hình chạy trong một venv riêng. Không dùng chung môi trường Torch và ONNX.
for model in faster-whisper-{small,medium,large-v3-turbo} pho-{base,small}-ct2; do
  uv venv --python 3.12 "$b/envs/$model"
  uv pip install --python "$b/envs/$model/bin/python" -r "$b/requirements-faster-whisper.txt"
done
for model in pho-base pho-small qwen-0.6b qwen-1.7b moss; do
  uv venv --python 3.12 "$b/envs/$model"
  uv pip install --python "$b/envs/$model/bin/python" \
    --index-url https://download.pytorch.org/whl/cpu -r "$b/requirements-torch-cpu.txt"
  case "$model" in
    pho-*) req=phowhisper ;;
    qwen-*) req=qwen-asr ;;
    moss) req=moss ;;
  esac
  uv pip install --python "$b/envs/$model/bin/python" -r "$b/requirements-$req.txt"
done

p="$b/envs/faster-whisper-small/bin/python"
# Tạo nhãn nháp. Nếu có rồi, script giữ nguyên nhãn.
"$p" -B scripts/eval-real-voice.py
# Sau khi đã xác nhận nhãn: chạy baseline, PhoWhisper, Qwen.
"$p" -B scripts/eval-real-voice.py --confirmed-labels --engines \
  faster-whisper-small faster-whisper-medium faster-whisper-large-v3-turbo \
  pho-base pho-small qwen-0.6b qwen-1.7b --qwen-1-7b-one-run
# Chuyển đổi rồi chạy CT2 riêng để lỗi convert không ảnh hưởng baseline.
for size in base small; do
  "$b/envs/pho-$size/bin/python" -B "$b/convert_pho.py" "$size" &&
  "$p" -B scripts/eval-real-voice.py --confirmed-labels --engines "pho-$size-ct2"
done
"$p" -B "$b/report_asr.py"
```

Load time của ASR bắt đầu trước khi import adapter. Nếu cache còn trống, phép đo
load có thể gồm tải trọng số. Để đo load cục bộ, làm đầy cache trước và chạy lại
với `HF_HUB_OFFLINE=1`. WER/CER giữ thuật toán và chuẩn hóa của script gốc;
`WER_no_num` bỏ token có chữ số và cụm số tiếng Việt/Anh theo quy tắc từ vựng,
giữ một số từ Việt đa nghĩa khi đứng riêng. Recall đối chiếu số lần xuất hiện cả
cụm thuật ngữ đã chuẩn hóa, không gộp biến thể như `cache` và `caching`.

MOSS dùng snapshot cục bộ, khóa revision và kiểm tra SHA-256 mọi tệp Python trước
khi gọi `trust_remote_code`. Tải riêng model và các tệp tokenizer/config từ
[revision đã duyệt](https://huggingface.co/hynt/MOSS-Transcribe-Diarize-Vietnamese-6000h/tree/d930a0b2d78f47abed5943d240c859c320454828)
vào `scripts/bench/envs/sources/moss-d930a0b2d78f47abed5943d240c859c320454828/`.
Đọc lại ba tệp Python nếu revision đổi. Chạy worker MOSS trong sandbox offline
với môi trường sạch, không dùng venv làm quyền cách ly mã từ xa:

```bash
# Dùng kế hoạch đã tạo từ nhãn xác nhận và copy nó cho MOSS nếu cần.
mkdir -p "$b/out/asr"
for loader in speech multimodal causal; do
  env -i PATH=/usr/bin:/bin HOME=/tmp HF_HUB_OFFLINE=1 \
    HF_MODULES_CACHE="$b/envs/moss-hf-modules" \
    "$b/envs/moss/bin/python" -B "$b/asr_worker.py" "moss-$loader" \
    "$b/out/asr/faster-whisper-small.plan.json" \
    > "$b/out/asr/moss-$loader.jsonl" 2> "$b/out/asr/moss-$loader.log"
done
"$p" -B "$b/report_asr.py"
```

## So sánh Whisper cho lượt hỏi đáp

Dùng bộ nhãn đã xác nhận ở trên. Lượt đo dùng CPU int8, bốn luồng, cùng thiết
lập giải mã, với Whisper small, Turbo và Turbo kèm danh sách thuật ngữ cố định.
Mẫu 30 giây lấy từ clip `NATURAL` chỉ dùng để đo độ trễ.

```bash
HF_HUB_OFFLINE=1 HF_HOME="$b/envs/models" \
  "$p" -B "$b/compare_whisper_live.py" --output "$b/out/vmi-whisper-live" --reps 3
```

Dùng thư mục đầu ra mới cho mỗi lần đo. `summary.json` có p50/p95 theo nhóm,
WER, recall và số lượt thuật ngữ bị chèn vượt số lần xuất hiện trong đáp án.
Đây là độ trễ trên máy suy luận. Mốc người dùng chờ được đo riêng qua trình duyệt.

## Thử bản chép cuối bằng Qwen

Chạy với Python của venv `qwen-1.7b` đã cài ở trên. Thay đường dẫn dưới đây bằng
tệp ghi âm gốc trên máy thử và chọn `vi`, `en` hoặc `auto`.

```bash
qwen="$b/envs/qwen-1.7b/bin/python"
job=$("$qwen" -B "$b/qwen_final_job.py" enqueue --language auto /path/to/take1.wav)
"$qwen" -B "$b/qwen_final_job.py" status "$job"
HF_HUB_OFFLINE=1 HF_HOME="$b/envs/models" "$qwen" -B "$b/qwen_final_job.py" run "$job"
```

Dùng `retry "$job"` với cùng thiết lập cache khi job lỗi hoặc tiến trình bị
ngắt giữa chừng. Có thể đọc kết quả trong `out/qwen-final/<id>/job.json`. File
này chỉ chủ máy đọc được và nằm trong thư mục Git bỏ qua. Bản thử chạy cục bộ
và tách riêng khỏi dữ liệu chấm điểm cũng như API của VMI.

## TTS

```bash
# Checkout đúng revision dùng trong phép đo, trong thư mục Git bỏ qua.
git clone https://github.com/pnnbao97/VieNeu-TTS.git "$b/envs/sources/VieNeu-TTS"
git -C "$b/envs/sources/VieNeu-TTS" checkout 512de867d49b883d50cc47989c445d070f62362f
for model in vieneu-turbo-fp32 vieneu-turbo-int8 vieneu-nano; do
  UV_PROJECT_ENVIRONMENT="$(realpath -m "$b/envs/$model")" uv sync \
    --project "$b/envs/sources/VieNeu-TTS" --python 3.12 --locked --no-dev
done
"$p" -B "$b/run_tts.py"
```

`tts_prompts.json` gồm ba câu Việt, hai Anh và ba câu trộn. Runner giữ từng
WAV, kể cả từ PCM qua HTTP. WAV streaming chỉ tính TTFA khi có dữ liệu PCM,
sau header. Bản `-norm` dùng normalizer backend trước khi gửi qua SDK.
API upstream tại revision này chỉ hỗ trợ Turbo. Zonos chỉ được thử nếu có
dịch vụ localhost tại cổng 1919, hoặc chọn URL qua `VMI_BENCH_ZONOS_URL`.
Zonos đi qua normalizer hiện hành, đúng như adapter backend. Dùng `--engines`
và `--phases sdk|api` để chạy lại riêng một cấu hình hoặc đường gọi.
Turbo int8 chỉ được chạy khi cờ VNNI hiện diện.

Mở `out/compare.html` trên máy chứa các clip để nghe và ghi chú. `compare.md`
là bản Markdown và `results.csv` chứa mỗi lượt ASR. CSV và WAV TTS trong `out/tts/`.
Dữ liệu và audio gốc chỉ ở máy đã chạy. Không nạp `.env` trong các lệnh trên.
