#!/usr/bin/env python3
"""Evaluate STT with real human voice samples against ground truth.
Measures latency, WER/CER, technical term accuracy, and mechanical errors.
"""
import argparse
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
import httpx

GROUND_TRUTHS = {
    'VI-A': 'Em chào anh chị. Em là sinh viên năm ba ngành công nghệ thông tin, em đang ứng tuyển vị trí thực tập sinh Backend.',
    'VI-B': 'Trong dự án gần nhất, em dùng PostgreSQL làm cơ sở dữ liệu chính và Redis để cache. Em tạo index cho cột email để tăng tốc truy vấn, và dùng transaction để đảm bảo tính ACID khi trừ tiền trong đơn hàng.',
    'VI-C': 'REST API và GraphQL khác nhau ở cách client lấy dữ liệu. Với REST, mỗi endpoint trả về một cấu trúc cố định, nên đôi khi client nhận thừa hoặc thiếu dữ liệu. Với GraphQL, client tự khai báo các trường cần lấy trong một query duy nhất, nhưng server phải xử lý thêm phần caching và giới hạn độ sâu của query. Em sẽ chọn REST cho dự án nhỏ vì đơn giản và dễ triển khai.',
    'VI-D': 'Hệ thống xử lý khoảng mười nghìn request mỗi phút, độ trễ trung bình khoảng hai trăm mili giây. Pipeline CI/CD chạy trên GitHub Actions, em viết unit test bằng Jest và đo coverage khoảng tám mươi phần trăm.',
    'EN-A': 'I used PostgreSQL and Redis in my last project. I added an index on the email column to speed up queries, and I used transactions to keep the data consistent.',
    'EN-B': 'A REST API exposes resources through endpoints, while GraphQL lets the client ask for exactly the fields it needs. For a small project, I would choose REST because it is simpler to build and deploy.',
}

TERMS = [
    'PostgreSQL', 'Redis', 'cache', 'index', 'transaction', 'ACID',
    'REST API', 'GraphQL', 'endpoint', 'query', 'caching', 'CI/CD',
    'GitHub Actions', 'Jest', 'coverage', 'unit test', 'pipeline', 'request'
]

DOWNLOADS_DIR = Path('/home/djokov1c/Downloads')
SERVICE_DIR = Path(__file__).resolve().parents[1] / 'services' / 'stt-whisper'
BENCH_DIR = Path(__file__).resolve().parent / 'bench'
LABELS_PATH = BENCH_DIR / 'file_labels.json'
CACHE_DIR = Path(os.environ.get('VMI_BENCH_MODEL_CACHE', BENCH_DIR / 'envs' / 'models'))
BASELINE_MODELS = ('small', 'medium', 'large-v3-turbo')


