# Đọc dữ liệu Supabase từ web

## 1. Thông tin cần gửi cho frontend

Lấy hai giá trị trong Supabase Dashboard và cung cấp cho ứng dụng:

| Thông tin | Ví dụ |
|---|---|
| Project URL | `https://<project-ref>.supabase.co` |
| Publishable key | `sb_publishable_...` |

Cách lưu/đọc cấu hình tùy công nghệ ứng dụng; tên biến môi trường không bắt buộc theo mẫu nào.

Frontend chỉ cần URL + publishable key; không dùng password PostgreSQL hoặc secret/service-role key. Publishable key không tự cấp quyền đọc dữ liệu.

## 2. Cấu hình trên Supabase

- Bật RLS, cấp `SELECT` và có policy đọc phù hợp cho `job_sources`, `job_opportunities`.
- Với schema Job Tracking đã thống nhất: chưa đăng nhập không đọc được; người đăng nhập đọc các tin `eligible` thuộc nguồn theo dõi `active`, tin đã lưu hoặc từng nhận thông báo.
- Tin mới upload thường là `pending`, nên có thể chưa hiển thị. `partial`/`complete` là trạng thái crawler local, không phải trạng thái sàng lọc trên Supabase.
- Giữ policy hiện tại nếu dùng luồng đăng nhập. Muốn người chưa đăng nhập xem tin thì cần cấp quyền và thêm policy SELECT cho `anon` theo phạm vi muốn công khai.

Phần này mô tả cấu hình; tài liệu không tự thay đổi quyền trên database. [Quyền và RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

## 3. Ví dụ JavaScript với Supabase SDK

```bash
npm install @supabase/supabase-js
```

```js
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://<project-ref>.supabase.co',
  'sb_publishable_...'
)

// email/password do người dùng nhập; không ghi cứng trong frontend.
const { error: authError } = await supabase.auth.signInWithPassword({
  email,
  password
})
if (authError) throw authError

const { data: jobs, error } = await supabase
  .from('job_opportunities')
  .select('id, title, company_name, locations, original_url, deadline_at')
  .order('collected_at', { ascending: false })
  .limit(20)

if (error) throw error
console.log(jobs)
```

Đọc nhà tuyển dụng: đổi thành `.from('job_sources').select('id, name, source, url')`. SDK tự gửi phiên đăng nhập cho những lần truy vấn sau. [Supabase JavaScript](https://supabase.com/docs/reference/javascript/initializing)

## 4. Không thấy dữ liệu?

Contact Cao nhé=)))))

Hoặc nhớ check lại kết nối wifi <(")