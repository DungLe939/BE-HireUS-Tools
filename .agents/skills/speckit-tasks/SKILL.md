---
name: speckit-tasks
description: Chia spec và plan HireUS thành tasks.md theo lát cắt chạy được, có phụ thuộc và cách kiểm tra; không tự tạo Jira hoặc GitHub issues.
compatibility: Requires a local HireUS repository checkout; automated PowerShell helpers additionally require pwsh.
metadata:
  maintainer: HireUS Tools
  derived_from: github/spec-kit
---

# Chia công việc

Đọc [AGENTS.md](../../../AGENTS.md) và
[hướng dẫn Spec Kit của repo](../../references/spec-kit.md) trước khi làm.
Dùng đường dẫn feature đã xác định; tên nhánh không quyết định thư mục.
Nội dung này có thể đọc trực tiếp bởi agent khác, không cần cú pháp lệnh riêng.

Đọc `spec.md`, `plan.md` và artifacts thực sự liên quan.
Nếu thiếu quyết định cần thiết, liệt kê phần phụ thuộc; không tự điền nghiệp vụ.

Viết `tasks.md` với các mục `- [ ] T001 ...`:
- Mỗi task có hành vi/file/module đủ cụ thể, liên hệ tiêu chí nghiệm thu.
- Sắp xếp foundation, contract và phụ thuộc dữ liệu trước consumer.
- Chia theo lát cắt có thể chạy/kiểm tra, không chia chỉ theo số lượng file.
- Đánh dấu song song khi không cùng sửa file hoặc phụ thuộc trạng thái của nhau.
- Đưa tests quan trọng vào cùng phần hành vi cần bảo vệ; không tự thêm framework,
  coverage gate, deployment hoặc hardening ngoài phạm vi.
- Tách việc cần quyết định khỏi việc đã sẵn sàng làm. Không tự gán người/deadline.

Dùng task IDs duy nhất; giữ IDs khi chỉnh danh sách đã được nhóm dùng.
Task đã check cần bằng chứng thực hiện, không check chỉ vì đã viết mô tả.
Báo thứ tự, blocker và cách kiểm tra; chỉ tạo issue ngoài repo khi được yêu cầu riêng.
