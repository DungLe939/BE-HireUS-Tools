# Tích hợp âm thanh VMI — Task 7 và Task 8

Quyết định người dùng ngày 13/11/2026 thay Google TTS/PhoWhisper bằng
Zyphra/ZONOS3-Mini và Whisper large-v3-turbo tự host. Code Task 0–6, prompt đánh
giá, repository và `/answers` vẫn giữ nguyên. Node kiểm tra: **v24.22.3**.

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

Chạy CPU từ checkout upstream (không clone/build trong backend):

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

**NFR-VMI-01 chưa đạt trong phép đo này**: riêng STT đã trên 5 giây. Ba mẫu dùng
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
