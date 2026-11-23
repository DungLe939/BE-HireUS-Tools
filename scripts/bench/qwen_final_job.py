"""Thử tạo bản chép riêng sau phiên qua worker Qwen, không nối API sản phẩm."""
import argparse
import fcntl
import json
import os
import re
import tempfile
import uuid
from contextlib import contextmanager, redirect_stdout
from pathlib import Path
import sys

JOB_ROOT = Path(__file__).resolve().parent / 'out' / 'qwen-final'
AUDIO_SUFFIXES = {'.wav', '.mp3', '.ogg', '.webm', '.m4a', '.mp4'}


def job_dir(root, identifier):
    """Chỉ nhận ID nội bộ để giới hạn truy cập trong thư mục hàng đợi."""
    if not re.fullmatch(r'[a-f0-9]{32}', identifier):
        raise ValueError('ID job không hợp lệ.')
    return root / identifier


def write_job(folder, state):
    """Ghi nguyên tử cả trạng thái và transcript vào tệp chỉ chủ máy đọc được."""
    with tempfile.NamedTemporaryFile(dir=folder, mode='w', encoding='utf-8', delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(state, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
            temporary.replace(folder / 'job.json')
        finally:
            temporary.unlink(missing_ok=True)


def enqueue(root, language, audio):
    """Tạo job từ các tệp ghi âm gốc được người vận hành chọn."""
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    paths = [path.resolve(strict=True) for path in audio]
    if language not in {'vi', 'en', 'auto'} or not paths or any(
            not path.is_file() or path.suffix.lower() not in AUDIO_SUFFIXES for path in paths):
        raise ValueError('Cần chọn ngôn ngữ và ít nhất một tệp audio hợp lệ.')
    identifier = uuid.uuid4().hex
    folder = job_dir(root, identifier)
    folder.mkdir(mode=0o700)
    write_job(folder, {'id': identifier, 'status': 'queued', 'language': language,
                       'audio': [str(path) for path in paths], 'attempts': 0})
    return identifier


def read_job(root, identifier):
    """Đọc trạng thái đã ghi xong của một job."""
    return json.loads((job_dir(root, identifier) / 'job.json').read_text(encoding='utf-8'))


@contextmanager
def load_qwen():
    """Nạp adapter benchmark đã ghim cho công việc đang chạy."""
    from asr_worker import load_asr

    with load_asr('qwen-1.7b') as (transcribe, _):
        yield transcribe


def run_job(root, identifier, loader=load_qwen, *, retry=False):
    """Giữ một worker mỗi job; retry có thể phục hồi job dở sau khi mất khóa."""
    folder = job_dir(root, identifier)
    if not folder.is_dir():
        raise FileNotFoundError('Không tìm thấy job.')
    with os.fdopen(os.open(folder / '.lock', os.O_RDWR | os.O_CREAT, 0o600), 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError('Một worker khác đang xử lý job.') from exc
        state = read_job(root, identifier)
        if state['status'] == 'completed':
            return state
        if state['status'] != 'queued' and not retry:
            raise ValueError('Job đã dừng hoặc gặp lỗi; dùng lệnh retry.')
        state.update(status='running', attempts=state['attempts'] + 1)
        state.pop('error', None)
        write_job(folder, state)
        try:
            # Chỉ ghi bản chép sau khi toàn bộ các lượt đã xử lý xong.
            with redirect_stdout(sys.stderr), loader() as transcribe:
                language = None if state['language'] == 'auto' else state['language']
                turns = [{'index': i, 'text': transcribe(Path(file), language)['text'].strip()}
                         for i, file in enumerate(state['audio'], 1)]
            if not any(turn['text'] for turn in turns):
                raise ValueError('Toàn bộ bản chép rỗng.')
            state.update(status='completed', turns=turns)
        except Exception:
            state.update(status='failed', error='QWEN_TRANSCRIBE_FAILED')
        write_job(folder, state)
        return state


def main():
    """In trạng thái ngắn; bản chép chỉ nằm trong file kết quả đã ignore."""
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    add = actions.add_parser('enqueue')
    add.add_argument('--language', choices=['vi', 'en', 'auto'], required=True)
    add.add_argument('audio', nargs='+', type=Path)
    for name in ('run', 'retry', 'status'):
        actions.add_parser(name).add_argument('id')
    args = parser.parse_args()
    try:
        if args.action == 'enqueue':
            print(enqueue(JOB_ROOT, args.language, args.audio))
            return 0
        if args.action in ('run', 'retry'):
            state = run_job(JOB_ROOT, args.id, retry=args.action == 'retry')
        else:
            state = read_job(JOB_ROOT, args.id)
    except (ValueError, OSError):
        print('Không thể thực hiện thao tác với job.', file=sys.stderr)
        return 1
    print(json.dumps({key: state[key] for key in ('id', 'status', 'language', 'attempts')},
                     ensure_ascii=False))
    return int(state['status'] == 'failed')


if __name__ == '__main__':
    raise SystemExit(main())
