#!/usr/bin/env python3
"""Reproducible CPU HTTP benchmark. Synthetic fixtures; never print/save transcripts."""
import argparse
import hashlib
import io
import json
import os
import re
import signal
import socket
import statistics
import subprocess
import sys
import time
import unicodedata
import wave
from pathlib import Path

import httpx

REFERENCE = 'Tôi muốn luyện tập phỏng vấn kỹ thuật phần mềm.'
SERVICE_DIR = Path(__file__).resolve().parents[1] / 'services' / 'stt-whisper'


def words(text):
    return re.findall(r'[^\W_]+', unicodedata.normalize('NFC', text).casefold(), re.UNICODE)


def word_errors(reference, hypothesis):
    """Levenshtein WER, keeping substitution/deletion/insertion counts, no text output."""
    ref, hyp = words(reference), words(hypothesis)
    previous = [(j, 0, 0, j) for j in range(len(hyp) + 1)]
    for i, expected in enumerate(ref, 1):
        current = [(i, 0, i, 0)]
        for j, actual in enumerate(hyp, 1):
            if expected == actual:
                current.append(previous[j - 1])
            else:
                d, s, delete, insert = previous[j - 1]
                substitute = (d + 1, s + 1, delete, insert)
                d, s, delete, insert = previous[j]
                deletion = (d + 1, s, delete + 1, insert)
                d, s, delete, insert = current[j - 1]
                insertion = (d + 1, s, delete, insert + 1)
                current.append(min(substitute, deletion, insertion))
        previous = current
    distance, substitutions, deletions, insertions = previous[-1]
    return {'wer': round(distance / max(1, len(ref)), 6), 'referenceWords': len(ref),
            'substitutions': substitutions, 'deletions': deletions, 'insertions': insertions}


