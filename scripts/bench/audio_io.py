"""Đọc clip thành PCM mono 16 kHz giống tiền xử lý của baseline."""
import subprocess


def decode_mono(path):
    """Dùng FFmpeg để tránh phụ thuộc API giải mã MP3 của từng bản PyAV."""
    import numpy as np

    command = ['ffmpeg', '-nostdin', '-v', 'error', '-i', str(path),
               '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1']
    audio = subprocess.run(command, check=True, capture_output=True, timeout=30).stdout
    if not audio:
        raise ValueError('FFmpeg không trả mẫu PCM.')
    return np.frombuffer(audio, dtype='<f4').copy()
