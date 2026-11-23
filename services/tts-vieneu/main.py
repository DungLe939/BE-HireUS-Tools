"""Dịch vụ thử nghiệm VieNeu giữ nguyên định dạng phát câu hỏi của VMI."""
import io
import os
import threading
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import numpy as np
import soxr
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

WAV_HZ = 44100


class SpeechRequest(BaseModel):
    """Chỉ nhận văn bản và hai giọng được chọn trong VMI."""

    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    input: str = Field(min_length=1, max_length=4000)
    voice: Literal['alba', 'nhat-phong']
    response_format: Literal['wav'] = 'wav'


def load_vieneu():
    """Nạp một model và ghi nhận hai mẫu giọng trong bộ nhớ khi khởi động."""
    from vieneu import Vieneu

    refs = {'alba': os.environ.get('VIENEU_REF_ALBA', ''),
            'nhat-phong': os.environ.get('VIENEU_REF_NHAT_PHONG', '')}
    if any(not ref or not Path(ref).is_file() for ref in refs.values()):
        raise RuntimeError('Cần hai tệp tham chiếu cấu hình cho Alba và Nhật Phong.')
    # Dùng cấu hình FP32 đã tạo các mẫu mà người dùng nghe thử.
    tts = Vieneu(mode='v3turbo', backend='onnx', device='cpu', precision='fp32', threads=4)
    for voice, ref in refs.items():
        tts.add_voice(voice, ref, save=False, denoise=False)

    def synthesize(text, voice):
        """Sinh mẫu bằng giọng đã nạp, không lưu câu hỏi hay audio."""
        return tts.infer(text, voice=voice, apply_watermark=False), tts.sample_rate

    return synthesize


def encode_wav(samples, sample_rate):
    """Đổi tần số và ghi WAV PCM16 có kích thước hữu hạn cho API hiện tại."""
    signal = np.asarray(samples, dtype=np.float32)
    if signal.ndim != 1 or not 0 < signal.size <= sample_rate * 180 or not np.isfinite(signal).all():
        raise ValueError('Dạng sóng không hợp lệ.')
    if sample_rate != WAV_HZ:
        signal = soxr.resample(signal, sample_rate, WAV_HZ)
    pcm = (np.clip(signal, -1, 1) * 32767).astype('<i2')
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(WAV_HZ)
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


def create_app(load=load_vieneu):
    """Tạo API chỉ phục vụ một lượt suy luận ở một thời điểm."""
    gate = threading.Lock()

    @asynccontextmanager
    async def lifespan(app):
        """Nạp model trước khi server nhận yêu cầu."""
        app.state.synthesize = load()
        yield
        app.state.synthesize = None

    app = FastAPI(lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _exc: RequestValidationError):
        """Giữ nội dung đầu vào khỏi phản hồi khi validation thất bại."""
        return JSONResponse({'detail': 'Yêu cầu tổng hợp âm thanh không hợp lệ.'}, status_code=422)

    @app.get('/health')
    def health():
        """Xác nhận model đã nạp xong qua vòng đời ứng dụng."""
        return {'status': 'ok'}

    @app.post('/v1/audio/speech')
    def speech(request: SpeechRequest):
        """Trả WAV hoặc báo bận/lỗi bằng nội dung cố định."""
        if not gate.acquire(blocking=False):
            return JSONResponse({'detail': 'Dịch vụ đang bận.'}, status_code=503)
        try:
            samples, rate = app.state.synthesize(request.input, request.voice)
            return Response(encode_wav(samples, rate), media_type='audio/wav',
                            headers={'Cache-Control': 'no-store'})
        except Exception:
            return JSONResponse({'detail': 'Không tạo được âm thanh.'}, status_code=502)
        finally:
            gate.release()

    return app


app = create_app()
