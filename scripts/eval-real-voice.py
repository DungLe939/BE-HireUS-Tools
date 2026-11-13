#!/usr/bin/env python3
"""Evaluate STT with real human voice samples against ground truth.
Measures latency, WER/CER, technical term accuracy, and mechanical errors.
"""
import glob
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
CACHE_DIR = Path('/tmp/hireus-stt-models')
VENV_PYTHON = Path('/tmp/hireus-whisper-venv/bin/python')


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
        str(VENV_PYTHON), '-m', 'uvicorn', 'main:app',
        '--host', '127.0.0.1', '--port', str(port),
        '--log-level', 'warning'
    ]
    proc = subprocess.Popen(cmd, cwd=str(SERVICE_DIR), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    base_url = f'http://127.0.0.1:{port}'
    deadline = time.monotonic() + 45.0
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


def main():
    print("=== STARTING REAL VOICE STT EVALUATION ===")
    files = sorted(glob.glob(str(DOWNLOADS_DIR / 'vi-*.mp3')) + glob.glob(str(DOWNLOADS_DIR / 'en-*.mp3')))
    print(f"Found {len(files)} files in {DOWNLOADS_DIR}")
    for f in files:
        dur = subprocess.check_output(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', f],
            text=True
        ).strip()
        print(f"  {Path(f).name}: {dur}s")

    port = pick_port()
    print(f"\n[PHASE 1] Starting small model on port {port} for file matching & primary latency...")
    proc, base_url = start_service('small', port)
    client = httpx.Client(timeout=120.0)

    # Step 1: probe each file with vi and en to determine mapping
    initial_transcripts = {}
    print("\n--- Probing files for ground truth mapping ---")
    for fpath_str in files:
        fpath = Path(fpath_str)
        fname = fpath.name
        # Test both vi and en
        res_vi = transcribe_file(client, base_url, fpath, 'vi')
        res_en = transcribe_file(client, base_url, fpath, 'en')
        initial_transcripts[fname] = {'vi': res_vi, 'en': res_en}

    # Match files with ground truths
    file_mapping = {}
    gt_assigned = {}
    print("\n--- Matching logic ---")
    for fname, results in initial_transcripts.items():
        best_gt = None
        best_wer = 999.0
        best_lang = 'vi'
        best_hyp = ''
        for gt_key, gt_text in GROUND_TRUTHS.items():
            lang = 'vi' if gt_key.startswith('VI') else 'en'
            hyp = results[lang]['text']
            eval_res = compute_wer(gt_text, hyp, lang)
            if eval_res['wer'] < best_wer:
                best_wer = eval_res['wer']
                best_gt = gt_key
                best_lang = lang
                best_hyp = hyp

        # If WER < 0.6 with a ground truth, it's a solid match
        if best_wer < 0.6:
            confidence = 'Cao' if best_wer < 0.25 else 'Trung bình'
            file_mapping[fname] = {
                'assigned_label': best_gt,
                'language': best_lang,
                'confidence': confidence,
                'best_wer': best_wer,
                'probe_text': best_hyp
            }
            gt_assigned[best_gt] = fname
        else:
            file_mapping[fname] = {
                'assigned_label': 'VI-NATURAL',
                'language': 'vi',
                'confidence': 'Cao',
                'best_wer': best_wer,
                'probe_text': results['vi']['text']
            }

    print("\n=== FILE MATCHING TABLE ===")
    for fname in sorted(file_mapping.keys()):
        m = file_mapping[fname]
        print(f"File: {fname} -> {m['assigned_label']} (lang={m['language']}, confidence={m['confidence']}, wer={m['best_wer']:.3f})")

    # Step 2: Measure small model (3 runs per file)
    print("\n[PHASE 2] Measuring 'small' model (3 runs each)...")
    small_results = {}
    for fname in sorted(file_mapping.keys()):
        fpath = DOWNLOADS_DIR / fname
        lang = file_mapping[fname]['language']
        runs = []
        for r_idx in range(3):
            res = transcribe_file(client, base_url, fpath, lang)
            runs.append(res)
            print(f"  {fname} [run {r_idx+1}/3]: status={res['status']} latency={res['latency_ms']:.1f}ms")
        small_results[fname] = runs

    stop_service(proc)
    print("Stopped 'small' service.")

    # Step 3: Measure medium model (2 runs each)
    port_m = pick_port()
    print(f"\n[PHASE 3] Starting 'medium' model on port {port_m} (2 runs each)...")
    proc_m, base_url_m = start_service('medium', port_m)
    medium_results = {}
    for fname in sorted(file_mapping.keys()):
        fpath = DOWNLOADS_DIR / fname
        lang = file_mapping[fname]['language']
        runs = []
        for r_idx in range(2):
            res = transcribe_file(client, base_url_m, fpath, lang)
            runs.append(res)
            print(f"  {fname} [run {r_idx+1}/2]: status={res['status']} latency={res['latency_ms']:.1f}ms")
        medium_results[fname] = runs

    stop_service(proc_m)
    print("Stopped 'medium' service.")

    # Step 4: Measure large-v3-turbo model (1 run for <= 30s files)
    port_l = pick_port()
    print(f"\n[PHASE 4] Starting 'large-v3-turbo' model on port {port_l} (1 run, files <= 30s)...")
    proc_l, base_url_l = start_service('large-v3-turbo', port_l)
    large_results = {}
    for fname in sorted(file_mapping.keys()):
        if file_mapping[fname]['assigned_label'] == 'VI-NATURAL':
            print(f"  {fname}: skipping large-v3-turbo for long natural speech per instructions.")
            continue
        fpath = DOWNLOADS_DIR / fname
        lang = file_mapping[fname]['language']
        res = transcribe_file(client, base_url_l, fpath, lang)
        print(f"  {fname} [run 1/1]: status={res['status']} latency={res['latency_ms']:.1f}ms")
        large_results[fname] = [res]

    stop_service(proc_l)
    print("Stopped 'large-v3-turbo' service.")

    # Save raw results
    output_data = {
        'file_mapping': file_mapping,
        'small': small_results,
        'medium': medium_results,
        'large_v3_turbo': large_results
    }
    with open('/tmp/eval_raw_results.json', 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    print("\nSaved raw benchmark data to /tmp/eval_raw_results.json")


if __name__ == '__main__':
    main()

