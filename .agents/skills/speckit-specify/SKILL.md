---
name: speckit-specify
description: Tạo hoặc cập nhật spec.md cho một tính năng HireUS từ yêu cầu mới nhất; không viết implementation trong bước đặc tả.
compatibility: Requires a local HireUS repository checkout; automated PowerShell helpers additionally require pwsh.
metadata:
  maintainer: HireUS Tools
  derived_from: github/spec-kit
---

# Đặc tả tính năng

Đọc [AGENTS.md](../../../AGENTS.md) và
[hướng dẫn Spec Kit của repo](../../references/spec-kit.md) trước khi làm.
Dùng đường dẫn feature đã xác định; tên nhánh không quyết định thư mục.
Nội dung này có thể đọc trực tiếp bởi agent khác, không cần cú pháp lệnh riêng.

1. Đọc nguồn liên quan qua `PROJECT_SOURCES.md`; chọn bản nội dung mới nhất.
   Ghi đường dẫn/revision và phân biệt yêu cầu, đề xuất kỹ thuật, điểm chưa rõ.
2. Với feature mới, chọn một thư mục dưới `specs/` theo quy ước repo.
   Với feature đã có, đọc spec và giữ quyết định còn phù hợp. Không tự tạo/chuyển nhánh.
3. Viết `spec.md`: mục tiêu, phạm vi, user stories, FR/BR/NFR liên quan,
   luồng chính/ngoại lệ và tiêu chí nghiệm thu quan sát được.
   Template `.specify/templates/spec-template.md` là khung tham khảo; bỏ placeholder.
4. Không tự chọn auth, quyền, Profile fields, công thức hoặc thông số hiệu năng.
   Hỏi phần thiếu ảnh hưởng kết quả; không hỏi lại dữ kiện đã có nguồn.
5. Giữ các trường hợp dữ liệu/AI lỗi, xác nhận người dùng và snapshot nếu thuộc luồng.
   Không khôi phục tính năng đã cắt trong bản mới vì prototype cũ vẫn còn.

Kiểm tra tiêu chí có thể nghiệm thu và không mâu thuẫn nguồn.
Báo feature directory, nguồn, phần còn cần làm rõ và bước kế tiếp.
Không viết code ứng dụng, contract nguồn hoặc tạo issue trong bước này.
