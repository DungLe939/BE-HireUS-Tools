"""Đo SDK và HTTP loopback của VieNeu, lưu WAV để nghe lại từng cấu hình."""
import argparse
import csv
import json
import io
import os
import resource
import signal
import socket
import struct
import subprocess
import sys
import time
import wave
from pathlib import Path

BASE = Path(__file__).resolve().parent
ENV = BASE / 'envs'
OUT = BASE / 'out' / 'tts'
SOURCE = ENV / 'sources' / 'VieNeu-TTS'
BACKEND = BASE.parents[1]
VOICES = {'hai_dang': 'Hải Đăng', 'mai_anh': 'Mai Anh',
          'thien_minh': 'Thiện Minh', 'thuy_dung': 'Thùy Dung'}
ENGINES = ['vieneu-turbo-int8', 'vieneu-nano', 'vieneu-turbo-fp32', 'zonos']
FIELDS = ['engine', 'interface', 'format', 'voice', 'prompt', 'kind', 'normalized',
          'status', 'ttfa_ms', 'total_ms', 'duration_s', 'rtf', 'ram_mib',
          'load_ms', 'clipped_fraction', 'wav', 'error']


def normalize_prompts(prompts):
    """Gọi chính hàm TypeScript đang dùng trong backend, không sửa mã nguồn."""
    source = BACKEND / 'src' / 'vmi' / 'utils' / 'tts-text-normalizer.util.ts'
    ts = BACKEND / 'node_modules' / 'typescript'
    js = """
    const fs = require('node:fs'), ts = require(process.argv[1]);
    // Biên dịch tại chỗ trong bộ nhớ để dùng chính normalizer của backend.
    require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(
      fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, file);
    const convert = require(process.argv[2]).normalizeTtsText;
    const items = JSON.parse(fs.readFileSync(0, 'utf8'));
    process.stdout.write(JSON.stringify(items.map(item => convert(item.text, item.lang))));
    """
    result = subprocess.run(['node', '-e', js, str(ts), str(source)], input=json.dumps(prompts),
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def peak_ram(pid=None):
    """Đọc peak RSS của process model nếu chạy qua HTTP hoặc SDK."""
    if pid is None:
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    for line in Path(f'/proc/{pid}/status').read_text().splitlines():
        if line.startswith('VmHWM:'):
            return int(line.split()[1]) / 1024
    return None


def write_wav(path, pcm, rate):
    """Đóng gói PCM16 vào WAV chuẩn để mở bằng trình chơi audio."""
    with wave.open(str(path), 'wb') as dest:
        dest.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        dest.writeframes(pcm)


def wav_offset(buf):
    """Tìm chunk data thay vì đếm thời gian bắt đầu của WAV header."""
    offset = 12
    if len(buf) >= 12 and (buf[:4] != b'RIFF' or buf[8:12] != b'WAVE'):
        raise ValueError('Body không phải WAV RIFF.')
    while offset + 8 <= len(buf):
        chunk = buf[offset:offset + 4]
        if chunk == b'data':
            return offset + 8
        size = struct.unpack_from('<I', buf, offset + 4)[0]
        offset += 8 + size + (size % 2)
    return None


def sdk_call(model, text, voice):
    """Đo từ lúc yêu cầu SDK đến khi có mẫu âm thanh đầu và cuối."""
    import numpy as np
    began = time.perf_counter()
    samples = []
    first = None
    for chunk in model.infer_stream(text, voice=voice, apply_watermark=False):
        if len(chunk):
            if first is None:
                first = (time.perf_counter() - began) * 1000
            samples.append(np.asarray(chunk))
    total = (time.perf_counter() - began) * 1000
    pcm = (np.clip(np.concatenate(samples), -1, 1) * 32767).astype('<i2').tobytes()
    return pcm, model.sample_rate, first, total


def http_call(client, base, text, voice, fmt, zonos=False, lang='vi'):
    """Tính TTFA đến byte PCM đầu tiên, kể cả khi WAV gửi header riêng."""
    if zonos:
        request = {'model': 'zonos3', 'input': text, 'voice': voice, 'response_format': fmt,
                   'language': 'vi' if lang == 'vi' else 'en_us'}
    else:
        request = {'model': 'vieneu-v3-turbo', 'input': text, 'voice': voice,
                   'response_format': fmt, 'sample_rate': 48000}
    began = time.perf_counter()
    buffer = bytearray()
    first = None
    offset = 0 if fmt == 'pcm' else None
    with client.stream('POST', base + '/v1/audio/speech', json=request, timeout=180) as response:
        response.raise_for_status()
        rate = int(response.headers.get('x-sample-rate', '48000'))
        for chunk in response.iter_bytes():
            buffer.extend(chunk)
            if offset is None:
                offset = wav_offset(buffer)
            if first is None and offset is not None and len(buffer) >= offset + 2:
                first = (time.perf_counter() - began) * 1000
    if first is None or offset is None:
        raise ValueError('Body không có khung âm thanh.')
    if fmt == 'wav':
        with wave.open(io.BytesIO(buffer), 'rb') as header:
            if header.getnchannels() != 1 or header.getsampwidth() != 2:
                raise ValueError('WAV không phải PCM16 mono.')
            rate = header.getframerate()
    return bytes(buffer[offset:]), rate, first, (time.perf_counter() - began) * 1000


def measure(writer, config, prompts, normalized, voices, call, ram, load_ms):
    """Đo tám câu mỗi giọng, cộng cặp normalizer trên câu trộn qua SDK."""
    for voice_id, voice_name in voices.items():
        for index, original in enumerate(prompts, 1):
            choices = [(False, original['text'])]
            if config['engine'] == 'zonos':
                choices = [(True, normalized[index - 1])]
            elif config['interface'] == 'sdk' and original['kind'] == 'VI-EN':
                choices.append((True, normalized[index - 1]))
            for altered, text in choices:
                row = {**config, 'voice': voice_name, 'prompt': index, 'kind': original['kind'],
                       'normalized': altered, 'load_ms': load_ms}
                try:
                    pcm, rate, first, total = call(text, voice_name, original['lang'])
                    if not pcm or len(pcm) % 2:
                        raise ValueError('PCM thiếu hoặc sai độ dài.')
                    duration = len(pcm) / (2 * rate)
                    tag = f"{config['engine']}-{config['interface']}-{config['format']}"
                    suffix = '-norm' if altered else ''
                    path = OUT / f'{tag}_{voice_id}_{index}{suffix}.wav'
                    write_wav(path, pcm, rate)
                    near_clip = sum(abs(value) >= 32760 for (value,) in struct.iter_unpack('<h', pcm))
                    row.update(status='ok', ttfa_ms=first, total_ms=total, duration_s=duration,
                               rtf=total / (1000 * duration), ram_mib=ram(), wav=path.name,
                               clipped_fraction=near_clip / (len(pcm) / 2))
                except Exception as exc:
                    row.update(status='error', error=f'{type(exc).__name__}: {exc}')
                writer.writerow(row)


def startup_api(log, precision):
    """Khởi chạy server upstream trên loopback và chờ nạp model."""
    import httpx
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env = {**os.environ, 'HOST': '127.0.0.1', 'PORT': str(port), 'VIENEU_DEVICE': 'cpu',
           'VIENEU_BACKEND': 'onnx', 'VIENEU_PRECISION': precision, 'VIENEU_WATERMARK': '0',
           'VIENEU_MAX_STREAMS': '1'}
    env.pop('VIENEU_API_KEY', None)
    env.pop('VIENEU_ONNX_DIR', None)
    began = time.perf_counter()
    proc = subprocess.Popen([sys.executable, '-B', '-m', 'apps.openai_speech'], cwd=SOURCE,
                            stdout=log, stderr=log, env=env)
    base = f'http://127.0.0.1:{port}'
    try:
        while time.perf_counter() - began < 600:
            if proc.poll() is not None:
                raise RuntimeError('Server VieNeu đã thoát lúc nạp model; xem log API.')
            try:
                if httpx.get(base + '/health', timeout=2).is_success:
                    return proc, base, (time.perf_counter() - began) * 1000
            except httpx.HTTPError:
                pass
            time.sleep(.25)
        raise TimeoutError('Server VieNeu chưa sẵn sàng sau 600 giây.')
    except BaseException:
        stop_api(proc)
        raise


def stop_api(proc):
    """Dọn tiến trình API giữa hai cấu hình để không giữ RAM."""
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def run_worker(engine, phase):
    """Một process chỉ nạp một engine, hoặc gửi request tới API đã chọn."""
    import httpx
    prompts = json.loads((BASE / 'tts_prompts.json').read_text(encoding='utf-8'))
    normalized = normalize_prompts(prompts) if phase == 'sdk' or engine == 'zonos' else None
    precision = engine.rsplit('-', 1)[-1]
    config = {'engine': engine, 'interface': phase}
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / f'{engine}-{phase}.csv').open('w', newline='', encoding='utf-8', buffering=1) as out:
        writer = csv.DictWriter(out, fieldnames=FIELDS)
        writer.writeheader()
        try:
            if phase == 'sdk':
                from vieneu import Vieneu
                began = time.perf_counter()
                kwargs = {} if engine == 'vieneu-nano' else {'backend': 'onnx', 'device': 'cpu',
                                                              'precision': precision}
                model = Vieneu(mode='v3nano' if engine == 'vieneu-nano' else 'v3turbo', **kwargs)
                load_ms = (time.perf_counter() - began) * 1000
                sdk_call(model, 'Xin chào.', None)
                measure(writer, {**config, 'format': 'wav'}, prompts, normalized, VOICES,
                        lambda text, voice, _: sdk_call(model, text, voice), peak_ram, load_ms)
                return
            with httpx.Client() as client:
                if engine == 'zonos':
                    base = os.environ.get('VMI_BENCH_ZONOS_URL', 'http://127.0.0.1:1919')
                    client.get(base + '/v2/health', timeout=3).raise_for_status()
                    measure(writer, {**config, 'format': 'wav'}, prompts, normalized,
                            {'wyatt': 'default_34370fd91e3484ef'},
                            lambda text, voice, lang: http_call(client, base, text, voice, 'wav',
                                                               zonos=True, lang=lang),
                            lambda: None, None)
                    return
                with (OUT / f'{engine}-server.log').open('w', encoding='utf-8') as log:
                    proc, base, load_ms = startup_api(log, precision)
                    try:
                        for fmt in ('wav', 'pcm'):
                            measure(writer, {**config, 'format': fmt}, prompts, None, VOICES,
                                    lambda text, voice, _: http_call(client, base, text, voice, fmt),
                                    lambda: peak_ram(proc.pid), load_ms)
                    finally:
                        stop_api(proc)
        except Exception as exc:
            writer.writerow({**config, 'status': 'error', 'error': f'{type(exc).__name__}: {exc}'})
            raise


