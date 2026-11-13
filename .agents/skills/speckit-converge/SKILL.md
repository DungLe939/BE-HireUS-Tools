---
name: speckit-converge
description: Đối chiếu code và bằng chứng kiểm tra với feature HireUS sau implementation, bổ sung task còn thiếu mà không viết lại spec hoặc tự mở rộng phạm vi.
compatibility: Requires a local HireUS repository checkout; automated PowerShell helpers additionally require pwsh.
metadata:
  maintainer: HireUS Tools
  derived_from: github/spec-kit
---

# Tìm phần chưa hoàn tất

Đọc [AGENTS.md](../../../AGENTS.md) và
[hướng dẫn Spec Kit của repo](../../references/spec-kit.md) trước khi làm.
Dùng đường dẫn feature đã xác định; tên nhánh không quyết định thư mục.
Nội dung này có thể đọc trực tiếp bởi agent khác, không cần cú pháp lệnh riêng.

Đọc spec/plan/tasks, nguồn mới nhất, code và tests hiện tại.
Nếu chưa có lần implementation cho feature, báo đây là đánh giá trước triển khai;
không giả rằng đã có kết quả thực nghiệm.

- So từng tiêu chí nghiệm thu với code/contract và kiểm tra thực tế.
- Task đã check không đủ chứng minh hành vi; đọc code hoặc dùng kết quả chạy có căn cứ.
- Không xem hạng mục ngoài scope là thiếu sót. Draft constitution không tự thêm
  yêu cầu sản phẩm hoặc quality gate.
- Phân biệt chưa viết code, đã có code nhưng sai hành vi, và chưa kiểm chứng.
- Kiểm tra task còn mở đã bao phủ gap chưa; không thêm task trùng mỗi lần chạy lại.

Chỉ append các gap chưa có vào một phần mới của `tasks.md`, dùng IDs sau ID lớn nhất,
kèm nguồn/tiêu chí và cách xác minh. Giữ nguyên tasks/checkmarks cũ.
Không sửa spec, plan, code hoặc contract trong bước này.
Nếu không có gap mới, để file nguyên vẹn và báo phạm vi đã kiểm tra.
