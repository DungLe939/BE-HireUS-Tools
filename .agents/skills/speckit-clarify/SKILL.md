---
name: speckit-clarify
description: Làm rõ điểm thiếu hoặc mâu thuẫn trong spec HireUS hiện có và ghi lại câu trả lời; không tự mở rộng phạm vi tính năng.
compatibility: Requires a local HireUS repository checkout; automated PowerShell helpers additionally require pwsh.
metadata:
  maintainer: HireUS Tools
  derived_from: github/spec-kit
---

# Làm rõ đặc tả

Đọc [AGENTS.md](../../../AGENTS.md) và
[hướng dẫn Spec Kit của repo](../../references/spec-kit.md) trước khi làm.
Dùng đường dẫn feature đã xác định; tên nhánh không quyết định thư mục.
Nội dung này có thể đọc trực tiếp bởi agent khác, không cần cú pháp lệnh riêng.

Đọc `spec.md` hiện có và nguồn nghiệp vụ mới nhất. Không có spec thì xác định
cần tạo đặc tả hay người dùng chỉ đang hỏi; không tự dựng lại toàn bộ feature.

- Kiểm tra trước trong repo/tài liệu xem câu trả lời đã có chưa.
- Với mâu thuẫn giữa phiên bản, áp dụng quy tắc mới nhất và ghi nguồn lựa chọn.
- Chỉ hỏi điểm thật sự còn thiếu về hành vi, quyền, dữ liệu hoặc tiêu chí nghiệm thu.
  Gom các câu hỏi có liên quan; không hỏi một danh sách cố định chỉ để đủ quy trình.
- Nêu lựa chọn và tác động khi có nhiều phương án, phân biệt đề xuất với quyết định.
- Tiếp tục phần độc lập trong lúc chờ; chưa có trả lời không phải là đồng ý.

Khi có câu trả lời, cập nhật phần liên quan trong spec và ghi quyết định ngắn gọn.
Không đổi IDs hoặc sửa các artifacts khác nếu không cần cho yêu cầu.
Báo điểm đã rõ và phần còn phụ thuộc; không tự chạy plan/implement.
