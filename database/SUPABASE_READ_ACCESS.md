# Đọc dữ liệu Job Tracking từ ứng dụng

> Ví dụ theo [SQL khởi tạo](SUPABASE_CREATE.sql). Quyền đọc qua RLS bao gồm tin đang lưu và tin từng có thông báo. Xem [giới hạn của lịch sử phân phối](SUPABASE_DB_EXPLAINED.md#61-tạm-dừng-và-tiếp-tục-theo-dõi).

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

const { error } = await supabase.auth.signInWithPassword({ email, password })
if (error) throw error

async function read(query) {
  const { data, error } = await query
  if (error) throw error
  return data
}
```

## 3. Ví dụ truy vấn

### Tìm nhà tuyển dụng theo tên

`name` là tên nhà tuyển dụng/nhà đăng tin; `source` là nền tảng `facebook`, `linkedin` hoặc `TopCV`.

```js
const sources = await read(supabase
  .from('job_sources')
  .select('id, name, source, url')
  .ilike('name', '%FPT%')
  .order('id')
  .range(0, 19))
```

### Danh sách tin kèm nguồn

Áp dụng trên các tin tài khoản được phép đọc qua RLS. Không dùng kết quả này để khẳng định đã đáp ứng đầy đủ lịch sử khi nguồn `paused`.

```js
const jobs = await read(supabase
  .from('job_opportunities')
  .select(`id, title, locations, deadline_at, status, url,
           job_sources(id, name, source, url)`)
  .order('published_at', { ascending: false, nullsFirst: false })
  .order('id', { ascending: false })
  .range(0, 19))
```


Chọn `status` trong `select` để lấy trạng thái lúc đọc. Có thể thêm `.eq('status', 'active')` trước phân trang để chỉ lấy tin còn hạn.

### Tìm tin theo nguồn và tiêu đề


```js
const results = await read(supabase
  .from('job_opportunities')
  .select('id, title, locations, status, url')
  .eq('source_id', sourceId)
  .ilike('title', '%data%')
  .order('id')
  .limit(20))
```

### Chi tiết một tin


```js
const job = await read(supabase
  .from('job_opportunities')
  .select(`id, title, raw_content, requirements, locations,
           deadline_at, status, url,
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

const endpoint = new URL('/rest/v1/job_opportunities', PROJECT_URL)
endpoint.search = new URLSearchParams({
  select: 'id,title,locations,status,url',
  order: 'published_at.desc.nullslast,id.desc',
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
