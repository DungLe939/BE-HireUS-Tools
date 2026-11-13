# Tích hợp âm thanh VMI — Task 7 và Task 8

Quyết định người dùng ngày 13/11/2026 thay Google TTS/PhoWhisper bằng
Zyphra/ZONOS3-Mini và Whisper large-v3-turbo tự host. Code Task 0–6, prompt đánh
giá, repository và `/answers` vẫn giữ nguyên. Node kiểm tra: **v24.22.3**.

## NFR-VMI-01 hiện hành — quyết định sau review 13/11/2026

Khi mạng ổn định, **10 giây cho từng lần chờ**: (a) từ lúc gửi audio đến lúc nhận
text STT với clip trả lời thông thường đến khoảng 30s; (b) từ lúc nộp `/answers`
đến lúc có audio câu hỏi tiếp theo (AI + TTS). Thời gian ứng viên xác nhận/chỉnh
sửa text nằm giữa hai lần chờ, không cộng vào latency. Các mốc 5s trong kết quả
lịch sử không còn là tiêu chí hiện hành. Clip upload vẫn có thể dài tới 195s;
điều đó không biến mốc 30s nghiệm thu thành giới hạn upload.

## Việc 0: xác minh ZONOS3-Mini

Đã đọc model card, repo runtime và danh sách giọng chính thức. Runtime nguồn
được checkout tại `/tmp/hireus-task78-zonos-src`; revision `b171b19149d29b8bcc31e0342d5e3b0063dc479b`.

| Thuộc tính | Kết quả xác minh |
| --- | --- |
| Runtime CPU | C++/ggml, `servers/ggml`, chọn `--cpu` |
| Build | CMake Release; cần C/C++ compiler, Rust/cargo và submodule ggml + zyphra-textnorm |
| API native | `POST /v2/generate` (`text`, `language`, `stream:false`, `format:wav`) |
| API tương thích OpenAI trên native | **Có**: `POST /v1/audio/speech`; `model`, `input` bắt buộc; `voice`, `language`, `response_format` được hỗ trợ |
| Định dạng sử dụng | `response_format:"wav"`: WAV PCM signed 16-bit, mono, 44100 Hz; mặc định không chỉ định format là PCM float32 |
| Stream/references | Không gửi `stream` hoặc `references` của SGLang-Omni sang native: schema native không có các trường này |
| Health | `GET /v2/health` → `{status:"ok"}` |
| Voice discovery | `GET /v2/speakers`; `voice` là ID speaker, không phải tên tự do |
| Ngôn ngữ | Registry: Việt `vi` (không có NeMo); Anh `en_us` |
| Giọng mặc định | 27 giọng đóng gói; **không có giọng Việt riêng**. Người dùng đã chọn dùng **Wyatt** cho cả vi/en và kiểm tra chất lượng sau |
| ID Wyatt | `default_34370fd91e3484ef` (nhóm English, American, male); cho phép đổi ID qua env |
| Giấy phép | Model Apache-2.0; runtime MIT; xem thêm notices của phụ thuộc |

Nguồn chính thức:

