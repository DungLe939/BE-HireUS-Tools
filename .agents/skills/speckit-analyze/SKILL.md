---
name: speckit-analyze
description: Rà soát nhất quán giữa spec, plan, tasks và nguồn yêu cầu HireUS; chỉ báo lỗi, khoảng trống và ảnh hưởng, không sửa artifacts.
compatibility: Requires a local HireUS repository checkout; automated PowerShell helpers additionally require pwsh.
metadata:
  maintainer: HireUS Tools
  derived_from: github/spec-kit
---

# Kiểm tra nhất quán feature

Đọc [AGENTS.md](../../../AGENTS.md) và
[hướng dẫn Spec Kit của repo](../../references/spec-kit.md) trước khi làm.
Dùng đường dẫn feature đã xác định; tên nhánh không quyết định thư mục.
Nội dung này có thể đọc trực tiếp bởi agent khác, không cần cú pháp lệnh riêng.

Đọc `spec.md`, `plan.md`, `tasks.md`, nguồn/revision và contract liên quan.
Đây là review chỉ đọc; không sửa hay check task.

Kiểm tra:
- Bản nguồn mới đã thay đổi phạm vi nhưng spec/task vẫn mang chức năng cũ.
- Tiêu chí nghiệm thu không có task thực hiện hoặc không có cách kiểm tra.
- Plan/consumer dùng contract khác nguồn backend; auth/quyền/dữ liệu bị suy diễn.
- Luồng lỗi làm mất CV, transcript hoặc kết quả; snapshot và thao tác cá nhân không rõ.
- Phụ thuộc không thể thực hiện theo thứ tự đã ghi; tasks trùng hoặc check thiếu bằng chứng.

Constitution là draft thì không tự nâng thành quyết định đã phê chuẩn.
Áp quy tắc đang có trong `AGENTS.md` và nguồn mới nhất; chỉ ra xung đột thay vì
coi mọi câu MUST trong template là lỗi nghiêm trọng.

Mỗi finding ghi mức độ, artifact/vị trí, căn cứ và tác động; phân biệt lỗi xác nhận,
câu hỏi và cải tiến tùy chọn. Báo cả phần chưa đọc được; không tự tạo issue hoặc fixes.
