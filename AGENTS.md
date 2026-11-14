# HireUS Backend — hướng dẫn lập trình

## Hiện trạng và nguồn

Đọc [PROJECT_SOURCES.md](PROJECT_SOURCES.md) để tìm yêu cầu tại `../documents/`.
Kiểm tra manifest, code và test trên nhánh đang làm trước khi dựa vào baseline.
Baseline là NestJS, TypeScript, npm, CommonJS và Jest, với code trong `src/`.
Khung ban đầu chưa cấu hình PostgreSQL/Prisma, auth hay dịch vụ AI.

## NestJS, dữ liệu và API

- Controller xử lý biên HTTP; service/provider xử lý nghiệp vụ; module tổ chức tính năng.
  Dùng DTO và cơ chế validation thực sự được cấu hình.
- Backend sở hữu contract tại `contracts/`; xem
  [contracts/README.md](contracts/README.md). Khi được giao thiết kế API, đề xuất
  method/path/schema từ yêu cầu đủ rõ; ghi rõ quyết định còn thiếu trước khi FE phụ thuộc.
  Không tự quyết auth, quyền dữ liệu hoặc ý nghĩa nghiệp vụ.
- Khi đổi contract hiện có, đánh giá tương thích và ảnh hưởng FE.
  Không trả persistence entity nếu nó làm lộ dữ liệu ngoài contract.
- Kiểm tra schema/migration và môi trường thực tế trước khi đổi database.
  Không chạy reset, xóa dữ liệu hoặc migration phá hủy khi chưa được cho phép.
- Giữ credentials và dịch vụ AI ở server; kiểm tra input, quyền truy cập,
  phản hồi provider, timeout và lỗi theo phạm vi tính năng. Không log secrets
  hoặc dữ liệu cá nhân nhạy cảm.

## Skills và quy trình

Các `SKILL.md` là hướng dẫn dùng chung cho nhiều agent. Nếu công cụ không tự nạp,
đọc file trực tiếp và dùng khả năng tương đương sẵn có; không giả định cú pháp gọi
skill hoặc tên tool giống nhau giữa các agent.

Chỉ đọc skill cần cho đầu việc:

| Công việc | Skill |
| --- | --- |
| Module/tính năng NestJS | [nestjs-feature](.agents/skills/nestjs-feature/SKILL.md) |
| Thiết kế hoặc review HTTP contract | [rest-api-contract](.agents/skills/rest-api-contract/SKILL.md) |
| Prisma, schema, query, migration | [prisma-data](.agents/skills/prisma-data/SKILL.md) |
| Review kỹ thuật | [backend-quality](.agents/skills/backend-quality/SKILL.md) |

Sửa nhỏ làm trực tiếp từ yêu cầu đủ rõ. Spec Kit tùy chọn cho tính năng lớn:
đọc [.agents/references/spec-kit.md](.agents/references/spec-kit.md) trước khi gọi
`speckit-*`. Ví dụ trong template không phải quyết định dự án và không cho phép
tự chọn auth, quyền hoặc mục tiêu hiệu năng.

Reviewer tại `.codex/agents/` là adapter riêng cho Codex. Với agent khác, dùng
`backend-quality` và `rest-api-contract` trực tiếp cho phần review liên quan.
Chỉ giao reviewer riêng khi tác vụ cho phép và công cụ hỗ trợ; không cần nhiều agent.

## Kiểm tra và bàn giao

Khi bắt đầu việc có sửa code/tài liệu chung, tự fetch `origin/main` và tích hợp vào
nhánh hiện tại một lần cho đầu việc, không chờ người dùng nhắc pull. Chỉ dẫn đích khác
được ưu tiên; upstream cá nhân không thay nhánh nền main. Trong workspace dùng
`python3 ../.agents/scripts/sync_main.py --repo .` từ repo này.
Clone độc lập: fetch main, kiểm tra tree; nếu main đã nằm trong HEAD thì tiếp tục,
nếu tree sạch thì fast-forward hoặc merge bảo toàn lịch sử với
`--no-autostash --no-overwrite-ignore`, không tự đổi nhánh hay checkout submodule.
Được tạo merge commit tích hợp main; không commit công việc chưa lưu hoặc push.
Tree bẩn cần tích hợp thì giữ nguyên file/index; conflict ở lượt merge vừa bắt đầu
từ tree sạch thì abort lượt đó và báo, không abort thao tác Git có sẵn của người dùng.
Không stash/reset/rebase/force-push hoặc bỏ hook. Mạng lỗi thì báo chưa xác minh main.
Chỉ đọc/review/plan riêng hoặc chỉ dẫn offline/không sync thì không tự tích hợp.

Trước bàn giao/push, xem cả commit chưa push, diff và file mới liên quan; đối chiếu
README/cách chạy, config mẫu, contract, spec/tasks và tài liệu yêu cầu. Cập nhật
tài liệu kỹ thuật/tổng hợp bị tác động, sửa/gộp/bỏ bản dẫn xuất lỗi thời có căn cứ;
không đổi nghiệp vụ chỉ để khớp code lỗi. Đọc hướng dẫn documents trước khi sửa.
Nếu mở workspace, đọc `../.agents/skills/team-sync/SKILL.md` và skill
`docs-maintenance` trong repo tài liệu; clone riêng vẫn áp dụng các bước trên.
Thiếu checkout tài liệu thì nêu phần chưa đối chiếu, hỏi đường dẫn nếu cần và
tiếp tục phần độc lập; không báo đã sync mọi tài liệu.

Với thay đổi hành vi, thêm hoặc cập nhật Jest test cho trường hợp quan trọng.
Chạy từ repo này:

```bash
npm test -- --runInBand
npm run build
```

Chạy `npm run test:e2e -- --runInBand` khi đổi luồng HTTP cần kiểm tra tích hợp.
Mục tiêu coverage trong Proposal là kế hoạch; không tự đặt quality gate mới.

Phần cập nhật tài liệu liên quan trước bàn giao/push thuộc quy trình nhóm ở trên;
sửa repo khác ngoài phần đó cần yêu cầu phối hợp. Đọc hướng dẫn repo kia trước khi sửa.
Giữ nhánh đang làm và thay đổi local. Skills/hướng dẫn được chia sẻ qua Git,
không thêm vào ignore. Chỉ commit công việc/push khi được yêu cầu; merge commit tích hợp
main ở đầu việc là ngoại lệ được nhóm cho phép ở trên.
Báo đã làm gì, kiểm tra thực sự chạy, tài liệu sửa/giữ/xóa và lý do, phần còn thiếu;
giải thích luồng đáng chú ý bằng tiếng Việt. Push bị remote đi trước thì fetch,
tích hợp cùng đích đã xác minh, rà lại tài liệu và kiểm tra phần bị tác động.
Sau push, xác nhận commit/nhánh đích; không coi push BE là đã công bố documents hoặc repo cha.