- [Model card](https://huggingface.co/Zyphra/ZONOS3-Mini).
- [Hướng dẫn build CPU](https://github.com/Zyphra/ZONOS3-Mini/blob/main/servers/ggml/README.md).
- [HTTP API](https://github.com/Zyphra/ZONOS3-Mini/blob/main/docs/api.md)
  và [schema native](https://github.com/Zyphra/ZONOS3-Mini/blob/main/servers/api/openapi.yaml).
- [Registry mã ngôn ngữ](https://github.com/Zyphra/ZONOS3-Mini/blob/main/model/src/zonos3/registries/languages.json).
- [Danh sách 27 giọng](https://huggingface.co/Zyphra/ZONOS3-Mini/blob/main/gguf/voices/README.md).

## Điều kiện để smoke test TTS

Chưa có runtime Zonos chạy thật trên máy này; không có số đo TTS hoặc AI+TTS.
Cần C/C++ build tools (server C++17), CMake >=3.18, Rust/cargo stable cho
zyphra-textnorm; Python/Hugging Face CLI để tải weights, và ggml/textnorm submodule.
Đây là build server CPU, không phải desktop app (desktop có yêu cầu khác).
Các lệnh dưới đây đã đối chiếu README/CMake upstream tại revision ghi ở đầu notes.
Chạy từ checkout upstream riêng, không build/copy model vào backend:

```bash
git clone https://github.com/Zyphra/ZONOS3-Mini.git zonos-runtime
cd zonos-runtime
git submodule update --init servers/ggml/ggml third_party/zyphra-textnorm
cd servers/ggml
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j2
hf download Zyphra/ZONOS3-Mini gguf/backbone-ptq.gguf gguf/zac-keep2.gguf --local-dir .
hf download Zyphra/ZONOS3-Mini --include 'gguf/voices/*' --local-dir .
./build/zonos3-server gguf/backbone-ptq.gguf --cpu --tts-default-voices-dir gguf/voices --port 1919
```

Kiểm tra `/v2/health`, `/v2/speakers` trước khi gọi backend; ID phụ thuộc đường dẫn
bộ giọng nên giữ nguyên cấu trúc `gguf/voices/<Language>/`. Không cần encoder
để sử dụng embeddings/codes đóng gói sẵn. Không mở server trực tiếp ra Internet.

Khi Zonos ở 127.0.0.1:1919 và Whisper ở 127.0.0.1:8001 đã ready, từ backend:

```bash
bash scripts/smoke-tts-stt.sh
# Hoặc dùng một recording riêng; script không in/lưu transcript lâu dài:
SMOKE_LANGUAGE=vi SMOKE_MIME=audio/wav bash scripts/smoke-tts-stt.sh /tmp/your-recording.wav
```

Script kiểm tra health hai service, tạo WAV bằng native Zonos API đã xác minh,
kiểm tra PCM16/mono/44100 rồi thử STT; thư mục tạm được dọn. Chỉ dùng env export,
không đọc `.env`. Đây là smoke service trực tiếp, không thay đo ownership/VMI hay
AI+TTS ở NFR (b). Mới kiểm tra `bash -n`; chưa chạy smoke đầy đủ vì thiếu Zonos.
Không sinh số đo giả hay dùng fake provider để chứng minh runtime TTS.

## Chuẩn hóa văn bản

Chỉ tạo bản đọc TTS, không sửa câu hỏi lưu trong repository. Tiếng Việt giữ Unicode,
chỉ mở rộng một số viết tắt IT, dấu %, &, + và đọc số nguyên tối đa 12 chữ số/số
thập phân đơn giản. Anh giữ số để runtime NeMo xử lý. Không cố đoán ngày tháng,
đơn vị, đoạn code, số phiên bản, URL hoặc mọi thuật ngữ IT. Cần nghe thử Wyatt với
câu Việt có thuật ngữ trước khi chọn giọng dùng thật.

## Hợp đồng VMI và STT

OpenAPI v0.8.0 giữ nguyên 11 operation cũ, bổ sung:

- `GET /vmi/sessions/:id/questions/:questionId/audio`: WAV, owner-only,
  SETUP/IN_PROGRESS; 400 trạng thái sai, 404 phiên/câu hỏi không thuộc người dùng,
  502/503 unavailable, 504 timeout.
- `POST /vmi/sessions/:id/transcribe`: multipart chỉ field file `audio`; lấy
  language từ phiên IN_PROGRESS đang chờ trả lời. Trả `{text, language}` để xác
  nhận/sửa/nói lại. **Không gọi AI, không lưu draft và không đổi câu hỏi.**
  Sai trạng thái/gọi đồng thời: 400; sai chủ: 404; quá byte: 413; MIME hoặc audio
  sai: 415; quá thời lượng/không nhận ra lời nói: 422; provider: 502/503/504.

Chọn giới hạn mặc định 15 MiB và **195 giây** (180 + biên 15). Env cho phép hạ
byte limit; duration 180000..600000 ms. Frontend gửi WebM/Ogg/WAV/MP3/MP4/M4A;
ASR kiểm tra container thật và thời lượng sau giải mã, không tin metadata client.
TTS gộp request đồng thời cùng câu hỏi; STT từ chối bấm đúp trong cùng phiên.
Khóa được giải phóng sau thành công/lỗi; không khóa `/answers` hoặc `/finish`.

STT nằm ở `services/stt-whisper/`: FastAPI, `/health`, `/transcribe`, multipart
`audio` + `language`. Nạp model một lần khi startup, CPU int8 mặc định.
`large-v3-turbo` là alias của faster-whisper 1.2.1 tới bản CTranslate2
`mobiuslabsgmbh/faster-whisper-large-v3-turbo` của model OpenAI; không truyền trực
tiếp repo Transformers vào CTranslate2. Nguồn: [OpenAI model card](https://huggingface.co/openai/whisper-large-v3-turbo),
[upstream alias mapping](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/faster_whisper/utils.py).
Model và runtime faster-whisper: MIT. [Hướng dẫn CPU](../../services/stt-whisper/README.md).

Các provider đọc env khi gọi, không đọc `.env` trong test/Python. Lỗi chỉ trả mã
và hướng dẫn chung, không chứa URL, key hay nội dung. Log timing chỉ có event và
milliseconds. Request multipart được chặn kích thước trước parser; spool tạm được
đóng sau request. Audio và draft không được lưu vào repository.

## Kiểm tra Task 7

`npm run build`: pass; unit: **225/225, 7 suites**; e2e: **127/127, 7 suites**.
Giữ nguyên 193 unit và 116 e2e có sẵn. E2E âm thanh dùng provider giả, unit provider
mock fetch; không đọc `.env` và không gọi dịch vụ thật.

Máy chạy khảo sát thiếu `cmake`, compiler C++ và `cargo` trong PATH; chưa build/chạy
Zonos CPU, nên **chưa có số đo TTS thật**. API release GitHub chưa cung cấp binary
qua endpoint latest trong lần kiểm tra; không suy ra rằng upstream không có bản
phân phối khác. Cần cài toolchain hoặc chuẩn bị server Zonos ngoài backend.


## Số đo thật trên máy dev (13/11/2026)

Whisper CPU int8, 2 thread; WAV tiếng Việt tự tạo bằng espeak-ng tại
`/tmp/hireus-task78-whisper-self-generated.wav`, không dùng audio người dùng.
Đo HTTP localhost gồm upload/parse/decode/VAD/inference/JSON, model đã nạp lúc
startup; không tính tải model và startup vào latency request. Các số dưới đây
được đo lại sau sửa decoder M4A, trên phiên bản code cuối.

| Phép đo | Kết quả |
| --- | --- |
| Độ dài WAV tự tạo | 3277.052 ms |
| STT CPU lần 1 | 8735.207 ms; HTTP 200; text khác rỗng |
| STT CPU lần 2 | 7501.165 ms; HTTP 200; text khác rỗng |
| STT CPU lần 3 | 7148.860 ms; HTTP 200; text khác rỗng |
| AI Gemini | Chưa đo: không có key trong môi trường shell; không đọc `.env` |
| TTS Zonos | Chưa đo: thiếu toolchain CMake/C++/Rust, chưa chạy runtime |

**Kết quả lịch sử trước review**: STT clip 3,28s mất 7,15–8,74s. Mốc NFR hiện là 10s cho từng lần chờ; mẫu cũ chưa kiểm tra clip đến 30s hoặc AI+TTS. Ba mẫu dùng
cùng WAV tổng hợp chỉ kiểm tra đường chạy, chưa đánh giá độ chính xác hay khả năng
chịu tải. Không suy diễn thành số đo cho GPU hoặc máy khác. Giọng Wyatt tiếng Việt
còn cần nghe thử; chưa có bằng chứng runtime cho cả chu trình STT → AI → TTS.

## Kiểm tra Task 8

Build: pass; **249 unit / 8 suites**, **153 e2e / 7 suites**, giữ nguyên 193 unit
và 116 e2e cũ. Python: **9 tests**, mock model; có HTTP multipart/health, validation,
codec fixtures ffmpeg, timeout và khóa. Model không được tải trong test/CI.
E2E dùng fake provider, provider unit mock fetch. Không thêm dependency Node hoặc
sửa package.json. Môi trường Python khảo sát: 3.14.7, faster-whisper 1.2.1,
CTranslate2 4.9.0. Test socket/asyncio cần chạy ngoài sandbox hạn chế cổng/IPC.

Mâu thuẫn đã xử lý theo code hiện có: SETUP chưa có câu hỏi, câu OPENING chỉ tạo
sau `/start`; vì vậy TTS với SETUP bình thường trả 404. Không sửa state machine.
Mã 400 áp dụng cho trạng thái hai endpoint audio mới; các endpoint cũ giữ nguyên
409 khi code hiện hành quy định như vậy.

Bổ sung test M4A thường (metadata cuối file): pipe không seek đã trả 415 với
file hợp lệ. Sửa bằng protocol `cache:pipe:0` của ffmpeg/ffprobe, chỉ whitelist
`cache,pipe`; cache tạm đóng/unlink sau subprocess. Các file MP4 fragment và M4A
thường đều có test. Không bật truy cập file/network tùy ý từ input.

Các file triển khai: `interfaces/{tts,stt}-provider.interface.ts`,
`providers/{zonos-tts,whisper-stt,fake-tts,fake-stt}.provider.ts`,
`utils/tts-text-normalizer.util.ts` và các unit test mới; mở rộng
`vmi.controller.ts`, `vmi.service.ts`, `vmi.module.ts`; `test/vmi-audio.e2e-spec.ts`;
`services/stt-whisper/{main.py,test_main.py,requirements.txt,README.md}`;
`contracts/vmi.openapi.yaml`, `.env.example` và notes này.
Ngữ cảnh VMI được cập nhật local trong repo documents riêng; không sửa yêu cầu gốc.

## Sửa review: quy tắc số theo ngôn ngữ (13/11/2026)

Việt: dấu chấm nhóm từng ba chữ số (`10.000`, `1.250.000`); dấu phẩy luôn là
thập phân (`3,5`, kể cả `10,000`). Dấu chấm một nhóm không đủ ba chữ số như `1.5`
được đọc thập phân; `2.500` là số nguyên 2500. Anh: dấu phẩy nhóm nghìn được bỏ
trước khi giao NeMo, dấu chấm thập phân được giữ. Nhóm sai và số nguyên trên
12 chữ số giữ nguyên, không đọc một phần.

URL, IPv4 hợp lệ, ngày tháng, phiên bản có `v` hoặc nhãn `version`/`phiên bản`,
semver có hậu tố được giữ nguyên cả ký hiệu. Semver trần thông thường `1.2.3`
không khớp nhóm nghìn nên cũng giữ nguyên. Chuỗi trần như `1.250.123` không thể
phân biệt tuyệt đối số với phiên bản: mặc định coi là số nhóm nghìn ở phiên Việt;
viết `v1.250.123` hoặc `version 1.250.123` nếu muốn giữ như phiên bản.

Kế hoạch sửa review: (1) quy tắc số + regression tests; (2) cấu hình Whisper,
script đo HTTP và ma trận hai model; (3) teardown tài nguyên, smoke shutdown và
cập nhật NFR-VMI-01 theo quyết định mới. Mỗi mục có commit riêng trong backend.


## Review: cấu hình CPU và đo HTTP thật

Baseline đầu sửa review: build pass, **252 unit/8 suites**, **160 e2e/7 suites**;
bao gồm các test local người dùng vừa thêm. Commit sửa số: 282 unit/8 suites.

CPU mặc định mới: **small / int8 / auto tối đa 4 thread / beam 5 / VAD false /
condition_on_previous_text true**. CUDA mặc định giữ large-v3-turbo / float16;
chưa đo GPU. Alias model base/medium/small/large-v3-turbo đều cấu hình được; không
tự đổi model khi lỗi. Model nhỏ đánh đổi chất lượng, chưa được coi là cấu hình
production trước khi thử giọng thật. Số thread auto xét CPU visible/affinity và
quota cgroup nếu có; explicit 1..64 vẫn hoạt động.

Môi trường đo Python 3.14.7, faster-whisper 1.2.1, CTranslate2 4.9.0, CPU int8,
4 thread, 16 CPU visible. Đo tuần tự qua HTTP localhost sau warmup; clip 5 giây gồm
một câu tiếng Việt espeak trọn vẹn + khoảng lặng, ghép lặp thành 15/30/60 giây.
Không cắt giữa lời nói. Mỗi mốc 3 lần, giữ cả lỗi HTTP trong kết quả.
[JSON số đo](stt-cpu-review-benchmark.json) lưu từng lần và S/D/I/WER, không lưu
văn bản nhận diện. Lệnh tái lập từ backend với Python của venv STT:

```bash
python scripts/measure-stt-latency.py --models small --profiles comparison \
  --lengths 5 15 30 60 --repeats 3 --threads 4 \
  --cache-dir /tmp/hireus-task78-whisper-cache --output-dir /tmp/hireus-review-small
python scripts/measure-stt-latency.py --models large-v3-turbo --profiles fast \
  --lengths 5 15 30 60 --repeats 3 --threads 4 \
  --cache-dir /tmp/hireus-task78-whisper-cache --output-dir /tmp/hireus-review-large
```

| Model / profile | Clip | Trung bình | Lớn nhất | HTTP 200 | WER trung bình |
| --- | --- | --- | --- | --- | --- |
| small / comparison | 5s | 1.398s | 1.527s | 3/3 | 100.0% |
| small / comparison | 15s | 1.369s | 1.418s | 3/3 | 90.0% |
| small / comparison | 30s | 1.542s | 1.679s | 3/3 | 93.3% |
| small / comparison | 60s | 2.673s | 2.888s | 3/3 | 93.3% |
| large-v3-turbo / fast | 5s | 5.112s | 5.940s | 3/3 | 50.0% |
| large-v3-turbo / fast | 15s | 5.114s | 5.488s | 3/3 | 83.3% |
| large-v3-turbo / fast | 30s | 5.026s | 5.151s | 3/3 | 91.7% |
| large-v3-turbo / fast | 60s | 10.732s | 11.621s | 3/3 | 91.7% |

`comparison` là mặc định CPU mới (5/false/true). `fast` là profile cũ
(1/true/false), không phải mặc định mới. Đối chứng 15 giây: small fast WER 93,3%
so với 90,0% ở comparison; large có WER 83,3% ở cả hai. Vì không có bằng chứng
bộ nhanh giữ chất lượng small, **không bật mặc định** chỉ để lấy latency thấp.
Không suy nhân quả riêng cho từng flag từ phép so sánh cả bộ.

Chất lượng: small ở 5s có WER 100%, large 50%; cả hai bỏ nhiều lần lặp khi clip
dài, làm WER tăng rất cao. Đây là audio tổng hợp/lặp đơn điệu, không đại diện lời
trả lời tự nhiên hoặc thuật ngữ IT. Không dùng các số này để chứng minh chất
lượng tiếng Việt giảm/tăng trên giọng thật. Cần corpus người thật có transcript
chuẩn, cả vi/en và thuật ngữ, trước quyết định production.

Theo mốc **10s cho chờ STT đến khoảng 30s**, small mặc định và large/fast đều có
3/3 HTTP 200 dưới 10s ở 5/15/30s trong mẫu này. Small/fast ở 60s có một lần 422;
large/fast ở 60s có max vượt 10s. Kết quả latency đạt không khắc phục WER xấu.
Khuyến nghị máy dev CPU: small mặc định để thử luồng, bật sửa/gõ text; GPU: giữ
large-v3-turbo/float16 và đo lại, không hứa 10s khi chưa có GPU benchmark.

Timeout HTTP mặc định nâng lên **600000 ms** để chừa thời gian clip dài trên CPU;
`VMI_STT_TIMEOUT_MS` không rỗng ưu tiên, nếu thiếu dùng `WHISPER_STT_TIMEOUT_MS`
hiện có. Giữ mọi cấu hình cũ explicit, không âm thầm ghi đè. Timeout vẫn trả 504
sạch. 600s là ngân sách vận hành, không phải mốc nghiệm thu NFR. Chưa đo 180s nên
không hứa mọi clip 180s sẽ xong trong 600s. Khi có giọng thật, chọn timeout >= RTF
xấu nhất × 180s + biên decode/upload; không dựa vào duration client chưa xác minh.


## Review: shutdown và kiểm tra cuối

Đã tái hiện cảnh báo một named semaphore sau cả bốn lifecycle đầu đo. tqdm/Hugging
Face dùng multiprocessing RLock mặc dù service chỉ dùng thread; cấu hình bằng
API public `tqdm.set_lock(threading.RLock())` trước model load để tránh tạo semaphore
không cần thiết. Không tắt resource_tracker, không lọc warning, không unlink tên
semaphore tùy ý. Nguồn: [tqdm set_lock](https://tqdm.github.io/docs/tqdm/#set_lock).

Lifespan sở hữu một ThreadPoolExecutor; teardown chờ worker hoàn tất, hủy việc
chưa chạy, gọi CTranslate2 `model.unload_model()`, clear cache VAD và giải phóng
references. Thread lock điều phối overload được giữ đến lúc native inference xong
ngay cả khi HTTP waiter hủy, nên không mở một hàng đợi không giới hạn.
Nguồn: [CTranslate2 unload API](https://opennmt.net/CTranslate2/python/ctranslate2.models.Whisper.html#ctranslate2.models.Whisper.unload_model).

Sau sửa đã nạp model thật small và large-v3-turbo, warmup + ba request 5s/model,
sau đó SIGTERM uvicorn. **2/2 shutdown không còn warning resource_tracker/leaked
semaphore**; đợi thêm 0,5s để tracker flush rồi đọc log. Exit -15 là uvicorn phát
lại SIGTERM sau cleanup, không tự coi là thất bại. Artifact JSON có cả trước/sau.
Không ngoại suy thành bảo đảm cho SIGKILL hoặc native inference đang treo.

Kiểm tra cuối: Node v24.22.3; build pass; **285 unit/8 suites**, **160 e2e/7 suites**,
**19 test service Python**, **3 test script WER**, `bash -n` smoke script, checker
tài liệu. Baseline trước review: 252/160/9. Hai file test local có sẵn được giữ
nguyên phần review, không đưa các hunk đó vào ba commit sửa này.

Quyết định NFR 10s đã đồng bộ PROJECT_CONTEXT, VMI_CONTEXT, đặc tả VMI, Requirements
Analysis Markdown/HTML và README nguồn. Bản ghép nguyên văn giữ mốc cũ có chú thích
lịch sử, không dùng làm tiêu chí mới. TASKS.md local không được sửa theo giới hạn
đã đặt ở đầu tác vụ. Không thay máy trạng thái, AI/prompt/điểm, endpoint cũ hoặc FE.

## Re-review 14/11/2026 — bốn việc còn lại

### 1. Regex IPv4 và số lớn

HEAD đầu việc `098c979` đã có regex biên độc lập
`(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])`; không thay lại logic chuẩn hóa.
Backend bắt đầu sạch, kể cả file test reviewer (các ca reviewer đã nằm trong commit).
Bổ sung sáu regression tests cho vi/en: `1.300.000.000.000`,
`999.999.999.999.999` và IPv4 hợp lệ trong câu. Các số quá 12 chữ số giữ nguyên
**toàn bộ**, không cắt một phần thành IPv4 rồi để lại đuôi; quy tắc dấu chấm/phẩy
không đổi. Unit util: 50/50 pass, gồm toàn bộ ca reviewer.

Đo Node v24.22.3, ba lần/mẫu; mỗi lần chạy cả vi và en (ms cho cặp hai lần gọi):

| Mẫu | Ký tự | Trung bình | Lớn nhất |
| --- | --- | --- | --- |
| `1.` lặp + chữ số cuối | 12001 | 0.663 ms | 1.295 ms |
| `999.` lặp + nhóm cuối | 16003 | 0.930 ms | 1.149 ms |
| Toàn dấu chấm | 12000 | 0.058 ms | 0.064 ms |
| `a.` lặp | 12000 | 63.949 ms | 65.048 ms |

Không thấy treo/ReDoS ở các mẫu đã thử; đây là số đo mẫu, không phải chứng minh
mọi biểu thức còn lại luôn có độ phức tạp tuyến tính. Regex IPv4 có số lượng nhóm
và chiều dài mỗi nhóm bị chặn; không chỉnh các nhánh chuẩn hóa ngoài phạm vi.
