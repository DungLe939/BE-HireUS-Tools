---
name: prisma-data
description: Thiết kế hoặc sửa schema, query, migration và quyền dữ liệu cho HireUS khi đầu việc có persistence; không tự cài Prisma.
---

# Làm việc với dữ liệu

Đọc [AGENTS.md](../../../AGENTS.md), [PROJECT_SOURCES.md](../../../PROJECT_SOURCES.md)
và schema/migrations/query thực tế trên nhánh. Nếu chưa có Prisma/database,
phân biệt tác vụ thiết kế với cài đặt; chỉ thêm dependency và kết nối trong phạm vi được giao.

Xác định entities và semantics từ luồng đang làm:
- Chủ sở hữu CV/thành tựu/lịch sử, quan hệ theo dõi nguồn và dữ liệu bài dùng chung.
- CV/JD/cấu hình/transcript được chụp lại ở thời điểm nào; lịch sử không phụ thuộc
  vào việc tài nguyên gốc bị sửa.
- Phân biệt xóa quan hệ cá nhân, bỏ đánh dấu lưu và xóa dữ liệu dùng chung.
- Constraints, indexes, transactions và uniqueness phục vụ hành vi cụ thể,
  đặc biệt khi có request lặp hoặc tác vụ định kỳ.

Không suy ra schema từ tên màn hình hay tự chọn các trường Profile còn chưa thống nhất.
Validate input và kiểm tra quyền trong query/boundary phù hợp; không trả entity
với fields ngoài contract.

Trước migration, xem SQL và tác động trên dữ liệu/môi trường đích.
Không reset, destructive push hoặc seed dữ liệu quan trọng nếu chưa có quyền rõ.
Kiểm tra constraints, quyền tài khoản và snapshot/retry bằng tests phù hợp;
không dùng database thật của nhóm cho một test phá hủy.
Báo schema/migration đã tạo, thao tác thực sự chạy và phần chỉ mới thiết kế.
