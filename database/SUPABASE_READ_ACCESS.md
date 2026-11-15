# Đọc dữ liệu Job Tracking từ ứng dụng

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

### Nhà tuyển dụng TopCV

```js
const sources = await read(supabase
  .from('job_sources')
  .select('id, name, source, url')
  .ilike('source', 'topcv')
  .order('id')
  .range(0, 19))
```

### Danh sách tin kèm nhà tuyển dụng

```js
const jobs = await read(supabase
  .from('job_opportunities')
  .select(`id, title, company_name, locations, deadline_at, original_url,
           job_sources(id, name, source, url)`)
  .order('collected_at', { ascending: false })
  .order('id', { ascending: false })
  .range(0, 19))
```

### Tìm tin theo nguồn và tiêu đề

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

const endpoint = new URL('/rest/v1/job_opportunities', PROJECT_URL)
endpoint.search = new URLSearchParams({
  select: 'id,title,locations,original_url',
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
