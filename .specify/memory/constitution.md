# HireUS Backend Constitution

**Status: Draft / Unratified**

## Core principles

1. **Nguồn nghiệp vụ có căn cứ.** Dùng `PROJECT_SOURCES.md` để tìm nguồn chuẩn.
   Kế hoạch và prototype không chứng minh implementation hoặc phê duyệt.
2. **Phạm vi đủ rõ.** Triển khai theo yêu cầu và tiêu chí nghiệm thu của đầu việc.
   Spec Kit tùy chọn; ví dụ template không tự tạo yêu cầu hoặc quyết định auth.
3. **Hợp đồng có chủ sở hữu.** Backend sở hữu HTTP contract, FE tiêu thụ contract
   đã thống nhất. Tác vụ thiết kế contract được phép đề xuất giao diện; quyết định
   còn thiếu phải được giải quyết trước khi triển khai phần phụ thuộc.
4. **Bảo vệ dữ liệu.** Giữ secrets phía server, kiểm tra quyền tại backend,
   bảo toàn dữ liệu khi dịch vụ ngoài lỗi và kiểm tra tác động trước thay đổi phá hủy.
5. **Kiểm chứng phù hợp.** Dùng công cụ thực tế của repo; không coi mục tiêu
   coverage dự kiến là kết quả đo hoặc quality gate đã được nhóm chốt.
6. **Giải thích để cùng làm việc.** Báo hành vi, kiểm tra và giới hạn thực tế,
   giải thích các lựa chọn kỹ thuật quan trọng bằng tiếng Việt.

## Vai trò của tài liệu

- `AGENTS.md`: hiện trạng, quy tắc lập trình, lệnh kiểm tra và phạm vi sửa repo.
- `PROJECT_SOURCES.md`: đường dẫn và cách truy vết yêu cầu.
- `contracts/README.md`: sở hữu và phối hợp hợp đồng API.
- `.agents/skills/`: quy trình chuyên biệt, chỉ đọc khi cần.
- `.agents/references/spec-kit.md`: môi trường và cách dùng Spec Kit.

Không lặp lại các quy trình đó ở constitution. Khi được yêu cầu phối hợp nhiều
repo, đọc hướng dẫn từng repo và sửa đúng phần được giao; tác vụ một repo không
tự mở rộng sang repo khác. Commit/push theo quyền của yêu cầu hiện tại.

## Governance

Giữ trạng thái Draft / Unratified cho đến khi có xác nhận phê chuẩn riêng.
Lần sửa này rút gọn nội dung trùng, cập nhật cách tìm repo tài liệu và làm rõ
tác vụ xuyên repo; không xác nhận thay đổi nghiệp vụ hoặc phê chuẩn constitution.
Các lần sửa sau ghi lý do, ảnh hưởng và phiên bản phù hợp.

**Version**: 0.3.0 | **Ratified**: Not ratified | **Last Amended**: 2026-11-13