def fixtures(directory, lengths):
    # One whole utterance plus silence makes an exact 5-second unit. Repeat whole
    # units, never truncate speech while pretending the reference contains it.
    raw = directory / 'utterance.wav'
    subprocess.run(['espeak-ng', '-v', 'vi', '-s', '140', '-w', str(raw), REFERENCE], check=True, capture_output=True)
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(raw), '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'],
                         check=True, capture_output=True).stdout
    if len(pcm) > 5 * 16000 * 2: raise RuntimeError('Synthetic utterance exceeds the five-second unit.')
    unit = pcm + bytes(5 * 16000 * 2 - len(pcm))
    result = {}
    for seconds in lengths:
        if seconds < 5 or seconds % 5: raise ValueError('Durations must be positive multiples of five seconds.')
        path = directory / f'synthetic-{seconds}s.wav'
        with wave.open(str(path), 'wb') as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(16000)
            audio.writeframes(unit * (seconds // 5))
        result[seconds] = (path, ' '.join([REFERENCE] * (seconds // 5)))
    return result


def wait_ready(client, base, process, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None: raise RuntimeError('ASR exited before readiness; inspect the local server log.')
        try:
            if client.get(base + '/health', timeout=2).status_code == 200: return
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    raise RuntimeError('ASR startup timed out.')


def measure(client, base, fixture):
    path, reference = fixture
    began = time.perf_counter()
    with path.open('rb') as audio:
        response = client.post(base + '/transcribe', files={'audio': ('synthetic.wav', audio, 'audio/wav')}, data={'language': 'vi'})
    elapsed = (time.perf_counter() - began) * 1000
    if response.status_code != 200: return {'status': response.status_code, 'latencyMs': round(elapsed, 3)}
    data = response.json()
    return {'status': 200, 'latencyMs': round(elapsed, 3), **word_errors(reference, data['text'])}


def run(args):
    directory = args.output_dir.resolve(); directory.mkdir(parents=True, exist_ok=True)
    generated = fixtures(directory, sorted(set(args.lengths + [5, 15])))
    report = {'audioSource': 'espeak-ng Vietnamese; repeated speech plus silence, NOT a human accuracy benchmark',
              'reference': REFERENCE, 'python': sys.version.split()[0],
              'visibleCpuCount': getattr(os, 'process_cpu_count', os.cpu_count)(), 'cpuThreads': args.threads,
              'serviceSha256': hashlib.sha256((SERVICE_DIR / 'main.py').read_bytes()).hexdigest(), 'results': []}
    available = {
        'comparison': {'WHISPER_BEAM_SIZE': '5', 'WHISPER_VAD_FILTER': 'false', 'WHISPER_CONDITION_ON_PREVIOUS_TEXT': 'true'},
        'fast': {'WHISPER_BEAM_SIZE': '1', 'WHISPER_VAD_FILTER': 'true', 'WHISPER_CONDITION_ON_PREVIOUS_TEXT': 'false'},
    }
    names = args.profiles or (['comparison', 'fast'] if args.with_comparison else ['comparison'])
    profiles = [(name, available[name]) for name in names]
    for model in args.models:
        for profile, flags in profiles:
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
            base = f'http://127.0.0.1:{port}'
            environment = {**os.environ, **flags, 'WHISPER_MODEL': model, 'WHISPER_DEVICE': 'cpu',
                'WHISPER_COMPUTE_TYPE': 'int8', 'WHISPER_CPU_THREADS': str(args.threads),
                'WHISPER_MODEL_CACHE': str(args.cache_dir.resolve()), 'PYTHONDONTWRITEBYTECODE': '1'}
            log_path = directory / f'{model}-{profile}-server.log'
            with log_path.open('wb') as log:
                process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', str(port),
                                            '--no-access-log', '--log-level', 'warning'], cwd=SERVICE_DIR, env=environment,
                                           stdout=log, stderr=log)
                try:
                    with httpx.Client(timeout=args.request_timeout, trust_env=False) as client:
                        wait_ready(client, base, process, args.startup_timeout)
                        measure(client, base, generated[5])  # Unmeasured warmup, excluded from aggregates.
                        for duration in args.lengths:
                            runs = []
                            for repetition in range(args.repeats):
                                measured = measure(client, base, generated[duration]); runs.append(measured)
                                print(json.dumps({'model': model, 'profile': profile, 'seconds': duration,
                                                  'run': repetition + 1, **measured}), flush=True)
                            latencies = [r['latencyMs'] for r in runs]
                            entry = {'model': model, 'profile': profile, 'computeType': 'int8', 'flags': flags,
                                     'audioSeconds': duration, 'runs': runs, 'meanMs': round(statistics.mean(latencies), 3),
                                     'maxMs': max(latencies), 'allSuccessful': all(r['status'] == 200 for r in runs)}
                            report['results'].append(entry)
                            (directory / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
                finally:
                    process.send_signal(signal.SIGTERM)
                    try: process.wait(timeout=60)
                    except subprocess.TimeoutExpired: process.kill(); process.wait(); raise RuntimeError('ASR did not shut down cleanly.')
            time.sleep(0.5)  # resource_tracker can flush just after the main process exits.
            warnings = log_path.read_text(errors='replace')
            report.setdefault('shutdowns', []).append({'model': model, 'profile': profile, 'exitCode': process.returncode,
                'leakedSemaphoreWarning': 'leaked semaphore' in warnings, 'resourceTrackerWarning': 'resource_tracker:' in warnings})
            (directory / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models', nargs='+', default=['small', 'large-v3-turbo'])
    parser.add_argument('--lengths', type=int, nargs='+', default=[5, 15, 30, 60])
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--threads', type=int, default=min(4, getattr(os, 'process_cpu_count', os.cpu_count)() or 1))
    parser.add_argument('--with-comparison', action='store_true')
    parser.add_argument('--profiles', nargs='+', choices=['fast', 'comparison'])
    parser.add_argument('--output-dir', type=Path, default=Path('/tmp/hireus-stt-benchmark'))
    parser.add_argument('--cache-dir', type=Path, default=Path('/tmp/hireus-stt-models'))
    parser.add_argument('--request-timeout', type=float, default=60)
    parser.add_argument('--startup-timeout', type=float, default=600)
    args = parser.parse_args()
    if args.repeats < 3 or not 1 <= args.threads <= 64: parser.error('Use >=3 repeats and 1..64 CPU threads.')
    run(args)