def normalize_for_eval(text: str, lang: str = 'vi') -> str:
    """Normalize text: casefold, remove punctuation, canonicalize numbers/terms."""
    t = unicodedata.normalize('NFC', text).casefold()
    # Normalize common technical abbreviations/numbers in Vietnamese
    if lang == 'vi':
        # Numbers to words / common representations
        t = re.sub(r'\b10[.,]000\b|\b10000\b', 'mười nghìn', t)
        t = re.sub(r'\b200\b', 'hai trăm', t)
        t = re.sub(r'\b80%\b|\b80\s*phần trăm\b', 'tám mươi phần trăm', t)
        t = re.sub(r'\bnăm\s+3\b', 'năm ba', t)
        t = re.sub(r'\bci\s*/\s*cd\b', 'ci/cd', t)
        t = re.sub(r'\brest\s+api\b', 'rest api', t)
        t = re.sub(r'\bgithub\s+actions\b', 'github actions', t)
        t = re.sub(r'\bunit\s+test\b', 'unit test', t)
    else:
        t = re.sub(r'\brest\s+api\b', 'rest api', t)
    # Remove punctuation
    t = re.sub(r'[,.?!;:\'"“”‘’()\[\]{}/\\_-]', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def levenshtein_words(ref_words, hyp_words):
    prev = [(j, 0, 0, j) for j in range(len(hyp_words) + 1)]
    for i, exp in enumerate(ref_words, 1):
        curr = [(i, 0, i, 0)]
        for j, act in enumerate(hyp_words, 1):
            if exp == act:
                curr.append(prev[j - 1])
            else:
                d, s, del_c, ins_c = prev[j - 1]
                sub = (d + 1, s + 1, del_c, ins_c)
                d, s, del_c, ins_c = prev[j]
                deletion = (d + 1, s, del_c + 1, ins_c)
                d, s, del_c, ins_c = curr[j - 1]
                insertion = (d + 1, s, del_c, ins_c + 1)
                curr.append(min(sub, deletion, insertion))
        prev = curr
    return prev[-1]  # dist, subs, dels, ins


def compute_wer(ref: str, hyp: str, lang: str = 'vi'):
    ref_norm = normalize_for_eval(ref, lang)
    hyp_norm = normalize_for_eval(hyp, lang)
    r_words = ref_norm.split()
    h_words = hyp_norm.split()
    if not r_words:
        return {'wer': 0.0 if not h_words else 1.0, 'substitutions': 0, 'deletions': 0, 'insertions': len(h_words), 'ref_len': 0}
    dist, s, d, i = levenshtein_words(r_words, h_words)
    return {'wer': round(dist / len(r_words), 4), 'substitutions': s, 'deletions': d, 'insertions': i, 'ref_len': len(r_words)}


def compute_cer(ref: str, hyp: str, lang: str = 'vi'):
    ref_norm = normalize_for_eval(ref, lang).replace(' ', '')
    hyp_norm = normalize_for_eval(hyp, lang).replace(' ', '')
    if not ref_norm:
        return {'cer': 0.0 if not hyp_norm else 1.0, 'ref_len': 0}
    prev = list(range(len(hyp_norm) + 1))
    for i, exp in enumerate(ref_norm, 1):
        curr = [i]
        for j, act in enumerate(hyp_norm, 1):
            cost = 0 if exp == act else 1
            curr.append(min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost))
        prev = curr
    dist = prev[-1]
    return {'cer': round(dist / len(ref_norm), 4), 'dist': dist, 'ref_len': len(ref_norm)}


