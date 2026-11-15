# Đọc dữ liệu Job Tracking từ ứng dụng

> Ví dụ theo mô hình tài liệu, chưa xác minh Supabase thực tế. Phần loại tin ẩn bên dưới chưa thay thế cơ chế lưu lịch sử phân phối khi tạm dừng nguồn; xem [kiểm tra mong đợi](SUPABASE_DB_EXPLAINED.md#61-tạm-dừng-và-tiếp-tục-theo-dõi).

## 1. Cần gì?

| Thông tin | Ví dụ |
|---|---|
| Project URL | `https://<project-ref>.supabase.co` |
| Publishable key | `sb_publishable_...` |
| Tài khoản Supabase Auth | Email/password của người dùng, nếu policy yêu cầu đăng nhập |

Ứng dụng dùng Project URL + Publishable key và đăng nhập bằng Supabase Auth. Các truy vấn chỉ trả về dữ liệu mà policy RLS của project cho phép. Không dùng secret/service-role key trên frontend.

## 2. Khởi tạo và đăng nhập

```bash
npm install @supabase/supabase-js
```

```js
import { createClient } from '@supabase/supabase-js'

const PROJECT_URL = 'https://<project-ref>.supabase.co'
const PUBLISHABLE_KEY = 'sb_publishable_...'
const supabase = createClient(PROJECT_URL, PUBLISHABLE_KEY)

const { data: auth, error } = await supabase.auth.signInWithPassword({ email, password })
if (error) throw error
const userId = auth.user.id

async function read(query) {
  const { data, error } = await query
  if (error) throw error
  return data
}
```

## 3. Ví dụ truy vấn

### Tìm nhà tuyển dụng theo tên

`name` là tên nhà tuyển dụng/nhà đăng tin; `source` là nền tảng `facebook` hoặc `linkedin` theo mô hình hiện tại. Ví dụ không mở rộng CHECK sang TopCV.

```js
const sources = await read(supabase
  .from('job_sources')
  .select('id, name, source, url')
  .ilike('name', '%FPT%')
  .order('id')
  .range(0, 19))
```

### Danh sách tin kèm nguồn, loại tin đã ẩn

Áp dụng trên các tin tài khoản được phép đọc qua RLS. Không dùng kết quả này để khẳng định đã đáp ứng đầy đủ lịch sử khi nguồn `paused`.

```js
const jobs = await read(supabase
  .from('job_opportunities')
  .select(`id, title, company_name, locations, deadline_at, original_url,
           job_sources(id, name, source, url),
           hidden:users_saved_posts()`)
  .eq('hidden.user_id', userId)
  .not('hidden.hidden_at', 'is', null)
  .is('hidden', null)
  .order('collected_at', { ascending: false })
  .order('id', { ascending: false })
  .range(0, 19))
```

Anti-join loại tin có dòng ẩn của đúng tài khoản tại database, trước `range`; không lọc mảng sau khi lấy trang. Cần SELECT/RLS cho `users_saved_posts` để tài khoản đọc được dòng của mình. [PostgREST: anti-join](https://docs.postgrest.org/en/stable/references/api/resource_embedding.html#null-filtering-on-embedded-resources)

### Tìm tin theo nguồn và tiêu đề

Truy vấn dữ liệu thô phục vụ tra cứu; nếu dùng cho danh sách cá nhân, thêm cùng bộ lọc `hidden` trước `limit` như trên.

```js
const results = await read(supabase
  .from('job_opportunities')
  .select('id, title, locations, original_url')
  .eq('source_id', sourceId)
  .ilike('title', '%data%')
  .order('id')
  .limit(20))
```

### Chi tiết một tin

Không áp bộ lọc `hidden` cho mọi truy vấn chi tiết; quyền xem chi tiết/lịch sử thông báo do policy tương ứng quyết định.

```js
const job = await read(supabase
  .from('job_opportunities')
  .select(`id, title, raw_content, requirements, positions, levels, locations,
           extraction_evidence, deadline_at, closed_at, original_url,
           job_sources(id, name, url)`)
  .eq('id', jobId)
  .maybeSingle())
```

## 4. Gọi REST API bằng HTTP/fetch

```js
const { data: { session }, error: sessionError } = await supabase.auth.getSession()
if (sessionError) throw sessionError
if (!session) throw new Error('Chưa đăng nhập')
const accessToken = session.access_token
const currentUserId = session.user.id

const endpoint = new URL('/rest/v1/job_opportunities', PROJECT_URL)
endpoint.search = new URLSearchParams({
  select: 'id,title,locations,original_url,hidden:users_saved_posts()',
  'hidden.user_id': `eq.${currentUserId}`,
  'hidden.hidden_at': 'not.is.null',
  hidden: 'is.null',
  order: 'collected_at.desc,id.desc',
  limit: '20',
  offset: '0'
})

const response = await fetch(endpoint, {
  headers: {
    apikey: PUBLISHABLE_KEY,
    Authorization: `Bearer ${accessToken}`
  }
})
const result = await response.json()
if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`)
```
