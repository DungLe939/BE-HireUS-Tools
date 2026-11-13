---
name: speckit-taskstoissues
description: Chuyển tasks HireUS thành GitHub issues khi được yêu cầu rõ; giữ tương thích tên skill cũ đã deprecated, không tự thay Jira backlog.
compatibility: Requires a local HireUS repository checkout; automated PowerShell helpers additionally require pwsh.
metadata:
  maintainer: HireUS Tools
  derived_from: github/spec-kit
---

# Chuyển tasks sang GitHub issues

Đọc [AGENTS.md](../../../AGENTS.md) và
[hướng dẫn Spec Kit của repo](../../references/spec-kit.md) trước khi làm.
Dùng đường dẫn feature đã xác định; tên nhánh không quyết định thư mục.
Nội dung này có thể đọc trực tiếp bởi agent khác, không cần cú pháp lệnh riêng.

Tên skill này được giữ tương thích với bản Spec Kit cũ đã đánh dấu deprecated.
Không tự cài extension hoặc chuyển sang lệnh khác.
HireUS có thể quản lý backlog trên Jira; yêu cầu tạo tasks local không tự cho phép
tạo GitHub issues. Nếu đích được yêu cầu là Jira, dùng công cụ/quy trình Jira thực tế.

Khi người dùng yêu cầu GitHub issues:
1. Đọc tasks, feature path và nguồn. Xác minh repository từ Git remote và đích được giao.
2. Dùng connector, CLI hoặc API sẵn có; thiếu quyền/công cụ thì báo rõ,
   không khẳng định đã tạo issue.
3. Lấy issues mở/đóng bằng filter và pagination của công cụ thực tế.
   Dedupe theo repository + feature + task ID; `T001` ở feature khác không phải trùng.
4. Giữ ID đầy đủ với mẫu `\bT\d{3,}\b`, hỗ trợ số dài hơn ba chữ số.
   Ghi feature path và task ID trong nội dung issue để lần sau đối chiếu.
5. Chỉ tạo phần chưa có; không tự gán assignee, sprint hoặc deadline.
   Tôn trọng scope và kiểm tra response thật trước khi báo thành công.

Báo issue đã tạo, đã có và lỗi với đường dẫn xác thực. Không sửa code hoặc tự push.
