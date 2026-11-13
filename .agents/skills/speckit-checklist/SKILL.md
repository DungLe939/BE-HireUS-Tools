---
name: speckit-checklist
description: Tạo checklist rà soát chất lượng yêu cầu và thiết kế cho feature HireUS; không dùng checkbox để thay test hay trạng thái implementation.
compatibility: Requires a local HireUS repository checkout; automated PowerShell helpers additionally require pwsh.
metadata:
  maintainer: HireUS Tools
  derived_from: github/spec-kit
---

# Checklist chất lượng yêu cầu

Đọc [AGENTS.md](../../../AGENTS.md) và
[hướng dẫn Spec Kit của repo](../../references/spec-kit.md) trước khi làm.
Dùng đường dẫn feature đã xác định; tên nhánh không quyết định thư mục.
Nội dung này có thể đọc trực tiếp bởi agent khác, không cần cú pháp lệnh riêng.

Xác định mục tiêu review: phạm vi, quyền, dữ liệu, contract, AI, UI hoặc lỗi.
Đọc spec/plan và nguồn tương ứng; không tạo checklist chung dài cho mọi feature.

Tạo `checklists/<chu-de>.md` với các mục kiểm tra có căn cứ và đủ rõ:
- Yêu cầu có thể hiểu và kiểm chứng; ranh giới giữa phân hệ không bị lẫn.
- Điểm chưa quyết định, điều kiện lỗi và quyền dữ liệu liên quan đã được chỉ rõ.
- Contract/nguồn có chủ sở hữu, revision và cách giải quyết xung đột.
- Chỉ giữ mục có ảnh hưởng tới đầu việc, không thêm tiêu chuẩn chưa được nhóm chọn.

Mỗi mục có ID ổn định như `CHK001` và dẫn tới phần nguồn/spec cần đối chiếu.
Dùng template checklist làm khung nếu phù hợp.
Đánh dấu `[x]` nghĩa reviewer đã xác minh chất lượng yêu cầu đó, không có nghĩa
code/test đã hoàn thành. Không tự check mọi mục ngay khi vừa sinh checklist.
Giữ dấu và ghi chú review cũ khi chỉnh danh sách.
Báo đường dẫn, phạm vi checklist và câu hỏi còn thiếu; không sửa code.
