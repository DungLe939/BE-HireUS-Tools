---
name: speckit-plan
description: Thiết kế plan.md cho tính năng HireUS đã có phạm vi rõ, phối hợp code hiện tại, dữ liệu và contract do backend sở hữu.
compatibility: Requires a local HireUS repository checkout; automated PowerShell helpers additionally require pwsh.
metadata:
  maintainer: HireUS Tools
  derived_from: github/spec-kit
---

# Lập kế hoạch triển khai

Đọc [AGENTS.md](../../../AGENTS.md) và
[hướng dẫn Spec Kit của repo](../../references/spec-kit.md) trước khi làm.
Dùng đường dẫn feature đã xác định; tên nhánh không quyết định thư mục.
Nội dung này có thể đọc trực tiếp bởi agent khác, không cần cú pháp lệnh riêng.

Đọc `spec.md`, code/manifests/tests hiện có và `PROJECT_SOURCES.md`.
Kế hoạch phải bám baseline của nhánh, không coi công nghệ dự kiến là đã cài.

- Xác định lát cắt thực hiện, boundaries, luồng dữ liệu và trạng thái lỗi.
- Nghiên cứu điểm chưa rõ bằng công cụ sẵn có; làm tuần tự được.
  Chỉ dùng subagent khi tác vụ cho phép và môi trường hỗ trợ.
- Ghi quyết định cần cho implementation trong `plan.md`, gồm file/module chính,
  integration, dữ liệu và cách kiểm tra tiêu chí nghiệm thu.
- Backend sở hữu contract nguồn trong `contracts/` tại gốc repo backend.
  FE dẫn tới contract/revision, không sinh contract cạnh tranh trong feature artifacts.
  Nếu đang thiết kế API, ghi đề xuất và các quyết định cần thống nhất.
- Chỉ tạo `research.md`, `data-model.md`, `quickstart.md` khi có nội dung cần lưu
  để triển khai/kiểm tra; không tạo file rỗng cho đủ template.

Dùng `.specify/templates/plan-template.md` như khung, không lấy ví dụ làm yêu cầu.
Không ghi pipeline AI, auth, migration hoặc UI chưa được quyết định như việc đã làm.
Báo kế hoạch, dependencies và phần còn chưa thể triển khai; không viết code ứng dụng.
