"""Nạp một model trong tiến trình riêng rồi xuất kết quả từng lượt dưới dạng JSON."""
import contextlib
import json
import resource
import runpy
import sys
import time
from pathlib import Path

from audio_io import decode_mono

ROOT = Path(__file__).resolve().parent
EVAL = ROOT.parent / 'eval-real-voice.py'
ENV = ROOT / 'envs'
HF = ENV / 'models'
IDS = {
    'pho-base': 'vinai/PhoWhisper-base', 'pho-small': 'vinai/PhoWhisper-small',
    'qwen-0.6b': 'Qwen/Qwen3-ASR-0.6B', 'qwen-1.7b': 'Qwen/Qwen3-ASR-1.7B',
}


def peak_mib(pid=None):
    """Lấy mức RAM cao nhất của model theo RSS trên Linux."""
    if pid is None:
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    for line in Path(f'/proc/{pid}/status').read_text().splitlines():
        if line.startswith('VmHWM:'):
            return int(line.split()[1]) / 1024
    return None


@contextlib.contextmanager
def load_asr(engine):
    """Tạo adapter cùng giao diện, giải phóng model khi xong toàn bộ lượt."""
    if engine.startswith('faster-whisper-'):
        import httpx
        base = runpy.run_path(str(EVAL))
        proc, url = base['start_service'](engine.removeprefix('faster-whisper-'), base['pick_port']())
        try:
            with httpx.Client(timeout=125) as client:
                def transcribe(path, lang):
                    """Dùng đúng API và cấu hình của baseline hiện tại."""
                    result = base['transcribe_file'](client, url, path, lang)
                    if (result['status'] == 422
                            and json.loads(result['error']).get('detail', {}).get('code')
                            == 'VMI_STT_EMPTY_TRANSCRIPT'):
                        # API baseline trả 422 cho phiên âm rỗng.
                        result['text'] = ''
                    elif result['status'] != 200:
                        raise RuntimeError(f"HTTP {result['status']}")
                    return result
                yield transcribe, lambda: peak_mib(proc.pid)
        finally:
            base['stop_service'](proc)
        return

    if engine.endswith('-ct2'):
        from faster_whisper import WhisperModel
        model = WhisperModel(str(ENV / 'converted' / engine), device='cpu',
                             compute_type='int8', cpu_threads=4)

        def transcribe(path, lang):
            """Duyệt hết generator để tính cả thời gian giải mã."""
            began = time.perf_counter()
            segments, _ = model.transcribe(decode_mono(path), language=lang, beam_size=5,
                                           vad_filter=False, condition_on_previous_text=True)
            text = ' '.join(segment.text.strip() for segment in segments)
            return {'text': text, 'latency_ms': (time.perf_counter() - began) * 1000}
        yield transcribe, peak_mib
        return

    import torch
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    if engine.startswith('pho-'):
        from transformers import pipeline

        pipe = pipeline('automatic-speech-recognition', model=IDS[engine],
                        device=-1, dtype=torch.float32)

        def transcribe(path, lang):
            """Đo PhoWhisper theo pipeline Transformers, kể cả giải mã MP3."""
            began = time.perf_counter()
            audio = decode_mono(path)
            result = pipe({'raw': audio, 'sampling_rate': 16000}, chunk_length_s=30,
                          generate_kwargs={'language': lang, 'task': 'transcribe'})
            return {'text': result['text'].strip(),
                    'latency_ms': (time.perf_counter() - began) * 1000}
        yield transcribe, peak_mib
        return

    if engine.startswith('qwen-'):
        from qwen_asr import Qwen3ASRModel
        # Dùng BF16 cho cả hai model để giảm áp lực RAM trên CPU 16 GB.
        model = Qwen3ASRModel.from_pretrained(
            IDS[engine], dtype=torch.bfloat16, device_map='cpu', max_inference_batch_size=1,
            max_new_tokens=512,
        )

        def transcribe(path, lang):
            """Thử ngôn ngữ clip hoặc để Qwen tự nhận diện."""
            began = time.perf_counter()
            language = {'vi': 'Vietnamese', 'en': 'English', None: None}[lang]
            with torch.inference_mode():
                text = model.transcribe(audio=(decode_mono(path), 16000), language=language)[0].text
            return {'text': text.strip(), 'latency_ms': (time.perf_counter() - began) * 1000}
        yield transcribe, peak_mib
        return

    if engine.startswith('moss-'):
        from moss_adapter import load_moss
        yield load_moss(engine), peak_mib
        return
    raise ValueError(f'Model chưa hỗ trợ: {engine}')


def main():
    """Giữ stdout dành cho JSON, ghi tiến độ thư viện ra stderr."""
    engine, plan_file = sys.argv[1:]
    plan = json.loads(Path(plan_file).read_text())
    emit = sys.stdout
    began = time.perf_counter()
    with contextlib.redirect_stdout(sys.stderr), load_asr(engine) as (transcribe, memory):
        load_ms = (time.perf_counter() - began) * 1000
        for mode in plan['modes']:
            # Mỗi chế độ chạy một lượt làm nóng trên clip ngắn nhất.
            warmup = min(plan['clips'], key=lambda clip: clip['duration_s'])
            try:
                transcribe(Path(warmup['path']), None if mode == 'auto' else warmup['lang'])
            except Exception as exc:
                print(f'Làm nóng {mode} lỗi: {type(exc).__name__}: {exc}', file=sys.stderr)
            for clip in plan['clips']:
                for rep in range(1, plan['reps'] + 1):
                    row = {**clip, 'engine': engine, 'mode': mode, 'run': rep, 'load_ms': load_ms}
                    try:
                        row.update(transcribe(Path(clip['path']), None if mode == 'auto' else clip['lang']))
                        row['status'] = 'ok'
                    except Exception as exc:
                        row.update(status='error', error=f'{type(exc).__name__}: {exc}', text='')
                    row['peak_ram_mib'] = memory()
                    print(json.dumps(row, ensure_ascii=False), file=emit, flush=True)


if __name__ == '__main__':
    main()
