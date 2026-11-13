# Kế hoạch triển khai Backend module Voice Mock Interview (VMI)

# Tổng quan và nguyên tắc chung

- **Mục tiêu:** Xây dựng module backend NestJS cho phân hệ **Voice Mock Interview (VMI)** tại `backend/src/vmi/**`, cung cấp REST API đầy đủ từ thiết lập phiên, hỏi đáp theo lượt, STT/TTS, tổng hợp chấm điểm báo cáo, lịch sử phiên đến xử lý gián đoạn.
- **Tài liệu nguồn & lưu ý đường dẫn:**
  - `backend/AGENTS.md` và `backend/PROJECT_SOURCES.md` ghi đường dẫn tài liệu là `../CNPM-Docs`, nhưng trong workspace hiện tại submodule tài liệu nằm ở `../documents` (tức `documents/` ở cấp root).
  - Nguồn đặc tả VMI chuẩn áp dụng cho kế hoạch này: `documents/docs/Week02/Team Decision/Bai_lam_Voice_Mock_Interview.md` (`FR-VMI-01..23, 27..28`, `BR-VMI-01..05`, `NFR-VMI-01..04`, `U001..U005`).
  - Đối chiếu chéo với `documents/docs/Week02/Submission/Requirements_Analysis.md` (xem mục **Chỗ lệch giữa các tài liệu đặc tả** ở cuối file).
- **Quyết định kỹ thuật đã chốt:**
  - **Phạm vi:** Chỉ làm Backend trong `backend/`. Không làm Frontend, không làm Docker Compose, không làm dịch vụ FastAPI.
  - **AI Provider (`AiProvider`):** Dùng **Gemini** làm giải pháp tạm thời thay cho FastAPI + DeepSeek (đặc tả gốc dự kiến FastAPI + DeepSeek, hiện chưa có API key DeepSeek). Bọc toàn bộ sau interface `AiProvider` để sau thay thế không sửa service. Tên model, API key và timeout đọc từ biến môi trường `GEMINI_MODEL`, `GEMINI_API_KEY` và `GEMINI_TIMEOUT_MS` (chọn model hiện hành theo tài liệu chính thức của Google; không hard-code, không log, không trả ra client).
  - **Auth tạm:** Ngoài scope đăng nhập thật. Dùng `TempAuthGuard` + decorator `@CurrentUser()` (chỉ đọc header `x-mock-user-id` khi `NODE_ENV=test`; các môi trường khác luôn dùng `userId` cố định), để sau thay bằng JWT Guard thật.
  - **Database tạm:** PostgreSQL/Prisma do thành viên khác phụ trách. Dùng `VmiSessionRepository` interface + `InMemoryVmiSessionRepository` để sau thay bằng Prisma mà không sửa `VmiService`.
  - **Phân hệ CV/Profile:** Chờ phân hệ thật. Trường `cvId` là tùy chọn; chừa `CvProvider` interface + `EmptyCvProvider` rỗng. Chế độ không CV (`FR-VMI-04`) chạy bình thường; khi có CV thì lưu **bản chụp (`cvSnapshot`)** ngay thời điểm tạo phiên (`FR-VMI-23`).
  - **OpenAPI Contract:** Backend sở hữu contract tại `backend/contracts/vmi.openapi.yaml` (không cài `@nestjs/swagger` nếu không được yêu cầu). Viết/cập nhật contract trước khi code cho mỗi nhóm endpoint.
  - **Độ trễ chính thức (`NFR-VMI-01`):** Khi mạng ổn định, mỗi lần chờ không quá 10 giây: (a) từ lúc gửi audio đến lúc nhận văn bản STT, với clip trả lời thông thường đến khoảng 30 giây; (b) từ lúc nộp POST /answers đến khi có audio câu hỏi tiếp theo, gồm AI sinh câu hỏi và TTS. Không tính thời gian người dùng xác nhận/chỉnh sửa văn bản giữa hai bước. (Theo `Requirements_Analysis.md` hiện hành.)
  - **Audio (STT/TTS) — cập nhật 14/11/2026:** Tách `SttProvider`/`TtsProvider` khỏi `AiProvider`; REST theo từng lượt, STT trả nháp để xác nhận trước `/answers`. TTS dùng ZONOS3-Mini tự host; STT dùng faster-whisper **small cho mọi thiết bị**, CPU int8/CUDA float16. Giọng thật trên CPU i5-12500H, 4 luồng, small/int8: các đoạn đến khoảng 20 giây mất khoảng 2–4,3 giây; đoạn 80 giây trung bình 12,4 giây, tối đa 13,2 giây. Số đo espeak trước đây (120s khoảng 5,2s; 180s khoảng 7,5–7,6s) là dữ liệu lịch sử không đại diện cho giọng thật, không chứng minh đạt NFR ở mọi độ dài. Nội suy thô: khoảng 45 giây còn biên an toàn, 60 giây sát trần; đây là ước lượng chưa đo, chưa cộng tinh chỉnh LLM. Trên bộ mẫu tiếng Việt, medium chậm hơn và kém chính xác hơn large-v3-turbo xét tổng thể, không còn là phương án dự phòng được khuyến nghị. Giữ small và khả năng override model; chưa đo GPU.
  - **Spec Kit:** Không chạy các lệnh `speckit-*` (chỉ có script `.ps1`, môi trường hiện tại chạy Fedora Linux).
- **Phân định phạm vi Backend vs Frontend cho phần thiết bị âm thanh:**
  - `FR-VMI-07` (xin quyền mic trình duyệt), `FR-VMI-08` (đo cường độ tín hiệu real-time), `FR-VMI-09` (hiển thị hướng dẫn sửa lỗi mic), `BR-VMI-02` (cảnh báo mức âm = 0 suốt bài thử), và phần **audio visualizer** của `NFR-VMI-02`: **thuộc Frontend**, ngoài scope Backend.
  - `FR-VMI-10` (chỉ cho bắt đầu phiên khi đã kiểm tra thiết bị hoặc người dùng xác nhận sẵn sàng) và yêu cầu **song ngữ Việt/Anh đồng bộ** của `NFR-VMI-02`: **có phần việc Backend** (cổng xác nhận `deviceReady` khi `start` phiên ở Task 2; truyền ngôn ngữ phiên xuyên suốt prompt AI, STT, TTS và báo cáo).
- **Hiện trạng baseline cần biết (để Codex không cần khám phá lại):**
  - `backend/node_modules/` chưa cài đặt; `backend/src/` chỉ có `main.ts`, `app.module.ts`, `app.controller.ts`, `app.service.ts`, `app.controller.spec.ts`; `backend/test/` có `jest-e2e.json` và `app.e2e-spec.ts`.
  - `backend/tsconfig.json` dùng `"module": "nodenext"`, `"strict": true`, `"strictPropertyInitialization": false`.
  - `backend/package.json` hiện có `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` (`^12.0.1`), `rxjs` (`^7.8.1`), `reflect-metadata` (`^0.2.2`), `jest` (`^30.0.0`), `ts-jest` (`^29.4.0`), `supertest` (`^7.0.0`), `typescript` (`^6.0.2`).

# Ranh giới chỉnh sửa