def pick_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def start_service(model_name: str, port: int):
    env = os.environ.copy()
    env.update({
        'WHISPER_MODEL': model_name,
        'WHISPER_DEVICE': 'cpu',
        'WHISPER_COMPUTE_TYPE': 'int8',
        'WHISPER_CPU_THREADS': '4',
        'WHISPER_BEAM_SIZE': '5',
        'WHISPER_VAD_FILTER': 'false',
        'WHISPER_CONDITION_ON_PREVIOUS_TEXT': 'true',
        'WHISPER_MODEL_CACHE': str(CACHE_DIR),
        'VMI_AUDIO_MAX_BYTES': '15728640',
        'VMI_AUDIO_MAX_DURATION_MS': '195000',
    })
    cmd = [
        str(BENCH_DIR / 'envs' / f'faster-whisper-{model_name}' / 'bin' / 'python'), '-B', '-m', 'uvicorn', 'main:app',
        '--host', '127.0.0.1', '--port', str(port),
        '--log-level', 'warning'
    ]
    proc = subprocess.Popen(cmd, cwd=str(SERVICE_DIR), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    base_url = f'http://127.0.0.1:{port}'
    deadline = time.monotonic() + 180.0
    client = httpx.Client(timeout=5.0)
    ready = False
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            _, err = proc.communicate()
            raise RuntimeError(f"Service died on startup: {err.decode('utf-8', 'replace')}")
        try:
            r = client.get(f'{base_url}/health')
            if r.status_code == 200:
                ready = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    if not ready:
        proc.kill()
        raise RuntimeError(f"Service startup timed out for model {model_name}")
    return proc, base_url


def stop_service(proc):
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def transcribe_file(client: httpx.Client, base_url: str, file_path: Path, lang: str):
    began = time.perf_counter()
    with file_path.open('rb') as f:
        files = {'audio': (file_path.name, f, 'audio/mpeg')}
        data = {'language': lang}
        resp = client.post(f'{base_url}/transcribe', files=files, data=data, timeout=120.0)
    elapsed_ms = (time.perf_counter() - began) * 1000
    if resp.status_code != 200:
        return {'status': resp.status_code, 'latency_ms': elapsed_ms, 'text': '', 'error': resp.text}
    body = resp.json()
    return {
        'status': 200,
        'latency_ms': elapsed_ms,
        'text': body['text'],
        'duration_ms': body.get('durationMs', 0),
        'language': body.get('language', lang)
    }


def list_clips():
    """Liệt kê clip và thời lượng thực để người duyệt dễ đối chiếu."""
    files = sorted([*DOWNLOADS_DIR.glob('vi-*.mp3'), *DOWNLOADS_DIR.glob('en-*.mp3')])
    durations = {}
    for path in files:
        duration = subprocess.check_output(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', str(path)],
            text=True,
        )
        durations[path.name] = float(duration)
        print(f'  {path.name}: {durations[path.name]:.2f}s', flush=True)
    return files, durations


def suggest_labels(files):
    """Dùng Whisper small để gợi ý, chỉ so với đáp án cùng ngôn ngữ."""
    proc, url = start_service('small', pick_port())
    labels = {}
    try:
        with httpx.Client(timeout=120.0) as client:
            for path in files:
                lang = path.name.split('-', 1)[0]
                result = transcribe_file(client, url, path, lang)
                if result['status'] == 200 and result['text'].strip():
                    score, label = min(
                        (compute_wer(truth, result['text'], lang)['wer'], key)
                        for key, truth in GROUND_TRUTHS.items()
                        if key.startswith(lang.upper() + '-')
                    )
                    labels[path.name] = label if score < 0.6 else 'NATURAL'
                    print(f"  {path.name}: {labels[path.name]} (WER gợi ý {score:.3f})",
                          flush=True)
                else:
                    labels[path.name] = None
                    print(f"  {path.name}: chưa có gợi ý (HTTP {result['status']})", flush=True)
    finally:
        stop_service(proc)
    return labels


def load_confirmed_labels(files):
    """Chỉ dùng nhãn do người dùng duyệt để lấy đáp án khi đo."""
    try:
        labels = json.loads(LABELS_PATH.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise SystemExit('Cần file_labels.json hợp lệ đã được xác nhận.') from exc
    if not isinstance(labels, dict) or set(labels) != {path.name for path in files}:
        raise SystemExit('Tên clip trong file_labels.json phải khớp bộ clip hiện tại.')
    for name, label in labels.items():
        lang = name.split('-', 1)[0].upper()
        if label != 'NATURAL' and (
            not isinstance(label, str) or label not in GROUND_TRUTHS
            or not label.startswith(lang + '-')
        ):
            raise SystemExit(f'Nhãn thiếu hoặc sai ngôn ngữ cho {name}.')
    return labels


def main():
    """Tạo nhãn nháp hoặc chạy benchmark sau khi đã có xác nhận."""
    parser = argparse.ArgumentParser(description='Chuẩn bị nhãn giọng thật cho VMI')
    parser.add_argument('--without-suggestions', action='store_true',
                        help='Chỉ liệt kê clip nếu chưa có môi trường Whisper small')
    parser.add_argument('--confirmed-labels', action='store_true',
                        help='Chạy đo với file_labels.json đã được nghe và xác nhận')
    parser.add_argument('--engines', nargs='+', help='Chỉ chạy các model được liệt kê')
    parser.add_argument('--qwen-1-7b-one-run', action='store_true',
                        help='Chỉ đo một lượt mỗi clip/chế độ với Qwen 1.7B trên CPU')
    args = parser.parse_args()
    files, durations = list_clips()
    if not files:
        parser.error('Không tìm thấy clip vi-*.mp3 hoặc en-*.mp3.')
    if args.confirmed_labels:
        sys.path.insert(0, str(BENCH_DIR))
        from run_asr import ENGINES, run_engines

        labels = load_confirmed_labels(files)
        engines = args.engines or ENGINES
        if not set(engines) <= set(ENGINES):
            parser.error('Có model chưa nhận diện được.')
        clips = [{'file': path.name, 'path': str(path), 'label': labels[path.name],
                  'duration_s': durations[path.name], 'lang': path.name.split('-', 1)[0]}
                 for path in files]
        run_engines(clips, engines, args.qwen_1_7b_one_run)
        return
    if LABELS_PATH.exists():
        print(f'Đã có {LABELS_PATH}. Hãy kiểm tra và xác nhận nhãn.')
        return
    labels = ({path.name: None for path in files} if args.without_suggestions
              else suggest_labels(files))
    LABELS_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Chế độ x giữ nguyên mọi bản nháp hoặc nhãn người dùng đã lưu.
    with LABELS_PATH.open('x', encoding='utf-8') as draft:
        json.dump(labels, draft, ensure_ascii=False, indent=2)
        draft.write('\n')
    print(f'Đã tạo {LABELS_PATH}. Hãy kiểm tra và xác nhận nhãn.')


if __name__ == '__main__':
    main()
