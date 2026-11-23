# Dịch vụ VieNeu thử nghiệm cho VMI

Dịch vụ thử thay Zonos trong môi trường VMI đã cấu hình. Alba đọc phiên Anh và
Nhật Phong đọc phiên Việt. Hai giọng được nạp vào RAM từ mẫu tham chiếu do người
vận hành cung cấp. API vẫn trả WAV PCM16 mono 44,1 kHz có kích thước hữu hạn.

Dùng VieNeu Turbo FP32 với checkout và lockfile theo
[hướng dẫn benchmark](../../scripts/bench/README.md). Cần `ffmpeg` và môi trường
VieNeu có FastAPI, uvicorn và soxr theo lockfile. Biến `VIENEU_REF_ALBA` và
`VIENEU_REF_NHAT_PHONG` trỏ tới hai WAV tham chiếu cục bộ. Không đặt WAV hay nội
dung phỏng vấn trong Git.

```bash
# Chạy tại backend/services/tts-vieneu với Python của venv VieNeu.
python -B -m uvicorn main:app --host 127.0.0.1 --port 1920 --no-access-log
```

Đặt `VMI_TTS_ENGINE=vieneu` trong môi trường chạy Nest để dùng thử. Khi biến này
chưa đặt, Nest dùng Zonos như trước. Dịch vụ VieNeu không có xác thực HTTP riêng
và chỉ dùng sau backend trong mạng nội bộ hoặc trên loopback.