Vùng được phép tạo/sửa (chỉ trong backend/):
- backend/src/vmi/** (module VMI mới: controller, service, DTO, interface, provider, repository, guard tạm)
- backend/test/ (chỉ thêm file e2e mới liên quan VMI)
- backend/contracts/ (thêm file OpenAPI cho VMI)
- backend/.env.example (tạo mới)
- Sửa tối thiểu, đúng mục đích đã ghi trong task: backend/src/app.module.ts (đăng ký VMI module), backend/package.json (chỉ thêm dependency thật sự cần, qua npm install, không sửa tay phần khác)

TUYỆT ĐỐI KHÔNG ĐỤNG VÀO:
- documents/ (toàn bộ submodule tài liệu, nguồn chuẩn chỉ đọc)
- frontend/ (toàn bộ)
- File cấp root: README.md, .gitmodules, và con trỏ submodule (không đổi commit mà superproject đang trỏ tới)
- .git/, .github/, và mọi cấu hình git (không push, không rebase, không đổi remote, không force)
- backend/.specify/, backend/.agents/, backend/.codex/, backend/AGENTS.md, backend/PROJECT_SOURCES.md (cấu hình agent và quy tắc dự án)
- backend/src/main.ts: không sửa trong các task Task 0 đến Task 8
- backend/package-lock.json: không sửa tay, chỉ để npm tự cập nhật
- backend/tsconfig*.json, backend/nest-cli.json, backend/jest.config.ts, backend/test/jest-e2e.json: không đổi trừ khi task ghi rõ lý do
- backend/.env và mọi file chứa key thật: không tạo, không đọc, không commit, không in ra log
- backend/node_modules/, backend/dist/, backend/coverage/
- Test và code có sẵn (app.controller.spec.ts, app.e2e-spec.ts, AppController, AppService): không xóa, không làm hỏng; các test này phải vẫn pass

Ngoài scope, thuộc thành viên khác, không tự làm dù thấy tiện:
- Prisma schema, migration, thư mục prisma/, kết nối PostgreSQL
- Đăng nhập thật (JWT, session, bảng user)
- Phân hệ CV/Profile (chỉ chừa interface CvProvider)
- Docker Compose, dịch vụ FastAPI

Quy tắc chung cho Codex:
- Chỉ sửa file nằm trong danh sách "File dự kiến tạo/sửa" của task đang làm.
- Cần sửa file ngoài danh sách thì dừng lại và hỏi, không tự sửa.
- Không xóa file, không đổi tên file có sẵn.
- Không cài dependency ngoài danh sách đã nêu trong task.
- Không commit nếu task không yêu cầu, và không commit file nhạy cảm.

# Bảng tổng hợp task

| ID | Tên | FR/BR liên quan | Phụ thuộc | Trạng thái (Sẵn sàng / Bị chặn) | Độ lớn (S/M/L) |
| --- | --- | --- | --- | --- | --- |
| Task 0 | Chuẩn bị nền Backend & khung module VMI | NFR-VMI-03 (khung guard tạm) | Không | Sẵn sàng | S |
| Task 1 | Cài đặt `AiProvider` (`initInterviewContext`) với Gemini | FR-VMI-05; BR-VMI-01; NFR-VMI-02, 03 | Task 0 | Sẵn sàng | M |
| Task 2 | OpenAPI Contract & API Thiết lập / Khởi tạo phiên | FR-VMI-01, 02, 04, 05, 06, 10, 23; U001; NFR-VMI-02, 03 | Task 0, Task 1 | Sẵn sàng | M |
| Task 3 | Vòng hỏi đáp dạng văn bản (Text Q&A) | FR-VMI-14, 15, 16; BR-VMI-01, 03; U002 | Task 2 | Sẵn sàng | M |
| Task 4 | Tổng hợp transcript, chấm điểm & báo cáo | FR-VMI-17..20; BR-VMI-04, 05; NFR-VMI-02; U004 | Task 3 | Sẵn sàng | M |
| Task 6 | Xử lý sự cố, bảo toàn phiên & tạo lại báo cáo | FR-VMI-27, 28; NFR-VMI-04; U002, U004 | Task 3, Task 4 | Sẵn sàng | M |
| Task 5 | API Lịch sử phiên trên Repository Interface *(Tùy chọn, nên làm lại cho đúng khi có DB ở Task 9)* | FR-VMI-21, 22, 23; NFR-VMI-03; U005 | Task 2, Task 4 | Sẵn sàng (Tùy chọn) | S |
| Task 7 | Tích hợp TTS phát giọng nói câu hỏi | FR-VMI-11; NFR-VMI-01, 02, 03; U002 | Task 3 + Chốt provider TTS | Bị chặn (chờ chốt TTS) | M |
| Task 8 | Tích hợp STT nhận diện câu trả lời & xác nhận | FR-VMI-12, 13; NFR-VMI-01, 02, 03; U002 | Task 3 + REST theo lượt | Đã tích hợp; mặc định small mọi thiết bị | M |
| Task 9 | Tích hợp Prisma DB, CV/Profile thật & Auth thật | FR-VMI-03, 21..23; NFR-VMI-03; U001, U005 | Task 4, Task 6 (Task 5 nếu chưa làm) + DB/CV/Auth từ thành viên khác | Bị chặn (chờ module ngoài) | M |

# Chi tiết từng task


**Quyết định mở — NFR-VMI-01 và câu trả lời dài:** mục tiêu chờ STT 10 giây chưa được bảo đảm cho mọi câu trả lời tối đa 180 giây (BR-VMI-03, FR-VMI-14). Bản NFR hiện hành mô tả clip thông thường khoảng 30 giây; chưa có quyết định xử lý clip dài. Các hướng cần nhóm/người dùng chọn: giới hạn ghi âm; chấp nhận chờ lâu hơn với câu dài và hiển thị tiến trình; gửi từng đoạn khi đang ghi âm. Chưa chọn hướng nào, không đổi nghiệp vụ, cap audio 195s hay state machine. Deadline HTTP 60s chỉ là chốt lỗi, không chứng minh đạt NFR. Phần chờ AI + TTS chưa được xác nhận đạt.

## Task 0: Chuẩn bị nền Backend & khung module VMI

- **Mục tiêu:** Cài đặt dependencies nền tảng, đăng ký `ValidationPipe` qua provider `APP_PIPE` trong `VmiModule` (để cả E2E test không chạy `main.ts` cũng áp dụng validation), dựng khung `VmiModule` với `TempAuthGuard`, `@CurrentUser()`, các interface/domain types cốt lõi và xác nhận baseline build/test hoạt động.
- **FR/BR/NFR liên quan:** Chuẩn bị nền cho toàn bộ VMI; chừa chỗ cho `NFR-VMI-03` (ownership theo `userId`).
- **Làm:**
  - Chạy `npm install` trong `backend/`, sau đó cài `class-validator` và `class-transformer` bằng `npm install`.
  - Tạo `backend/.env.example` với `PORT=3000`, `GEMINI_API_KEY=`, `GEMINI_MODEL=`, `GEMINI_TIMEOUT_MS=15000`, và placeholder ghi chú cho STT/TTS về sau.
  - Đăng ký `ValidationPipe` trong `backend/src/vmi/vmi.module.ts` bằng provider `APP_PIPE` (`new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`) thay vì đặt trong `main.ts`.
  - Tạo khung `VmiModule` (`backend/src/vmi/vmi.module.ts`) và đăng ký vào `AppModule` (`backend/src/app.module.ts`).
  - Tạo `TempAuthGuard` + `@CurrentUser()`: **chỉ đọc header `x-mock-user-id` khi `process.env.NODE_ENV === 'test'`**; ở mọi môi trường khác luôn trả về một `userId` cố định (kèm ghi chú `TODO` thay bằng guard thật).
  - Tạo domain types (`VmiPosition`, `VmiLevel`, `VmiLanguage`, `VmiSessionStatus` — bao gồm sẵn `SETUP`, `IN_PROGRESS`, `ENDED`, `EVALUATED`, `REPORT_FAILED` ngay từ đầu, `VmiStage`, `VmiSession`, `VmiTurn`, `VmiReport`), interface `VmiSessionRepository`, interface `CvProvider` và `EmptyCvProvider` rỗng.
- **Không làm:** Không sửa `backend/src/main.ts`, không tạo endpoint nghiệp vụ, không cài Prisma/JWT/Swagger, không đọc hoặc tạo `.env` thật, không gọi Gemini thật.
- **Phụ thuộc và điều kiện trước khi bắt đầu:** Không. Cần có quyền chạy `npm install` trong `backend/`.
- **Quyết định còn mở:** Không.
- **File dự kiến tạo/sửa:**
  - `backend/package.json` (chỉ thêm `class-validator`, `class-transformer` qua `npm install`)
  - `backend/package-lock.json` (chỉ do `npm` tự cập nhật)
  - `backend/.env.example`
  - `backend/src/app.module.ts`
  - `backend/src/vmi/vmi.module.ts`
  - `backend/src/vmi/types/vmi.types.ts`
  - `backend/src/vmi/guards/temp-auth.guard.ts`
  - `backend/src/vmi/decorators/current-user.decorator.ts`
  - `backend/src/vmi/interfaces/vmi-session-repository.interface.ts`
  - `backend/src/vmi/interfaces/cv-provider.interface.ts`
  - `backend/src/vmi/providers/empty-cv.provider.ts`
- **Vùng được phép sửa:** `backend/src/vmi/**`, `backend/src/app.module.ts`, `backend/.env.example`, `backend/package.json` (qua `npm install`).
- **Tuyệt đối không đụng:** `backend/src/main.ts`, `backend/tsconfig*.json`, `backend/jest.config.ts`, `backend/test/jest-e2e.json`, `backend/src/app.controller.ts`, `backend/src/app.service.ts`, `backend/src/app.controller.spec.ts`, `backend/test/app.e2e-spec.ts`, `backend/.env`.
- **Tiêu chí hoàn thành:**
  - `npm run build` trong `backend/` thoát mã `0`.
  - `npm test -- --runInBand` pass (`app.controller.spec.ts`).
  - `npm run test:e2e -- --runInBand` pass (`app.e2e-spec.ts`).
- **Rủi ro chính:** `backend/package.json` chạy Jest với `--experimental-vm-modules` trong khi `tsconfig.json` đặt `"module": "nodenext"` và thiếu `"type": "module"`. Nếu `npm test` lỗi do lệch cấu hình Jest/TypeScript 6, phải dừng lại báo người dùng chứ không tự sửa `tsconfig.json` hay `jest.config.ts`. Lưu ý `APP_PIPE` có phạm vi toàn ứng dụng khi `VmiModule` được import vào `AppModule`.

## Task 1: Cài đặt `AiProvider` (`initInterviewContext`) với Gemini

- **Mục tiêu:** Định nghĩa abstraction `AiProvider` và triển khai hàm `initInterviewContext` trong `GeminiAiProvider` (giải pháp tạm thay cho FastAPI + DeepSeek) đọc cấu hình từ biến môi trường, có timeout và validate schema đầu ra chặt chẽ.
- **FR/BR/NFR liên quan:** `FR-VMI-05`, `BR-VMI-01`, `NFR-VMI-02` (song ngữ Việt/Anh), `NFR-VMI-03` (bảo mật API key ở server).
- **Làm:**
  - **Bước tiên quyết:** Tra tài liệu chính thức của Google để chọn model ID hiện hành và xác nhận định dạng JSON mode của Gemini API; **nếu không truy cập được tài liệu thì dừng và hỏi người dùng, không tự đoán**.
  - Cập nhật `backend/.env.example`: bảo đảm có `GEMINI_API_KEY=`, `GEMINI_MODEL=`, và `GEMINI_TIMEOUT_MS=15000` (giá trị mặc định hợp lý, tính bằng ms).
  - Định nghĩa `AiProvider` interface trong `backend/src/vmi/interfaces/ai-provider.interface.ts`, trong Task 1 chỉ khai báo `initInterviewContext(input)` -> sinh kế hoạch/ngữ cảnh và câu hỏi mở đầu (`OPENING`) theo vị trí, cấp độ (`Intern`/`Fresher`), ngôn ngữ (`vi`/`en`) và `cvSnapshot?`.
  - Cài đặt `GeminiAiProvider.initInterviewContext` dùng `fetch` chuẩn của Node 22 gọi Gemini REST API (`generateContent` theo đúng định dạng JSON mode đã xác nhận từ tài liệu chính thức), truyền API key qua header `x-goog-api-key` (không gắn vào URL query string), đọc `GEMINI_API_KEY`, `GEMINI_MODEL` và `GEMINI_TIMEOUT_MS` (fallback mặc định `15000` ms nếu chưa set) từ `process.env`, đặt timeout qua `AbortSignal.timeout(...)`, validate JSON trả về và map lỗi thành exception nội bộ sạch (không bao giờ log hoặc ném `GEMINI_API_KEY` ra ngoài).
  - Đăng ký provider token `AI_PROVIDER` trong `backend/src/vmi/vmi.module.ts`.
  - Viết unit test `backend/src/vmi/providers/gemini-ai.provider.spec.ts` mock `global.fetch` cho `initInterviewContext`: kiểm tra gửi đúng ngôn ngữ/CV/cấp độ trong prompt, parse JSON hợp lệ, xử lý JSON lỗi, HTTP 4xx/5xx, timeout theo `GEMINI_TIMEOUT_MS`, thiếu env key/model, và kiểm tra message lỗi không chứa API key.
- **Không làm:** Không cài `generateNextQuestion` (chuyển sang Task 3) hay `evaluateInterview` (chuyển sang Task 4); không hard-code tên model hoặc API key; không tự đoán model ID hay JSON mode nếu không tra được tài liệu; không dùng key thật trong test; không thêm dependency SDK nặng nếu `fetch` chuẩn đã đáp ứng.
- **Phụ thuộc và điều kiện trước khi bắt đầu:** Task 0 hoàn thành + tra được tài liệu chính thức của Google cho Gemini API (nếu không truy cập được tài liệu phải dừng hỏi người dùng).
- **Quyết định còn mở:** Xác nhận chọn model ID hiện hành & định dạng JSON mode theo tài liệu chính thức của Google (nếu agent chạy Task 1 bị chặn mạng/không đọc được docs thì phải dừng hỏi người dùng trước khi code), và xác nhận dùng `fetch` chuẩn của Node 22 thay vì cài `@google/genai`.
- **File dự kiến tạo/sửa:**
  - `backend/.env.example`
  - `backend/src/vmi/interfaces/ai-provider.interface.ts`
  - `backend/src/vmi/providers/gemini-ai.provider.ts`
  - `backend/src/vmi/providers/gemini-ai.provider.spec.ts`
  - `backend/src/vmi/types/vmi.types.ts` (bổ sung type input/output cho `initInterviewContext`)
  - `backend/src/vmi/vmi.module.ts`
- **Vùng được phép sửa:** `backend/src/vmi/**`, `backend/.env.example`.
- **Tuyệt đối không đụng:** `backend/package.json` (nếu dùng `fetch`), `backend/.env`, `backend/src/main.ts`, `backend/src/app.module.ts`, `documents/`.
- **Tiêu chí hoàn thành:**
  - `npm run build` thoát mã `0`.
  - `npm test -- --runInBand` pass toàn bộ (gồm unit test `initInterviewContext` trong `gemini-ai.provider.spec.ts` và `app.controller.spec.ts`).
- **Rủi ro chính:** Không tra được tài liệu chính thức của Google dẫn đến đoán sai `GEMINI_MODEL` hoặc schema JSON mode; Gemini có thể trả JSON thiếu trường nên cần validate runtime từng field bắt buộc.

## Task 2: OpenAPI Contract & API Thiết lập / Khởi tạo phiên phỏng vấn

- **Mục tiêu:** Định nghĩa OpenAPI contract đầu tiên cho VMI, cài đặt `InMemoryVmiSessionRepository`, và xây API lấy tùy chọn cấu hình, tạo phiên phỏng vấn (có hoặc không có CV) và bắt đầu phiên khi đã sẵn sàng thiết bị.
- **FR/BR/NFR liên quan:** `FR-VMI-01`, `FR-VMI-02`, `FR-VMI-04`, `FR-VMI-05`, `FR-VMI-06`, `FR-VMI-10`, `FR-VMI-23` (snapshot CV), `NFR-VMI-02` (song ngữ), `NFR-VMI-03` (ownership), `U001`.
- **Làm:**
  - Tạo `backend/contracts/vmi.openapi.yaml` trước khi viết controller/DTO cho các endpoint:
    - `GET /vmi/options`: trả enum hợp lệ cho vị trí (`FRONTEND`, `BACKEND`, `FULLSTACK`, `MOBILE`, `AI_DATA`), cấp độ (`INTERN`, `FRESHER`), ngôn ngữ (`vi`, `en`), và khoảng số câu chuẩn (`5–8`).
    - `POST /vmi/sessions`: nhận `position`, `level`, `language`, `cvId?`, `targetQuestionCount?` (mặc định hợp lệ trong `5–8`). Nếu có `cvId`, gọi `CvProvider` lấy tóm tắt CV và lưu bản chụp `cvSnapshot` vào phiên — **lưu ý với `EmptyCvProvider` hiện tại, mọi `cvId` đều trả `404 Not Found` cho đến Task 9**; nếu không truyền `cvId`, khởi tạo ở chế độ không CV (`FR-VMI-04`). Gọi `AiProvider.initInterviewContext`, lưu phiên ở trạng thái `SETUP` (chứa câu hỏi mở đầu đầu tiên đã chuẩn bị sẵn) và trả chi tiết khởi tạo (không lộ prompt nội bộ hay thông tin nhạy cảm).
    - `POST /vmi/sessions/:id/start`: nhận `{ deviceReady: true }` (`FR-VMI-10`), kiểm tra quyền sở hữu `userId` và trạng thái `SETUP`, từ chối (`400`) nếu `deviceReady !== true`, chuyển sang `IN_PROGRESS` và trả câu hỏi đầu tiên.
  - Cài đặt `InMemoryVmiSessionRepository` (`backend/src/vmi/repositories/in-memory-vmi-session.repository.ts`) tách biệt hoàn toàn với `VmiService`.
  - Viết unit tests (`vmi.service.spec.ts`, `vmi.controller.spec.ts`) và E2E test (`backend/test/vmi-sessions.e2e-spec.ts`) dùng mock `AiProvider`, kiểm tra cả trường hợp `EmptyCvProvider` trả `404` khi có `cvId` và **test nhánh có CV bằng `CvProvider` giả** (override provider trong test module).
- **Không làm:** Không triển khai hỏi đáp lượt tiếp theo (Task 3), không gọi STT/TTS (Task 7–8), không nối DB thật, không cài `@nestjs/swagger`.
- **Phụ thuộc và điều kiện trước khi bắt đầu:** Task 0, Task 1 hoàn thành.
- **Quyết định còn mở:** Không.
- **File dự kiến tạo/sửa:**
  - `backend/contracts/vmi.openapi.yaml`
  - `backend/src/vmi/dto/create-vmi-session.dto.ts`
  - `backend/src/vmi/dto/start-vmi-session.dto.ts`
  - `backend/src/vmi/repositories/in-memory-vmi-session.repository.ts`
  - `backend/src/vmi/vmi.service.ts`
  - `backend/src/vmi/vmi.controller.ts`
  - `backend/src/vmi/vmi.module.ts`
  - `backend/src/vmi/vmi.service.spec.ts`
  - `backend/src/vmi/vmi.controller.spec.ts`
  - `backend/test/vmi-sessions.e2e-spec.ts`
- **Vùng được phép sửa:** `backend/contracts/`, `backend/src/vmi/**`, `backend/test/` (chỉ thêm `vmi-sessions.e2e-spec.ts`).
- **Tuyệt đối không đụng:** `backend/test/app.e2e-spec.ts`, `backend/contracts/README.md`, `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/package.json`, `documents/`.
- **Tiêu chí hoàn thành:**
  - `npm run build` thoát mã `0`.
  - `npm test -- --runInBand` pass.
  - `npm run test:e2e -- --runInBand` pass (cả `app.e2e-spec.ts` và `vmi-sessions.e2e-spec.ts`).
- **Rủi ro chính:** Thiết kế đường dẫn REST và schema trong `vmi.openapi.yaml` là contract gốc cho Frontend; cần giữ nhất quán naming (`camelCase` JSON, mã lỗi HTTP chuẩn NestJS) xuyên suốt các task sau.

## Task 3: Vòng hỏi đáp dạng văn bản (Text Q&A)

- **Mục tiêu:** Mở rộng `AiProvider` / `GeminiAiProvider` với `generateNextQuestion`, thiết kế sẵn trạng thái chịu lỗi theo lượt trong model (`pendingNextQuestion`), và cài đặt luồng nộp câu trả lời văn bản đã xác nhận, sinh câu hỏi tiếp theo/đào sâu theo 3 giai đoạn (`BR-VMI-03`) và mốc 3 phút/câu.
- **FR/BR/NFR liên quan:** `FR-VMI-14`, `FR-VMI-15`, `FR-VMI-16`, `BR-VMI-01`, `BR-VMI-03`, `U002`.
- **Làm:**
  - Mở rộng `AiProvider` interface và cài đặt `GeminiAiProvider.generateNextQuestion(input)` -> phân tích câu trả lời gần nhất + transcript trước đó để sinh câu hỏi tiếp theo (có câu hỏi đào sâu kỹ thuật `follow-up`), tuân thủ giai đoạn (`BR-VMI-03`), tỷ lệ >= 40% chuyên môn theo CV + độ sâu cấp độ (`BR-VMI-01`), và `GEMINI_TIMEOUT_MS`. Viết unit test riêng cho `generateNextQuestion` trong `backend/src/vmi/providers/gemini-ai.provider.spec.ts` (mock `fetch`).
  - Thiết kế sẵn trạng thái chịu lỗi trong model `VmiSession` (`backend/src/vmi/types/vmi.types.ts`): thêm cờ `pendingNextQuestion: boolean` (và `lastAiError?: string` không chứa secret) để Task 6 chỉ cần bổ sung endpoint retry và test mà không phải sửa lại luồng Task 3.
  - Cập nhật `backend/contracts/vmi.openapi.yaml` trước cho:
    - `POST /vmi/sessions/:id/answers`: nhận `{ questionId, answerText }` (validate không rỗng), kiểm tra phiên thuộc `userId`, đang ở `IN_PROGRESS`, chưa kẹt `pendingNextQuestion === true`, và `questionId` khớp câu hỏi hiện tại đang chờ trả lời. Tính `elapsedSeconds = now - currentTurn.askedAt`; nếu `> 180` giây đánh dấu `timedOut: true` (vẫn ghi nhận câu trả lời và chuyển câu tiếp theo đúng `BR-VMI-03`).
    - **Lưu câu trả lời vào lượt hiện tại trước khi gọi `AiProvider.generateNextQuestion`:** nếu chưa đạt `targetQuestionCount` (`5–8`), bật `pendingNextQuestion = true` và lưu vào repository trước rồi mới gọi `generateNextQuestion`. Nếu gọi AI thành công: thêm câu hỏi tiếp theo, tắt `pendingNextQuestion = false` và lưu; nếu AI lỗi/timeout: giữ nguyên câu trả lời đã lưu cùng `pendingNextQuestion = true` (không tự hủy phiên hay gán điểm `0%`) và ném lỗi 502/503/504 để client biết và giữ trạng thái chờ retry ở Task 6.
    - Nếu vừa hoàn tất câu hỏi cuối (`CLOSING`), tự động chuyển trạng thái phiên sang `ENDED` (`FR-VMI-16`), trả `completed: true` để client chuyển sang bước đánh giá.
    - `POST /vmi/sessions/:id/finish`: cho phép user chủ động kết thúc phiên bất kỳ lúc nào khi đang `IN_PROGRESS` (`FR-VMI-16`), chuyển trạng thái sang `ENDED`.
  - Bổ sung unit tests (`vmi.service.spec.ts`) kiểm tra: chuyển 3 giai đoạn ở `5` câu và `8` câu, đánh dấu `timedOut` khi quá 180s, từ chối nộp khi phiên không ở `IN_PROGRESS` hoặc sai `questionId`, thiết lập `pendingNextQuestion = true` và giữ câu trả lời khi `generateNextQuestion` lỗi, kết thúc sớm ở giữa phiên, cô lập `userId`.
  - Thêm `backend/test/vmi-interview-flow.e2e-spec.ts` kiểm thử trọn vòng hỏi đáp text.
- **Không làm:** Không cài `evaluateInterview` (Task 4), không xử lý STT/TTS (Task 7–8), chưa mở endpoint retry sinh câu hỏi tiếp theo hoặc retry báo cáo (Task 6).
- **Phụ thuộc và điều kiện trước khi bắt đầu:** Task 2 hoàn thành.
- **Quyết định còn mở:** Không.
- **File dự kiến tạo/sửa:**
  - `backend/contracts/vmi.openapi.yaml`
  - `backend/src/vmi/interfaces/ai-provider.interface.ts`
  - `backend/src/vmi/providers/gemini-ai.provider.ts`
  - `backend/src/vmi/providers/gemini-ai.provider.spec.ts`
  - `backend/src/vmi/dto/submit-vmi-answer.dto.ts`
  - `backend/src/vmi/types/vmi.types.ts`
  - `backend/src/vmi/interfaces/vmi-session-repository.interface.ts`
  - `backend/src/vmi/repositories/in-memory-vmi-session.repository.ts`
  - `backend/src/vmi/vmi.service.ts`
  - `backend/src/vmi/vmi.controller.ts`
  - `backend/src/vmi/vmi.service.spec.ts`
  - `backend/test/vmi-interview-flow.e2e-spec.ts`
- **Vùng được phép sửa:** `backend/contracts/`, `backend/src/vmi/**`, `backend/test/`.
- **Tuyệt đối không đụng:** `backend/test/app.e2e-spec.ts`, `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/package.json`, `documents/`.
- **Tiêu chí hoàn thành:**
  - `npm run build` thoát mã `0`.
  - `npm test -- --runInBand` pass (gồm unit test riêng cho `generateNextQuestion` trong `gemini-ai.provider.spec.ts`).
  - `npm run test:e2e -- --runInBand` pass.
- **Rủi ro chính:** Cần bảo đảm idempotency/state guard chặt để tránh nộp trùng 2 lần cho cùng một `questionId` (hoặc khi `pendingNextQuestion === true`) làm sai tổng số câu hoặc sai giai đoạn `BR-VMI-03`.

## Task 4: Tổng hợp transcript, chấm điểm & báo cáo

- **Mục tiêu:** Mở rộng `AiProvider` / `GeminiAiProvider` với `evaluateInterview`, tổng hợp transcript khi phiên kết thúc, áp dụng công thức `BR-VMI-04` và phân loại `BR-VMI-05` theo điểm chưa làm tròn tại backend, trả báo cáo kèm disclaimer; đồng thời xử lý nhánh `evaluateInterview` lỗi/timeout bằng trạng thái `REPORT_FAILED` và lỗi có cấu trúc (chưa làm endpoint retry).
- **FR/BR/NFR liên quan:** `FR-VMI-17`, `FR-VMI-18`, `FR-VMI-19`, `FR-VMI-20`, `BR-VMI-04`, `BR-VMI-05`, `NFR-VMI-02`, `U004` (chuẩn bị trạng thái `REPORT_FAILED` cho `FR-VMI-28`, `NFR-VMI-04`).
- **Làm:**
  - Mở rộng `AiProvider` interface và cài đặt `GeminiAiProvider.evaluateInterview(input)` -> phân tích toàn bộ transcript để chấm điểm 3 tiêu chí thành phần thang 0–100 (`technical`, `problemSolving`, `communication`), trích điểm mạnh, lỗ hổng kiến thức, gợi ý trả lời tốt hơn và chủ đề ôn tập theo ngôn ngữ phiên (`GEMINI_TIMEOUT_MS`). Viết unit test riêng cho `evaluateInterview` trong `backend/src/vmi/providers/gemini-ai.provider.spec.ts` (mock `fetch`).
  - Cập nhật `backend/contracts/vmi.openapi.yaml` trước cho `POST /vmi/sessions/:id/evaluate` (tổng hợp và tạo báo cáo cho phiên đã `ENDED`, bao gồm response lỗi `502`/`503`/`504` có cấu trúc và trạng thái `REPORT_FAILED` khi AI lỗi/timeout) và `GET /vmi/sessions/:id/report` (đọc báo cáo đã tạo).
  - Kiểm tra rẽ nhánh theo `U004` kịch bản phụ: nếu phiên kết thúc nhưng số câu đã trả lời bằng `0`, từ chối tạo báo cáo (`422 Unprocessable Entity` hoặc `400` theo contract, thông báo không đủ dữ liệu để đánh giá và không lưu báo cáo).
  - Tổng hợp toàn văn transcript (`FR-VMI-17`) và gọi `AiProvider.evaluateInterview` (`FR-VMI-18`, `FR-VMI-19`).
  - Khi `AiProvider.evaluateInterview` lỗi hoặc timeout: đặt trạng thái phiên thành `REPORT_FAILED`, giữ nguyên 100% transcript (không tự hủy phiên, không gán `0%`), và trả lỗi `502`/`503`/`504` có cấu trúc (mã lỗi nghiệp vụ rõ ràng, không lộ stack trace hay API key).
  - Cài đặt helper tính điểm thuần (`backend/src/vmi/utils/vmi-scoring.util.ts`):
    - Tính `rawScore = (technical * 0.5) + (problemSolving * 0.3) + (communication * 0.2)`.
    - **Phân loại `band` dựa trên `rawScore` chưa làm tròn:** `RED` (`rawScore < 50`), `YELLOW` (`50 <= rawScore < 75`), `GREEN` (`rawScore >= 75`) kèm text khuyến nghị theo `BR-VMI-05`.
    - **Chỉ làm tròn khi trả ra response** (ví dụ làm tròn `overallScore` 2 chữ số thập phân từ `rawScore`, không dùng giá trị đã làm tròn để phân loại `band`).
    - Gắn trường `disclaimer` khẳng định kết quả mang tính chất tham khảo rèn luyện, không khẳng định xác suất trúng tuyển (`FR-VMI-20`).
  - Khi đánh giá thành công: lưu báo cáo vào phiên và chuyển trạng thái `EVALUATED`.
  - Unit tests cho `vmi-scoring.util.ts` (test mọi giá trị biên `0`, `49.9`, **`49.99`**, `50`, `74.9`, **`74.99`**, `75`, `100` — xác nhận `49.99` thuộc `RED` và `74.99` thuộc `YELLOW`) và `vmi.service.spec.ts` (0 câu trả lời, phiên chưa kết thúc, đã đánh giá rồi, **và nhánh `evaluateInterview` lỗi/timeout chuyển trạng thái `REPORT_FAILED`, giữ nguyên 100% transcript và trả lỗi `502`/`503`/`504` có cấu trúc**); E2E test `backend/test/vmi-evaluation.e2e-spec.ts`.
- **Không làm:** Không làm endpoint retry khi AI lỗi ở task này (`POST /vmi/sessions/:id/next-question/retry`, `POST /vmi/sessions/:id/report/retry` làm ở Task 6), không xây API danh sách lịch sử (Task 5).
- **Phụ thuộc và điều kiện trước khi bắt đầu:** Task 3 hoàn thành.
- **Quyết định còn mở:** Không.
- **File dự kiến tạo/sửa:**
  - `backend/contracts/vmi.openapi.yaml`
  - `backend/src/vmi/interfaces/ai-provider.interface.ts`
  - `backend/src/vmi/providers/gemini-ai.provider.ts`
  - `backend/src/vmi/providers/gemini-ai.provider.spec.ts`
  - `backend/src/vmi/types/vmi.types.ts`
  - `backend/src/vmi/utils/vmi-scoring.util.ts`
  - `backend/src/vmi/utils/vmi-scoring.util.spec.ts`
  - `backend/src/vmi/vmi.service.ts`
  - `backend/src/vmi/vmi.controller.ts`
  - `backend/src/vmi/vmi.service.spec.ts`
  - `backend/test/vmi-evaluation.e2e-spec.ts`
- **Vùng được phép sửa:** `backend/contracts/`, `backend/src/vmi/**`, `backend/test/`.
- **Tuyệt đối không đụng:** `backend/test/app.e2e-spec.ts`, `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/package.json`, `documents/`.
- **Tiêu chí hoàn thành:**
  - `npm run build` thoát mã `0`.
  - `npm test -- --runInBand` pass (gồm unit test riêng cho `evaluateInterview`, test biên `49.99` / `74.99`, và unit test nhánh `evaluateInterview` lỗi/timeout -> `REPORT_FAILED`, giữ nguyên transcript, trả `502`/`503`/`504` có cấu trúc).
  - `npm run test:e2e -- --runInBand` pass.
- **Rủi ro chính:** Nếu giao diện `ui_context.md` ở Frontend không cho phép dùng màu đỏ/vàng/xanh truyền thống, Backend chỉ nên trả enum cấp độ (`RED`/`YELLOW`/`GREEN` hoặc kèm nhãn chữ tương ứng) mà không trả mã màu hex, để Frontend tự map hiển thị.

## Task 6: Xử lý sự cố, bảo toàn phiên & tạo lại báo cáo

- **Mục tiêu:** Chỉ bổ sung các endpoint retry và kiểm thử phục hồi trên nền trạng thái chịu lỗi đã có sẵn (`pendingNextQuestion` từ Task 3 và `REPORT_FAILED` cùng luồng xử lý lỗi `evaluateInterview` từ Task 4), không sửa lại luồng của Task 3 và Task 4.
- **FR/BR/NFR liên quan:** `FR-VMI-27`, `FR-VMI-28`, `NFR-VMI-04`, `U002` (mất kết nối), `U004` (lỗi tạo báo cáo).
- **Làm:**
  - Cập nhật `backend/contracts/vmi.openapi.yaml` trước để bổ sung endpoint `POST /vmi/sessions/:id/next-question/retry` và endpoint `POST /vmi/sessions/:id/report/retry` (tái sử dụng trạng thái `REPORT_FAILED` và response lỗi `502`/`503`/`504` có cấu trúc đã khai báo ở Task 4).
  - Tận dụng cờ `pendingNextQuestion === true` và câu trả lời đã lưu từ Task 3 (không sửa lại luồng nộp câu trả lời của Task 3) để triển khai `POST /vmi/sessions/:id/next-question/retry` (`FR-VMI-27`): gọi lại `AiProvider.generateNextQuestion` từ transcript hiện có, nếu thành công thì thêm câu hỏi mới và tắt `pendingNextQuestion = false`, nếu tiếp tục lỗi thì giữ nguyên phiên & transcript không bị trùng và trả lỗi `502`/`503`/`504` có cấu trúc.
  - Tận dụng trạng thái `REPORT_FAILED` và 100% transcript được bảo toàn từ luồng `evaluateInterview` của Task 4 (không sửa lại luồng xử lý của `POST /vmi/sessions/:id/evaluate` ở Task 4) để triển khai `POST /vmi/sessions/:id/report/retry` (`FR-VMI-28`, `NFR-VMI-04`): cho phép tạo lại báo cáo từ transcript đã lưu khi phiên đang ở trạng thái `REPORT_FAILED` mà không cần phỏng vấn lại.
  - Viết unit tests (`backend/src/vmi/vmi.service.spec.ts`) cho các endpoint retry và E2E test (`backend/test/vmi-resilience.e2e-spec.ts`) mô phỏng `AiProvider` lỗi/timeout ở lượt câu hỏi số 3 (`pendingNextQuestion = true`) và ở bước đánh giá (`REPORT_FAILED`), sau đó mock AI hồi phục và kiểm chứng retry thành công không mất hoặc trùng lượt nào.
- **Không làm:** Không sửa lại luồng lưu-trước-gọi-AI đã thiết kế ở Task 3 và không sửa lại luồng xử lý lỗi/`REPORT_FAILED` của Task 4; không xử lý lỗi mất kết nối từ phía trình duyệt (thuộc Frontend retry gọi API); không áp dụng cho STT/TTS ở task này (sẽ kế thừa mẫu xử lý lỗi ở Task 7–8).
- **Phụ thuộc và điều kiện trước khi bắt đầu:** Task 3, Task 4 hoàn thành.
- **Quyết định còn mở:** Không.
- **File dự kiến tạo/sửa:**
  - `backend/contracts/vmi.openapi.yaml`
  - `backend/src/vmi/vmi.service.ts`
  - `backend/src/vmi/vmi.controller.ts`
  - `backend/src/vmi/vmi.service.spec.ts`
  - `backend/test/vmi-resilience.e2e-spec.ts`
- **Vùng được phép sửa:** `backend/contracts/`, `backend/src/vmi/**`, `backend/test/`.
- **Tuyệt đối không đụng:** `backend/test/app.e2e-spec.ts`, `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/package.json`, `documents/`.
- **Tiêu chí hoàn thành:**
  - `npm run build` thoát mã `0`.
  - `npm test -- --runInBand` pass.
  - `npm run test:e2e -- --runInBand` pass.
- **Rủi ro chính:** Cần bảo đảm `POST /vmi/sessions/:id/next-question/retry` chỉ chạy khi `pendingNextQuestion === true` và `POST /vmi/sessions/:id/report/retry` chỉ chạy khi `status === 'REPORT_FAILED'` để tránh sinh thừa câu hỏi hoặc tạo lại báo cáo sai trạng thái.

## Task 5: API Lịch sử phiên trên Repository Interface *(Tùy chọn, nên làm lại cho đúng khi có DB ở Task 9)*

- **Mục tiêu:** *(Tùy chọn cho giai đoạn dùng `InMemoryVmiSessionRepository`; nên làm lại cho đúng truy vấn, phân trang và snapshot khi có DB thật ở Task 9)* Cung cấp API xem danh sách lịch sử phiên phỏng vấn theo thứ tự mới nhất, xem chi tiết transcript + báo cáo + CV snapshot đã dùng, và hỗ trợ tạo phiên mới từ cấu hình cũ.
- **FR/BR/NFR liên quan:** `FR-VMI-21`, `FR-VMI-22`, `FR-VMI-23`, `NFR-VMI-03`, `U005`.
- **Làm:**
  - Cập nhật `backend/contracts/vmi.openapi.yaml` trước cho:
    - `GET /vmi/sessions`: lấy danh sách phiên thuộc `@CurrentUser()`, sắp xếp mới nhất trước (`createdAt DESC`), hỗ trợ query phân trang cơ bản (`limit`, `offset` hoặc `page`, `pageSize`), trả tóm tắt gồm thời điểm, vị trí, cấp độ, ngôn ngữ, trạng thái, điểm tổng hợp, mức phân loại (`U005`).
    - `GET /vmi/sessions/:id`: trả chi tiết phiên (cấu hình, `cvSnapshot`, toàn bộ transcript, điểm số, báo cáo). Chỉ trả nếu `session.userId === currentUserId` (`403`/`404` nếu không thuộc sở hữu).
    - `POST /vmi/sessions/:id/replay` (tùy chọn khớp `U005` bước 3 "Phỏng vấn lại với cấu hình này"): tạo phiên mới dùng lại `position`, `level`, `language`, `cvId` của phiên cũ.
  - Bổ sung method `findManyByUserId(userId, pagination)` trong `VmiSessionRepository` và `InMemoryVmiSessionRepository`.
  - Viết unit & E2E tests chứng minh: sắp xếp giảm dần theo thời gian, user B không xem được phiên của user A, và khi mock `CvProvider` đổi dữ liệu CV gốc thì `GET /vmi/sessions/:id` vẫn giữ nguyên `cvSnapshot` cũ (`FR-VMI-23`).
- **Không làm:** Không kết nối PostgreSQL/Prisma, không tích hợp Auth JWT thật (được hoãn sang Task 9).
- **Phụ thuộc và điều kiện trước khi bắt đầu:** Task 2, Task 4 hoàn thành. (Có thể bỏ qua ở giai đoạn in-memory và cài đặt đầy đủ cùng DB thật tại Task 9).
- **Quyết định còn mở:** Cần xác nhận với Frontend có cần endpoint `POST /vmi/sessions/:id/replay` không hay Frontend tự gọi `POST /vmi/sessions` với cấu hình đọc từ `GET /vmi/sessions/:id`, và có muốn làm Task 5 ngay trên in-memory hay gộp làm trực tiếp khi có DB ở Task 9.
- **File dự kiến tạo/sửa:**
  - `backend/contracts/vmi.openapi.yaml`
  - `backend/src/vmi/dto/list-vmi-sessions-query.dto.ts`
  - `backend/src/vmi/interfaces/vmi-session-repository.interface.ts`
  - `backend/src/vmi/repositories/in-memory-vmi-session.repository.ts`
  - `backend/src/vmi/vmi.service.ts`
  - `backend/src/vmi/vmi.controller.ts`
  - `backend/src/vmi/vmi.service.spec.ts`
  - `backend/test/vmi-history.e2e-spec.ts`
- **Vùng được phép sửa:** `backend/contracts/`, `backend/src/vmi/**`, `backend/test/`.
- **Tuyệt đối không đụng:** `backend/test/app.e2e-spec.ts`, `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/package.json`, `documents/`.
- **Tiêu chí hoàn thành:**
  - `npm run build` thoát mã `0`.
  - `npm test -- --runInBand` pass.
  - `npm run test:e2e -- --runInBand` pass.
- **Rủi ro chính:** Dữ liệu trong `InMemoryVmiSessionRepository` sẽ mất khi restart server và không phản ánh tối ưu truy vấn/pagination của PostgreSQL; cần rà soát và làm lại chuẩn hóa với Prisma tại Task 9.

## Task 7: Tích hợp TTS phát giọng nói câu hỏi

- **Mục tiêu:** Định nghĩa `TtsProvider` tách riêng khỏi `AiProvider` và cung cấp API chuyển câu hỏi của phiên thành âm thanh theo ngôn ngữ (`vi`/`en`), hỗ trợ phát lại khi người dùng chưa nghe rõ.
- **FR/BR/NFR liên quan:** `FR-VMI-11`, `NFR-VMI-01` (theo định nghĩa từng lần chờ ở Tổng quan), `NFR-VMI-02` (song ngữ), `NFR-VMI-03` (bảo mật & ownership), `U002` (nhắc lại câu hỏi).
- **Làm:**
  - **Bước tiên quyết:** Tra tài liệu chính thức của nhà cung cấp TTS đã được người dùng chốt về chất lượng tiếng Việt, tiếng Anh, độ trễ và format audio.
  - Tạo `TtsProvider` interface (`backend/src/vmi/interfaces/tts-provider.interface.ts`) và implementation theo nhà cung cấp đã chọn (đọc API key/config từ `process.env`, cập nhật biến mẫu vào `backend/.env.example`, timeout và không log key).
  - Cập nhật `backend/contracts/vmi.openapi.yaml` trước cho `POST /vmi/sessions/:id/questions/:questionId/tts` (hoặc `GET /vmi/sessions/:id/questions/:questionId/audio`).
  - Kiểm tra `session` thuộc `userId` (`NFR-VMI-03`), kiểm tra `questionId` tồn tại trong `session.turns`, đọc `session.language`, gọi `TtsProvider.synthesize(questionText, language)` và trả về buffer/stream audio với `Content-Type` phù hợp. Hỗ trợ gọi lại nhiều lần cho cùng `questionId` để phục vụ nút "Nhắc lại câu hỏi" (`U002`) mà không thay đổi trạng thái phiên.
  - Viết unit test (mock provider) và E2E test (`backend/test/vmi-audio.e2e-spec.ts`).
- **Không làm:** Không gộp `TtsProvider` vào `AiProvider`; không lưu file audio xuống đĩa cục bộ nếu chưa có yêu cầu; không dùng key thật trong code hoặc test.
- **Phụ thuộc và điều kiện trước khi bắt đầu:** Task 3 hoàn thành + **Người dùng đã chốt nhà cung cấp TTS** sau bước tra tài liệu chất lượng tiếng Việt & độ trễ.
- **Quyết định còn mở (Quyết định cần người dùng chốt trước khi làm):**
  1. **Chọn nhà cung cấp TTS:** Chốt dùng dịch vụ nào (ví dụ Google Cloud TTS, OpenAI TTS, ElevenLabs, Gemini TTS hoặc mô hình Hugging Face/Zonos) sau khi tra tài liệu kiểm tra chất lượng phát âm **tiếng Việt**, tiếng Anh và độ trễ lần chờ (b), từ lúc nộp `/answers` đến khi có audio câu hỏi tiếp theo (AI + TTS) (`NFR-VMI-01`).
  2. **Kiểu trả dữ liệu:** Trả nhị phân `audio/mpeg` (hoặc `audio/wav`) trực tiếp qua HTTP response hay JSON chứa base64 (đề xuất: binary `audio/*` để giảm overhead ~33% kích thước và giảm độ trễ).
- **File dự kiến tạo/sửa:**
  - `backend/contracts/vmi.openapi.yaml`
  - `backend/.env.example`
  - `backend/package.json` & `backend/package-lock.json` (chỉ nếu provider đã chốt bắt buộc dùng SDK cài qua `npm install`)
  - `backend/src/vmi/interfaces/tts-provider.interface.ts`
  - `backend/src/vmi/providers/<chosen>-tts.provider.ts`
  - `backend/src/vmi/providers/tts.provider.spec.ts`
  - `backend/src/vmi/vmi.service.ts`
  - `backend/src/vmi/vmi.controller.ts`
  - `backend/src/vmi/vmi.module.ts`
  - `backend/test/vmi-audio.e2e-spec.ts`
- **Vùng được phép sửa:** `backend/contracts/`, `backend/.env.example`, `backend/src/vmi/**`, `backend/test/`, `backend/package.json` (qua `npm install` nếu cần).
- **Tuyệt đối không đụng:** `backend/.env`, `backend/src/vmi/interfaces/ai-provider.interface.ts` (không nhét TTS vào `AiProvider`), `backend/src/main.ts`, `backend/src/app.module.ts`, `documents/`.
- **Tiêu chí hoàn thành:**
  - `npm run build` thoát mã `0`.
  - `npm test -- --runInBand` pass.
  - `npm run test:e2e -- --runInBand` pass.
- **Rủi ro chính:** TTS tiếng Việt của một số model tạo độ trễ cao (> 2–3s riêng phần TTS), dễ làm lần chờ từ lúc nộp `/answers` đến khi có audio câu hỏi tiếp theo (AI + TTS) vượt 10 giây (`NFR-VMI-01`).

## Task 8: Tích hợp STT nhận diện câu trả lời & luồng xác nhận

- **Mục tiêu:** Định nghĩa `SttProvider` tách riêng khỏi `AiProvider`, tiếp nhận đoạn ghi âm câu trả lời theo từng lượt và trả văn bản nhận diện tạm (`FR-VMI-12, 13`) để người dùng kiểm tra/nói lại trước khi gửi qua API nộp câu trả lời.
- **FR/BR/NFR liên quan:** `FR-VMI-12`, `FR-VMI-13`, `NFR-VMI-01` (theo định nghĩa từng lần chờ ở Tổng quan), `NFR-VMI-02` (song ngữ), `NFR-VMI-03` (bảo mật & ownership), `U002`.
- **Làm:**
  - **Bước tiên quyết:** Người dùng chốt giao thức audio và nhà cung cấp STT (sau khi tra tài liệu về độ chính xác tiếng Việt/Anh và độ trễ).
  - Cài `@types/multer` (devDependency qua `npm install -D @types/multer`) nếu dùng `@UploadedFile()` + `Express.Multer.File` của `@nestjs/platform-express`.
  - Tạo `SttProvider` interface (`backend/src/vmi/interfaces/stt-provider.interface.ts`) và implementation theo nhà cung cấp đã chọn (đọc key/config từ `process.env`, cập nhật `backend/.env.example`, có timeout, không log nội dung audio nhạy cảm hay key).
  - Cập nhật `backend/contracts/vmi.openapi.yaml` trước cho `POST /vmi/sessions/:id/stt` (với giao thức đề xuất REST `multipart/form-data`, field `audio`, kèm `questionId?`). Validate kích thước tối đa, định dạng MIME audio được hỗ trợ, phiên thuộc `userId` và đang `IN_PROGRESS`.
  - **Bắt buộc theo `FR-VMI-13`:** Endpoint STT **chỉ trả về `{ transcriptText, language, durationMs }`** để client hiển thị cho người dùng xác nhận hoặc nói lại; **không** tự động gọi `AiProvider` nộp câu trả lời hay chuyển câu hỏi. Nếu người dùng chọn nói lại, có thể gọi lại `/stt` mà không làm thay đổi transcript phiên.
  - Ghi đo thời gian xử lý (latency metric nội bộ không chứa PII) để phục vụ theo dõi ngưỡng `NFR-VMI-01`.
  - Viết unit test (mock STT provider + kiểm tra giới hạn file/MIME) và bổ sung E2E test vào `backend/test/vmi-audio.e2e-spec.ts`.
- **Không làm:** Không nhét `SttProvider` vào `AiProvider`; không tự mở WebSocket/WebRTC gateway khi chưa chốt đổi giao thức; không lưu file audio lâu dài xuống đĩa cục bộ.
- **Phụ thuộc và điều kiện trước khi bắt đầu:** Task 3 hoàn thành + **Người dùng đã chốt giao thức audio và nhà cung cấp STT**.
- **Quyết định còn mở (Quyết định cần người dùng chốt trước khi làm):**
  1. **Chốt giao thức audio:** Chấp nhận đề xuất **REST theo từng lượt** (upload file ghi âm 1 câu trả lời qua `multipart/form-data` vì có bước user xác nhận văn bản `FR-VMI-13`) hay yêu cầu chuyển sang WebSocket/WebRTC (hội thoại liên tục)?
  2. **Nhà cung cấp STT đã chốt (14/11/2026):** faster-whisper tự host, mặc định `small` trên CPU/CUDA/auto. Cấu hình hiện dùng chỉ small; giữ override env để tương thích, medium không còn được khuyến nghị dự phòng theo bộ mẫu giọng thật; dùng số đo và quyết định mở ở Tổng quan.
  3. **Giới hạn kỹ thuật upload:** Định dạng audio Frontend sẽ gửi (`audio/webm`, `audio/wav`, `audio/mp4`...) và dung lượng tối đa mỗi câu trả lời 3 phút (ví dụ `10 MB` hoặc `15 MB`).
- **File dự kiến tạo/sửa:**
  - `backend/contracts/vmi.openapi.yaml`
  - `backend/.env.example`
  - `backend/package.json` & `backend/package-lock.json` (`npm install -D @types/multer` + SDK STT nếu cần)
  - `backend/src/vmi/interfaces/stt-provider.interface.ts`
  - `backend/src/vmi/providers/<chosen>-stt.provider.ts`
  - `backend/src/vmi/providers/stt.provider.spec.ts`
  - `backend/src/vmi/vmi.service.ts`
  - `backend/src/vmi/vmi.controller.ts`
  - `backend/src/vmi/vmi.module.ts`
  - `backend/test/vmi-audio.e2e-spec.ts`
- **Vùng được phép sửa:** `backend/contracts/`, `backend/.env.example`, `backend/src/vmi/**`, `backend/test/`, `backend/package.json` (qua `npm install`).
- **Tuyệt đối không đụng:** `backend/.env`, `backend/src/vmi/interfaces/ai-provider.interface.ts`, `backend/src/main.ts`, `backend/src/app.module.ts`, `documents/`.
- **Tiêu chí hoàn thành:**
  - `npm run build` thoát mã `0`.
  - `npm test -- --runInBand` pass.
  - `npm run test:e2e -- --runInBand` pass (bao gồm test upload audio giả lập và kiểm chứng STT không tự chuyển câu).
- **Rủi ro chính:** Định dạng ghi âm trình duyệt (`MediaRecorder` tạo `webm/opus` trên Chrome/Firefox nhưng Safari có thể tạo `mp4/aac`) có thể không tương thích trực tiếp với một số STT API nếu không thống nhất định dạng giữa Frontend và Backend.

## Task 9: [BỊ CHẶN] Tích hợp Prisma DB thật, Phân hệ CV/Profile thật & Auth thật

- **Mục tiêu:** Thay thế 3 thành phần tạm (`InMemoryVmiSessionRepository`, `EmptyCvProvider`, `TempAuthGuard`) bằng hạ tầng thật khi các thành viên khác hoàn tất Prisma/PostgreSQL, module CV/Profile và module Auth.
- **FR/BR/NFR liên quan:** `FR-VMI-03`, `FR-VMI-21`, `FR-VMI-22`, `FR-VMI-23`, `NFR-VMI-03`, `U001`, `U005`.
- **Làm:**
  - Viết `PrismaVmiSessionRepository` triển khai `VmiSessionRepository` để lưu và truy vấn dữ liệu phiên bền vững trong PostgreSQL (lưu `cvSnapshot` dạng JSONB/cột riêng để đảm bảo `FR-VMI-23`).
  - Viết adapter thật triển khai `CvProvider` gọi sang service/module CV của hệ thống; mở rộng `GET /vmi/cvs` (hoặc cập nhật OpenAPI nếu cần proxy qua VMI) để phục vụ `FR-VMI-03`.
  - Thay `TempAuthGuard` trên `VmiController` bằng Auth JWT Guard thật của dự án và map `@CurrentUser()` từ payload xác thực thật.
  - Cập nhật `VmiModule` đổi binding DI sang repository/provider thật; cập nhật E2E tests với DB/Auth test double hoặc test DB được cấu hình.
- **Không làm:** Không tự tạo bảng/migration Prisma khi chưa phối hợp với người phụ trách DB; không tự viết hệ thống đăng nhập JWT; không chỉnh sửa trực tiếp nghiệp vụ của module CV/Profile.
- **Phụ thuộc và điều kiện trước khi bắt đầu:** **ĐANG BỊ CHẶN** bởi:
  1. Thành viên phụ trách DB hoàn thành thiết kế ERD, `prisma/schema.prisma`, `PrismaModule`/`PrismaService`.
  2. Thành viên phụ trách phân hệ CV/Profile hoàn thành service lấy danh sách CV và chi tiết CV.
  3. Thành viên phụ trách Auth hoàn thành JWT Guard + cơ chế lấy user hiện tại.
- **Quyết định còn mở (cần người dùng duyệt vì liên quan ngoài vùng được phép):**
  1. **Mở rộng vùng được phép chỉnh sửa:** Việc thêm model VMI vào `backend/prisma/schema.prisma` và import `PrismaModule` / `CvModule` / `AuthModule` vào `backend/src/vmi/vmi.module.ts` (hoặc `backend/src/app.module.ts`) liên quan trực tiếp các thư mục ngoài `backend/src/vmi/**` (`backend/prisma/**`, `backend/src/auth/**`, `backend/src/cv/**`, `backend/src/prisma/**`). Cần người dùng chốt ai sẽ sửa `schema.prisma` và cấp phép vùng sửa khi đến Task 9.
  2. **Điểm lấy danh sách CV (`FR-VMI-03`):** Frontend gọi trực tiếp API của phân hệ CV để lấy list CV rồi gửi `cvId` sang `POST /vmi/sessions`, hay Backend VMI cần bọc thêm `GET /vmi/cvs`?
  3. **Xử lý `temp-auth.guard.ts`:** Do quy tắc "Không xóa file có sẵn", cần duyệt xóa hay giữ lại file guard tạm sau khi đổi binding sang guard thật.
- **File dự kiến tạo/sửa:**
  - Trong vùng hiện được phép: `backend/src/vmi/repositories/prisma-vmi-session.repository.ts`, `backend/src/vmi/providers/real-cv.provider.ts`, `backend/src/vmi/vmi.module.ts`, `backend/src/vmi/vmi.controller.ts`, `backend/contracts/vmi.openapi.yaml`, `backend/test/vmi-integration.e2e-spec.ts`.
  - **Cần duyệt ngoài vùng (chưa tự đưa vào danh sách sửa):** `backend/prisma/schema.prisma` (model VMI), `backend/src/app.module.ts` (nếu cần import module dùng chung).
- **Vùng được phép sửa:** `backend/src/vmi/**`, `backend/contracts/`, `backend/test/` (mọi sửa đổi ngoài vùng này phải chờ duyệt ở mục Quyết định còn mở).
- **Tuyệt đối không đụng:** Tự ý chạy `prisma migrate reset` / xóa DB (`backend/AGENTS.md`, `backend/.agents/skills/prisma-data/SKILL.md`), sửa module của thành viên khác nếu chưa phối hợp.
- **Tiêu chí hoàn thành:**
  - `npm run build` thoát mã `0`.
  - `npm test -- --runInBand` pass.
  - `npm run test:e2e -- --runInBand` pass với dữ liệu được lưu bền vững và từ chối truy cập chéo user với JWT thật.
- **Rủi ro chính:** Schema DB hoặc DTO của phân hệ CV/Auth từ thành viên khác có thể khác cấu trúc `CvSummary` giả định trong `CvProvider`; cần map qua adapter để không sửa logic lõi trong `VmiService`.

# Quyết định còn mở và việc cần người dùng làm

1. **[Trước Task 1 — BẮT BUỘC chốt / kiểm tra khi làm]** Tra tài liệu chính thức của Google để chốt model ID hiện hành (`GEMINI_MODEL`) và định dạng JSON mode (nếu không truy cập được tài liệu thì dừng hỏi người dùng, không tự đoán); xác nhận dùng `fetch` chuẩn của Node 22 hay cài SDK `@google/genai`.
2. **[Trước Task 5 — Tùy chọn]** Xác nhận có làm Task 5 ngay trên in-memory hay gộp làm trực tiếp khi có DB ở Task 9, và có cần endpoint `POST /vmi/sessions/:id/replay` hay Frontend tự gọi lại `POST /vmi/sessions`.
3. **[Trước Task 7 & Task 8 — BẮT BUỘC chốt để gỡ chặn Audio]**
   - **Người dùng chốt giao thức audio:** Mặc định đề xuất **REST theo từng lượt** (phù hợp với `FR-VMI-13` có bước xác nhận văn bản trước khi nộp) hay đổi sang WebSocket/WebRTC?
   - **Người dùng (hoặc team AI) chốt nhà cung cấp STT và TTS:** Tra tài liệu để kiểm tra chất lượng tiếng Việt, tiếng Anh, độ trễ (đánh giá riêng lần chờ (a) gửi audio → văn bản STT và lần chờ (b) nộp `/answers` → audio câu hỏi tiếp theo, mỗi lần không quá 10 giây theo `NFR-VMI-01`) và chọn format audio chuẩn giữa Frontend & Backend (`webm/opus`, `wav`, `mp3`...).
   - **Chốt kiểu trả audio của TTS (Task 7):** Binary stream (`audio/*`) hay JSON base64.
4. **[Trước Task 9 — BẮT BUỘC chờ thành viên khác & chốt ranh giới]**
   - Hoàn thiện Prisma/PostgreSQL, phân hệ CV/Profile, phân hệ Auth từ các thành viên khác.
   - Duyệt quyền sửa/phối hợp ngoài vùng (`backend/prisma/schema.prisma`, import `PrismaModule`/`CvModule`/`AuthModule`) và chốt `GET /vmi/cvs` thuộc VMI hay Frontend gọi trực tiếp module CV.

# Chỗ lệch giữa các tài liệu đặc tả

Đối chiếu `documents/docs/Week02/Team Decision/Bai_lam_Voice_Mock_Interview.md` (nguồn đặc tả VMI chi tiết được chọn làm chuẩn cho kế hoạch này) với `documents/docs/Week02/Submission/Requirements_Analysis.md` (bản tổng hợp nộp Week02):

1. **Độ trễ tối đa (`NFR-VMI-01` vs `U002`):**
   - `Bai_lam_Voice_Mock_Interview.md`: NFR-VMI-01 và ràng buộc U002 đã đồng bộ mốc 10 giây cho từng lần chờ; không còn áp dụng mô tả mâu thuẫn cũ.
   - `Requirements_Analysis.md`: Khi mạng ổn định, mỗi lần chờ không quá 10 giây: (a) từ lúc gửi audio đến lúc nhận văn bản STT, với clip trả lời thông thường đến khoảng 30 giây; (b) từ lúc nộp POST /answers đến khi có audio câu hỏi tiếp theo, gồm AI sinh câu hỏi và TTS. Không tính thời gian người dùng xác nhận/chỉnh sửa văn bản giữa hai bước.
   - *Áp dụng theo quyết định đã chốt:* Dùng nguyên định nghĩa `Requirements_Analysis.md` ở trên, không cộng STT với AI + TTS thành một tổng chu trình.
2. **Số lượng và đánh số FR (`FR-VMI-xx`):**
   - `Bai_lam_Voice_Mock_Interview.md` có **25 mã FR** (`FR-VMI-01..23` và nhảy cóc sang `FR-VMI-27, 28`, khuyết `24–26`).
   - `Requirements_Analysis.md` (mục 3.2.1 b, dòng 145–155) rút gọn thành **9 mã FR đại diện** (`FR-VMI-01, 05, 07, 11, 14, 16, 18, 21, 27`), gộp hành vi của các mã chi tiết vào cột Details (ví dụ `FR-VMI-11` gộp cả TTS + STT + xác nhận văn bản; `FR-VMI-27` gộp cả xử lý gián đoạn phiên lẫn tạo lại báo cáo).
   - *(Ghi chú thêm: `documents/docs/Week02/Team Decision/Week02_Tong_Hop_Nguyen_Van.md` có bộ đánh số dài hơn tới `FR-VMI-32+`, không dùng làm chuẩn theo chỉ dẫn hiện tại).*
3. **Mã Use Case:**
   - `Bai_lam_Voice_Mock_Interview.md` dùng mã `U001`–`U005`.
   - `Requirements_Analysis.md` dùng mã chuẩn hóa theo phân hệ `UC-VMI-01`–`UC-VMI-05` (tương ứng 1-1 về nội dung với `U001`–`U005`).
4. **Hành vi có trong đặc tả Use Case nhưng không có mã FR riêng trong `Bai_lam_Voice_Mock_Interview.md`:**
   - **Phát đoạn âm thanh mẫu** trong kiểm tra loa/tai nghe (`U003` bước 3 / `UC-VMI-03` bước 2, không có trong `FR-VMI-07..10`; thuộc Frontend).
   - **Nhắc lại câu hỏi khi chưa nghe rõ** (`U002` kịch bản phụ / `UC-VMI-02` kịch bản phụ; không có mã FR riêng trong 25 FR nhưng Task 7 hỗ trợ qua gọi lại TTS cho `questionId`).
   - **Phỏng vấn lại với cấu hình của phiên cũ** (`U005` bước 3 / `UC-VMI-05` bước 3; chưa có FR riêng, ghi nhận là câu hỏi mở cho Task 5).
   - **Kết thúc sớm khi chưa trả lời câu nào (0 câu):** `U004` kịch bản phụ / `UC-VMI-04` kịch bản phụ yêu cầu báo không đủ dữ liệu và không lưu đánh giá, trong khi `FR-VMI-16` chỉ nêu chung *"cho phép kết thúc bất kỳ lúc nào"*.
5. **Chế độ không CV (`FR-VMI-04` vs `U001`):**
   - `FR-VMI-04` viết *"khi tài khoản chưa có hồ sơ"*, còn `U001` và quyết định kỹ thuật hiện tại cho phép `cvId` luôn tùy chọn (kể cả khi đã có CV nhưng muốn luyện không đính kèm CV).
6. **Quy ước màu sắc báo cáo (`BR-VMI-05` vs `ui_context.md`):**
   - `Bai_lam_Voice_Mock_Interview.md` và `Requirements_Analysis.md` phân loại báo cáo theo **Đỏ / Vàng / Xanh**. Trong khi đó `documents/.agents/rules/ui_context.md` (trên nhánh `hoang/ui` chưa hợp nhất vào `main`) cấm dùng xanh/lam/tím cho UI và nêu status colors chưa được định nghĩa. Backend chỉ trả mã mức độ chuẩn (`RED`/`YELLOW`/`GREEN`) kèm nhãn chữ, để Frontend tự quyết định cách hiển thị.