def main():
    """Chạy từng cấu hình CPU, chỉ thử int8 nếu cờ VNNI hiện diện."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engines', nargs='+', choices=ENGINES, default=ENGINES)
    parser.add_argument('--phases', nargs='+', choices=['sdk', 'api'], default=['sdk', 'api'])
    parser.add_argument('--worker', nargs=2, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        run_worker(*args.worker)
        return
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'run-complete').unlink(missing_ok=True)
    flags = Path('/proc/cpuinfo').read_text().split()
    for engine in args.engines:
        phases = ['api'] if engine == 'zonos' else ['sdk'] if engine == 'vieneu-nano' else ['sdk', 'api']
        phases = [phase for phase in phases if phase in args.phases]
        python = Path(sys.executable) if engine == 'zonos' else ENV / engine / 'bin' / 'python'
        skipped = None
        if not python.is_file():
            skipped = 'Chưa cài venv.'
        elif engine.endswith('-int8') and not {'avx_vnni', 'avx512_vnni'} & set(flags):
            skipped = 'CPU không có VNNI.'
        if skipped:
            for phase in phases:
                # Dòng skip thay CSV cũ, bảo đảm bảng phản ánh lần chạy hiện tại.
                path = OUT / f'{engine}-{phase}.csv'
                with path.open('w', newline='', encoding='utf-8') as out:
                    writer = csv.DictWriter(out, fieldnames=FIELDS)
                    writer.writeheader()
                    writer.writerow(dict(engine=engine, interface=phase, status='skip', error=skipped))
            print(f'{engine}: {skipped}', flush=True)
            continue
        env = {**os.environ, 'HF_HOME': str(ENV / 'models'), 'PYTHONDONTWRITEBYTECODE': '1',
               'OMP_NUM_THREADS': '4', 'OPENBLAS_NUM_THREADS': '4',
               'HF_HUB_DISABLE_IMPLICIT_TOKEN': '1'}
        for phase in phases:
            print(f'Đang đo TTS {engine} qua {phase}', flush=True)
            with (OUT / f'{engine}-{phase}.log').open('w', encoding='utf-8') as log:
                proc = subprocess.Popen([str(python), '-B', __file__, '--worker', engine, phase],
                                        env=env, stdout=log, stderr=log, start_new_session=True)
                try:
                    code = proc.wait(timeout=1800)
                except subprocess.TimeoutExpired:
                    code = 'timeout'
                finally:
                    if proc.poll() is None:
                        os.killpg(proc.pid, signal.SIGKILL)
                        proc.wait()
            print(f'{engine}/{phase}: mã thoát {code}', flush=True)
    (OUT / 'run-complete').touch()


if __name__ == '__main__':
    main()
