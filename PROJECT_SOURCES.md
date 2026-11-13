# Nguồn yêu cầu HireUS Tools

## Tìm checkout tài liệu

Trong workspace HireUS-Tools, repo tài liệu là `../documents/` tính từ repo này.
Tên GitHub là Docs-HireUS-Tools; một số bản cũ gọi là CNPM-Docs.
Nếu mở repo độc lập, dùng checkout tài liệu được cung cấp thay vì yêu cầu đổi tên.
Không có nguồn thì hỏi đường dẫn và tiếp tục phần kỹ thuật độc lập.

## Nội dung và phiên bản

Đọc [quy tắc nguồn](../documents/.agents/rules/source-of-truth.md).
Theo chỉ dẫn của nhóm, khi cùng nội dung có mâu thuẫn, dùng **phiên bản nội dung
mới nhất**; xét revision/lịch sử thay đổi, không dùng ngày copy file.

| Cần xác định | Đọc |
| --- | --- |
| Hành vi hiện tại của 4 phân hệ | [Requirements Analysis](../documents/docs/Week02/Submission/Requirements_Analysis.md) và [HTML](../documents/docs/Week02/Submission/Requirements_Analysis.html) |
| Bối cảnh, nhân sự/kế hoạch ban đầu | [Proposal](../documents/docs/Week01/Submission/Project_Proposal.md), trong phạm vi chưa bị bản mới thay |
| Bài nguồn/ghi chú tổng hợp | [README Week02](../documents/docs/Week02/Submission/README.md), đối chiếu bản nộp mới hơn |
| Bài nộp | Template và thông báo của đợt tương ứng trong repo tài liệu |

Spec/plan/tasks ở repo này chỉ ghi phần triển khai và dẫn nguồn. Không tự chọn auth,
quyền truy cập, Profile schema hoặc công thức chưa được quyết định.
Nếu bản mới tự mâu thuẫn hoặc chưa xác định được thứ tự, hỏi phần cần quyết định
và tiếp tục việc độc lập. Kế hoạch/prototype không chứng minh implementation.

## Truy vết và chủ sở hữu

Ghi commit/revision và các đường dẫn nguồn dùng cho tính năng.
Nguồn có sửa local thì ghi rõ file và diff/hash liên quan.
Backend sở hữu HTTP contract; xem [contracts/README.md](contracts/README.md).
FE tích hợp ghi phiên bản contract và dẫn về nguồn đó.

Chỉ sửa tài liệu hoặc repo khác khi tác vụ gồm phần phối hợp đó; đọc hướng dẫn repo
kia trước. Quy trình bàn giao/push của nhóm gồm đối chiếu và sửa tài liệu kỹ thuật,
tổng hợp liên quan đến thay đổi; yêu cầu nghiệp vụ vẫn chỉ đổi theo quyết định mới
có nguồn. Dùng skill `docs-maintenance` trong checkout tài liệu để sửa/gộp/bỏ bản
dẫn xuất lỗi thời và cập nhật callers. Không tự sync Git/Drive chỉ vì đang đọc nguồn.
