---
name: rest-api-contract
description: Thiết kế, cập nhật hoặc review hợp đồng HTTP do backend HireUS sở hữu; dùng khi FE và BE cần thống nhất giao diện.
---

# Thiết kế và review API contract

Đọc [PROJECT_SOURCES.md](../../../PROJECT_SOURCES.md),
[contracts/README.md](../../../contracts/README.md), yêu cầu mới nhất và callers hiện có.
Nếu tác vụ là review, chỉ báo findings; nếu là thiết kế, được phép đề xuất giao diện
từ nghiệp vụ rõ, không đợi một contract có sẵn cho chính operation đang thiết kế.

Mỗi operation cần đủ thông tin cho consumer và kiểm thử:
- Method/path, input và ràng buộc validation.
- Output, status/error và trạng thái xử lý nếu operation bất đồng bộ.
- Quyền truy cập theo tài khoản; cách truyền auth/session theo quyết định có căn cứ.
- Semantics của lưu/bỏ lưu/xóa, snapshot, retry và tác động tạo trùng nếu liên quan.
- Filtering/pagination chỉ khi luồng có nhu cầu; không thêm cho đủ checklist.

Phần chưa rõ về nghiệp vụ, auth hoặc dữ liệu cần ghi câu hỏi cụ thể.
Đề xuất kỹ thuật phải phân biệt với quyết định đã thống nhất; chỉ triển khai
phần phụ thuộc khi các quyết định cần thiết đã rõ.

Lưu contract nguồn trong `contracts/` của backend và ghi phiên bản/revision.
OpenAPI là lựa chọn phù hợp nếu được chọn, không tự cài Swagger.
Artifacts của feature và FE dẫn tới contract nguồn, không duy trì bản sao khác.
Đánh giá breaking changes, consumers và test chịu ảnh hưởng khi đổi interface.
Báo operation đã chốt/đề xuất, nguồn nghiệp vụ và điểm cần phối hợp FE.
