---
name: speckit-implement
description: Thực hiện các task của một feature HireUS đã xác định, cập nhật trạng thái có bằng chứng và kiểm tra code tại đúng repo.
compatibility: Requires a local HireUS repository checkout; automated PowerShell helpers additionally require pwsh.
metadata:
  maintainer: HireUS Tools
  derived_from: github/spec-kit
---

# Thực hiện feature

Đọc [AGENTS.md](../../../AGENTS.md) và
[hướng dẫn Spec Kit của repo](../../references/spec-kit.md) trước khi làm.
Dùng đường dẫn feature đã xác định; tên nhánh không quyết định thư mục.
Nội dung này có thể đọc trực tiếp bởi agent khác, không cần cú pháp lệnh riêng.

Đọc `spec.md`, `plan.md`, `tasks.md`, diff và source revision trước khi sửa.
Tác vụ chỉ định một phần thì chỉ làm phần đó; không tự chạy toàn backlog.

1. Chọn task sẵn sàng theo phụ thuộc. Đối chiếu yêu cầu mới nhất nếu artifacts cũ.
   Thiếu contract/quyết định chỉ chặn phần phụ thuộc; tiếp tục phần độc lập.
2. Dùng skill chuyên môn được `AGENTS.md` dẫn tới cho FE, BE, dữ liệu hoặc contract.
   Giữ code theo cấu trúc thực tế, không tự thêm dịch vụ từ ví dụ template.
3. Triển khai hành vi và lỗi có trong tiêu chí nghiệm thu. Không biến mock thành
   integration thật trong báo cáo; không bỏ kiểm tra quyền để luồng demo chạy được.
4. Chạy checks phù hợp. Nếu không chạy được, ghi nguyên nhân và không báo pass.
5. Chỉ check task đã hoàn tất đúng hành vi và kiểm tra cần thiết.
   Giữ task chưa đạt ở trạng thái chưa xong.

Reviewer-owned checklist đánh giá chất lượng yêu cầu khác với task implementation;
không tự đổi dấu của checklist để vượt một điều kiện chưa được giải quyết.
Không bắt dừng chỉ vì có một checkbox không liên quan; xử lý blocker theo tác động thật.
Báo code/contract/data thay đổi, task hoàn tất, checks và giới hạn.
Không tự commit/push, deploy hoặc tạo issue.
