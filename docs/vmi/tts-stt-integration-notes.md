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

## Trạng thái xác minh vận hành

Chưa có số đo runtime mới ở thời điểm ghi phần khảo sát. Chỉ ghi số đo thật sau
khi chạy được các dịch vụ; không dùng thời gian mock làm số đo đáp ứng NFR-VMI-01.

## Kiểm tra Task 7

`npm run build`: pass; unit: **225/225, 7 suites**; e2e: **127/127, 7 suites**.
Giữ nguyên 193 unit và 116 e2e có sẵn. E2E âm thanh dùng provider giả, unit provider
mock fetch; không đọc `.env` và không gọi dịch vụ thật.

Máy chạy khảo sát thiếu `cmake`, compiler C++ và `cargo` trong PATH; chưa build/chạy
Zonos CPU, nên **chưa có số đo TTS thật**. API release GitHub chưa cung cấp binary
qua endpoint latest trong lần kiểm tra; không suy ra rằng upstream không có bản
phân phối khác. Cần cài toolchain hoặc chuẩn bị server Zonos ngoài backend.
