---
name: speckit-constitution
description: Soạn hoặc cập nhật nguyên tắc làm việc bền vững của repo HireUS khi được yêu cầu; không tự thay nghiệp vụ hoặc phê chuẩn bản draft.
compatibility: Requires a local HireUS repository checkout; automated PowerShell helpers additionally require pwsh.
metadata:
  maintainer: HireUS Tools
  derived_from: github/spec-kit
---

# Quản lý nguyên tắc dự án

Đọc [AGENTS.md](../../../AGENTS.md) và
[hướng dẫn Spec Kit của repo](../../references/spec-kit.md) trước khi làm.
Dùng đường dẫn feature đã xác định; tên nhánh không quyết định thư mục.
Nội dung này có thể đọc trực tiếp bởi agent khác, không cần cú pháp lệnh riêng.

Đầu việc này chỉ sửa `.specify/memory/constitution.md` và phần dẫn chiếu được yêu cầu.
Đọc constitution hiện tại, `AGENTS.md` và quy tắc nguồn trước khi đề xuất thay đổi.

Giữ ở đây nguyên tắc bền vững: nguồn có căn cứ, scope, sở hữu contract,
bảo vệ dữ liệu, kiểm chứng và giải thích kỹ thuật.
Commands/setup ở `AGENTS.md`; nghiệp vụ/điểm số ở repo tài liệu; workflow ở skills.
Không lặp lại toàn bộ chúng trong constitution.

Phân biệt yêu cầu cập nhật nguyên tắc với yêu cầu triển khai tính năng.
Giữ version, lý do/ảnh hưởng lần sửa và ngày theo thông tin phiên thực tế.
Chỉ ghi ratification khi người dùng xác nhận phê chuẩn; bản draft vẫn là draft.
Không tự biến template hoặc câu chữ bắt buộc thành một quyết định mới của nhóm.

Báo phần nguyên tắc đổi và ảnh hưởng đến quy trình, cùng vấn đề chưa thống nhất.
Không thực hiện code, deployment, commit/push hoặc thay công cụ ngoài scope.
