---
name: backend-quality
description: Review backend HireUS về lỗi nghiệp vụ, quyền, dữ liệu, API và tích hợp AI; mặc định chỉ đọc và báo findings có căn cứ.
---

# Review backend

Đọc [AGENTS.md](../../../AGENTS.md), diff/callers/tests trực tiếp bị ảnh hưởng.
Đối chiếu hành vi với bản nguồn mới nhất qua
[PROJECT_SOURCES.md](../../../PROJECT_SOURCES.md) và contract backend.
Không báo một mục trong kế hoạch chưa triển khai là bug nếu ngoài phạm vi review.

Ưu tiên kiểm tra:
- Sai công thức/biên điểm, đánh giá trước xác nhận hoặc dùng dữ liệu đầu vào đã cũ.
- Quyền sở hữu bị bỏ qua khi thay ID; xóa dữ liệu của người khác; lộ secrets/PII.
- Lịch sử đổi theo CV gốc, mất transcript/kết quả khi provider hoặc bước gợi ý lỗi.
- Retry tạo trùng, xử lý đồng thời sai, transaction/constraint thiếu cho hành vi cụ thể.
- Tin hết hạn/không rõ hạn bị trình bày sai, nguồn lỗi bị coi là đã xóa.
- Provider response sai kiểu hoặc chứa chỉ dẫn được tin cậy như cấu hình.
- Contract không khớp HTTP thực tế và thiếu tests ở nhánh có rủi ro.

Báo findings theo mức độ với file/dòng, trigger, tác động, căn cứ và hướng sửa.
Tách thiếu thông tin khỏi lỗi xác nhận. Không sửa code/tests/contract trong review
trừ khi người dùng cũng yêu cầu fixes; không tự commit/push.
Agent hiện tại tự review được, không cần hệ thống subagent.
