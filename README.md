# HireUS Backend

Backend nền tảng của HireUS Tools, khởi tạo bằng NestJS 12 với TypeScript, CommonJS và Jest.

## Chạy ứng dụng

```bash
npm install
npm run start:dev
```

Ứng dụng chạy tại `http://localhost:3000`. Route mặc định `GET /` trả về `Hello World!`.

## Kiểm tra

```bash
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

## Cấu trúc chính

- `src/main.ts`: bootstrap ứng dụng NestJS.
- `src/app.module.ts`: root module.
- `src/app.controller.ts`: controller mặc định cho `GET /`.
- `src/app.service.ts`: service mặc định trả lời controller.
- `test/`: cấu hình và test end-to-end mặc định.
