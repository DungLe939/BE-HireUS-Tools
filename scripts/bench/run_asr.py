"""Chạy tuần tự các adapter ASR đã cài và lưu từng lần đo để có thể chạy lại."""
import json
import os
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV = ROOT / 'envs'
OUT = ROOT / 'out' / 'asr'
ENGINES = [
    'faster-whisper-small', 'faster-whisper-medium', 'faster-whisper-large-v3-turbo',
    'pho-base', 'pho-small', 'pho-base-ct2', 'pho-small-ct2',
    'qwen-0.6b', 'qwen-1.7b', 'moss-speech', 'moss-multimodal', 'moss-causal',
]


def save_json(path, value):
    """Lưu JSON định dạng UTF-8 để đối chiếu lại cấu hình và lỗi."""
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def run_engines(clips, engines, qwen_one_run):
    """Chỉ nạp một model cùng lúc và giữ các lượt đã ghi nếu bị timeout."""
    OUT.mkdir(parents=True, exist_ok=True)
    for engine in engines:
        if engine.startswith('moss-'):
            print(f'{engine}: xem lệnh chạy sandbox offline trong README.', flush=True)
            continue
        print(f'Đang đo {engine}', flush=True)
        plan = OUT / f'{engine}.plan.json'
        save_json(plan, {
            'clips': clips,
            'modes': ['forced', 'auto'] if engine.startswith('qwen-') else ['forced'],
            'reps': 1 if engine == 'qwen-1.7b' and qwen_one_run else 3,
        })
        venv = 'moss' if engine.startswith('moss-') else engine
        python = ENV / venv / 'bin' / 'python'
        if not python.is_file():
            # Hủy hiệu lực dữ liệu lần trước để không báo nhầm lượt chạy mới.
            (OUT / f'{engine}.jsonl').write_text('', encoding='utf-8')
            save_json(OUT / f'{engine}.status.json',
                      {'status': 'missing', 'detail': f'Chưa cài venv {venv}'})
            continue
        env = {**os.environ, 'HF_HOME': str(ENV / 'models'),
               'VMI_BENCH_MODEL_CACHE': str(ENV / 'models' / 'hub'),
               'PYTHONDONTWRITEBYTECODE': '1', 'HF_HUB_DISABLE_IMPLICIT_TOKEN': '1',
               'OMP_NUM_THREADS': '4',
               'OPENBLAS_NUM_THREADS': '4', 'TOKENIZERS_PARALLELISM': 'false'}
        with (OUT / f'{engine}.jsonl').open('w', encoding='utf-8') as output, (
            OUT / f'{engine}.log'
        ).open('w', encoding='utf-8') as log:
            proc = subprocess.Popen(
                [str(python), '-B', str(ROOT / 'asr_worker.py'), engine, str(plan)],
                env=env, stdout=output, stderr=log, start_new_session=True,
            )
            try:
                code = proc.wait(timeout=1800)
                result = {'status': 'ok' if code == 0 else 'error', 'exit_code': code}
            except subprocess.TimeoutExpired:
                result = {'status': 'timeout', 'detail': 'Quá 30 phút'}
            finally:
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
        # Worker có thể xử lý xong nhưng từng request đều lỗi.
        rows = []
        for line in (OUT / f'{engine}.jsonl').read_text(encoding='utf-8').splitlines():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        result.update(rows=len(rows), successes=sum(row['status'] == 'ok' for row in rows))
        if result['status'] == 'ok':
            if not result['successes']:
                result['status'] = 'error'
            elif result['successes'] < len(rows):
                result['status'] = 'partial'
        save_json(OUT / f'{engine}.status.json', result)
        print(f'{engine}: {result["status"]}', flush=True)
