"""So Whisper small và Turbo trên cùng các clip đã xác nhận."""
import argparse
import csv
import json
import re
import subprocess
import time
from collections import defaultdict
from pathlib import Path

from audio_io import decode_mono
from report_asr import EVAL, NORMALIZE, OUT, TRUTHS, percentile, score

HOTWORDS = ('REST API', 'SQL', 'PostgreSQL', 'Redis', 'GraphQL', 'Docker', 'GitHub Actions', 'CI/CD')
PROFILES = [('small', 'baseline'), ('large-v3-turbo', 'baseline'), ('large-v3-turbo', 'hotwords')]


def extra_hotwords(ref, hyp, lang, terms=HOTWORDS):
    """Đếm lượt chèn vượt đáp án, theo cả từ hoặc cụm đã chuẩn hóa."""
    ref, hyp = (NORMALIZE(text, lang) for text in (ref, hyp))
    extra = {}
    for term in terms:
        pattern = rf'(?<!\w){re.escape(NORMALIZE(term, lang))}(?!\w)'
        count = len(re.findall(pattern, hyp)) - len(re.findall(pattern, ref))
        if count > 0:
            extra[term] = count
    return extra


def to_scored_row(row):
    """Dùng phép đo cũ và bổ sung số lượt chèn thuật ngữ gợi ý."""
    result = score(row)
    if row['label'] in TRUTHS:
        result['extra_terms'] = json.dumps(
            extra_hotwords(TRUTHS[row['label']], row['text'], row['lang']), ensure_ascii=False)
    return result


def load_plan(output):
    """Dùng nhãn đã duyệt và cắt 30 giây từ clip tự nhiên để đo latency."""
    files, durations = EVAL['list_clips']()
    labels = EVAL['load_confirmed_labels'](files)
    clips = [{'file': p.name, 'path': p, 'label': labels[p.name],
              'lang': p.name.split('-', 1)[0], 'duration_s': durations[p.name]} for p in files]
    natural = next((clip for clip in clips
                    if clip['lang'] == 'vi' and clip['label'] == 'NATURAL' and clip['duration_s'] > 30), None)
    if natural:
        segment = output / 'natural-30.wav'
        subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-i',
                        str(natural['path']),'-t','30','-ac','1','-ar','16000',str(segment)],
                       check=True, timeout=30)
        clips.append(dict(natural, file=segment.name, path=segment, duration_s=30))
    return clips


def measure(model, clip, hints):
    """Tính độ trễ gồm giải mã file và duyệt toàn bộ kết quả của Whisper."""
    began = time.perf_counter()
    segments, _ = model.transcribe(decode_mono(clip['path']), language=clip['lang'],
                                   task='transcribe', beam_size=5, vad_filter=False,
                                   condition_on_previous_text=True, hotwords=hints)
    transcript = ' '.join(segment.text.strip() for segment in segments)
    return dict(clip, status='ok', latency_ms=(time.perf_counter() - began) * 1000, text=transcript)


def summarize(rows):
    """Tách theo ngôn ngữ và nhóm độ dài, đồng thời báo riêng mẫu 30 giây."""
    groups = defaultdict(list)
    for row in rows:
        bucket = '30s NATURAL' if row['file'] == 'natural-30.wav' else row['bucket']
        groups[row['engine'], row['mode'], row['lang'], bucket].append(row)
    result = []
    for (engine, mode, lang, bucket), group in sorted(groups.items()):
        observed = [row['latency_ms'] for row in group]
        first = [row for row in group if row['run'] == 1 and 'wer' in row]
        counts = [pair for row in first for pair in json.loads(row['terms']).values()]
        total = sum(pair[1] for pair in counts)
        extras = sum(sum(json.loads(row['extra_terms']).values()) for row in first)
        result.append(dict(engine=engine, profile=mode, lang=lang, duration=bucket,
                           runs=len(group), p50_ms=percentile(observed, .5),
                           p95_ms=percentile(observed, .95),
                           wer=sum(row['wer'] for row in first) / len(first) if first else None,
                           term_recall=sum(pair[0] for pair in counts) / total if total else None,
                           extra_hotwords=extras if first else None))
    return result


def main():
    """Chạy tuần tự, lưu kết quả vào thư mục mới để giữ benchmark cũ."""
    from faster_whisper import WhisperModel

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reps', type=int, default=3, choices=range(1, 6))
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(OUT.resolve()) or output == OUT.resolve():
        parser.error('Thư mục kết quả phải nằm trong scripts/bench/out/.')
    output.mkdir(parents=True, exist_ok=False)
    clips = load_plan(output)
    groups = defaultdict(list)
    for model, mode in PROFILES:
        groups[model].append(mode)
    rows = []
    fields = ['engine','mode','file','label','lang','bucket','duration_s','run','status',
              'latency_ms','rtf','wer','WER_no_num','cer','term_recall','terms','extra_terms','text']
    with (output / 'results.csv').open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fields, extrasaction='ignore')
        writer.writeheader()
        for engine, modes in groups.items():
            model = WhisperModel(engine, device='cpu', compute_type='int8', cpu_threads=4,
                                 local_files_only=True)
            try:
                for mode in modes:
                    hints = ', '.join(HOTWORDS) if mode == 'hotwords' else None
                    measure(model, min(clips, key=lambda clip: clip['duration_s']), hints)
                    for clip in clips:
                        for rep in range(1, args.reps + 1):
                            measured = measure(model, clip, hints)
                            row = to_scored_row(dict(measured, engine=engine, mode=mode, run=rep))
                            rows.append(row)
                            writer.writerow(row)
                            stream.flush()
                        print(engine, mode, clip['file'], flush=True)
            finally:
                model.model.unload_model()
    (output / 'summary.json').write_text(
        json.dumps(summarize(rows), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
