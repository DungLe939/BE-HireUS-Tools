# Workflow Spec Kit của HireUS

## Dùng chung với các agent

Các skills `speckit-*` đã được viết lại cho quy trình HireUS.
Agent có thể dùng cơ chế skill của công cụ hoặc đọc trực tiếp `SKILL.md`.
Các tên command và biến đối số chỉ là cách giao tiếp của integration;
không coi `$speckit-...` hoặc `$ARGUMENTS` là lệnh shell.

Đọc [AGENTS.md](../../AGENTS.md) và
[PROJECT_SOURCES.md](../../PROJECT_SOURCES.md) để chọn bản yêu cầu mới nhất.
Sửa nhỏ không cần full cycle. Không tự tạo thêm approval gate, dependency,
subagent hoặc artifact chỉ vì template có ví dụ.

## Xác định feature

1. Dùng thư mục feature người dùng chỉ định; khi tiếp tục, đọc artifacts đã có.
2. Có thể đọc `SPECIFY_FEATURE_DIRECTORY` hoặc `.specify/feature.json` nếu tồn tại.
   Kiểm tra đường dẫn thuộc repo và đúng đầu việc, không dùng cache cũ một cách mù quáng.
3. Chưa xác định được thì tìm dưới `specs/`. Nhiều feature phù hợp thì hỏi feature
   đang làm, không tự chọn theo tên nhánh.
4. Chỉ bước specify tạo feature mới: dùng thư mục chưa tồn tại dưới `specs/`,
   theo cách đánh số của repo. Không đổi nhánh thành viên hoặc ghi đè spec cũ.

Thư mục và Git branch độc lập. Giữ nhánh `<thành-viên>/<epic>` hiện có.

## Các bước và phạm vi file

| Skill | Đầu ra/phạm vi |
| --- | --- |
| specify | spec.md của một feature |
| clarify | Cập nhật quyết định còn thiếu trong spec |
| plan | plan.md; research/data-model/quickstart nếu cần |
| tasks | tasks.md có phụ thuộc và cách kiểm tra |
| implement | Code/contract/data trong scope, tests và dấu task có bằng chứng |
| analyze | Review chỉ đọc về tính nhất quán |
| checklist | Checklist chất lượng yêu cầu, khác trạng thái implementation |
| converge | Append gap chưa có vào tasks, không sửa code/spec/plan |
| constitution | Nguyên tắc làm việc khi được yêu cầu, giữ draft nếu chưa phê chuẩn |
| taskstoissues | Tạo GitHub issues chỉ khi được yêu cầu; tên cũ được giữ tương thích |

Các template trong `.specify/templates/` là khung tham khảo.
Chỉ giữ phần có ý nghĩa cho đầu việc; bỏ placeholder và thay các giá trị ví dụ.
Bản nghiệp vụ mới nhất ưu tiên hơn spec cũ; ghi nguồn khi điều chỉnh artifacts.
Constitution draft không tự tạo yêu cầu sản phẩm hoặc phê chuẩn quyết định mới.

Contract HTTP nguồn nằm tại `contracts/` ở gốc backend.
FE và artifacts feature dẫn tới nó kèm revision; không sinh contract nguồn thứ hai.

## Công cụ và runtime tùy chọn

Có thể soạn/đọc artifacts trực tiếp bằng file tools; không cần PowerShell để làm
quy trình thủ công. Báo đúng những bước thực sự làm, không giả đã chạy runner tự động.

Scripts hiện có ở `.specify/scripts/powershell/` dùng `pwsh`.
Chỉ dùng helper khi môi trường có PowerShell 7; ví dụ kiểm tra prerequisite sau
khi đã xác định feature và có tasks, chạy từ PowerShell:

```powershell
$env:SPECIFY_FEATURE_DIRECTORY = 'specs/001-example'
pwsh -NoProfile -File .specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks
```

Helper có thể ghi cache feature local. Không chạy chỉ để đọc tổng quan.
Thiếu `pwsh` thì dùng file workflow nếu phù hợp, không tự cài phần mềm.
CLI `specify` chỉ cần cho các thao tác quản lý Spec Kit thực sự được yêu cầu.
Integration tự động hiện ghi Codex; không coi agent khác đã được cài native adapter.

Nếu có `.specify/extensions.yml`, kiểm tra hooks liên quan trước/sau bước đang làm.
Chạy bằng công cụ/runner thực tế trong phạm vi được cho phép. Hook bắt buộc không
thực hiện được thì báo giới hạn và dừng bước phụ thuộc; không chỉ in marker để báo chạy.
Không tự cài extension hoặc suy ra quyền push/tạo issue/deploy từ một hook.

## Duy trì bộ skills

Nhóm duy trì nội dung `speckit-*/SKILL.md`; manifests cài đặt ghi lịch sử upstream,
không chứng minh file local còn nguyên. Khi nâng cấp/re-init, đối chiếu và giữ các
điều chỉnh HireUS thay vì tự ghi đè. Hai repo giữ cùng workflow để vẫn dùng độc lập.
