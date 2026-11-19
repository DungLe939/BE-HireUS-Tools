"""In bảng Markdown từ kết quả đã lưu, không thêm số đo ước lượng."""
import csv
import json
import statistics
from collections import defaultdict

from report_asr import OUT, percentile


def format_value(value, factor=1, decimals=2):
    """Dùng dấu gạch ngang cho giá trị không đo được."""
    return '—' if value is None or value == '' else f'{float(value) * factor:.{decimals}f}'


def asr_table():
    """Bảng ASR dùng một hàng mỗi model, chế độ, ngôn ngữ và nhóm độ dài."""
    source = OUT / 'asr-summary.json'
    if not source.exists():
        return
    records = json.loads(source.read_text(encoding='utf-8'))
    print('## ASR theo ngôn ngữ và độ dài\n')
    print('| Model / chế độ | Nhóm | Clip / lượt | WER % | WER_no_num % | CER % | Recall % | p50 s | p95 s | RTF | Peak MiB | Load s |')
    print('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
    for r in records:
        label = r['bucket'].replace('<', '≤').replace('≤=', '≤')
        values = [f"{r['engine']} / {r['mode']}", f"{r['lang'].upper()} {label}",
                  f"{r['clips']} / {r['runs']}",
                  *(format_value(r[k], 100, 1) for k in ['wer', 'WER_no_num', 'cer', 'term_recall']),
                  *(format_value(r[k], .001) for k in ['p50_ms', 'p95_ms']),
                  format_value(r['rtf']), format_value(r['peak_ram_mib'], 1, 0),
                  format_value(r['load_ms'], .001)]
        print('| ' + ' | '.join(values) + ' |')
    print('\n### Trạng thái lượt chạy ASR\n')
    print('| Model | Trạng thái tiến trình | Lượt thành công / tổng |')
    print('| --- | --- | ---: |')
    all_rows = defaultdict(list)
    with (OUT / 'results.csv').open(encoding='utf-8') as stream:
        for row in csv.DictReader(stream):
            all_rows[row['engine']].append(row)
    status_file = OUT / 'asr-model-status.json'
    states = json.loads(status_file.read_text(encoding='utf-8')) if status_file.exists() else {}
    for engine in sorted(set(all_rows) | set(states)):
        rows = all_rows[engine]
        good = sum(row['status'] == 'ok' for row in rows)
        status = states.get(engine, {}).get('status', 'chưa có trạng thái')
        if status == 'ok' and good < len(rows):
            status = 'partial' if good else 'error'
        print(f'| {engine} | {status} | {good}/{len(rows)} |')
    print('\n### Thuật ngữ theo model\n')
    terms = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for record in records:
        items = terms[record['engine'], record['mode']]
        for term, (hit, total) in record['terms'].items():
            items[term][0] += hit
            items[term][1] += total
    print('| Model / chế độ | Recall theo lượt xuất hiện | Lượt nhận đúng / xuất hiện theo thuật ngữ |')
    print('| --- | ---: | --- |')
    for (engine, mode), values in sorted(terms.items()):
        if values:
            hits, count = map(sum, zip(*values.values()))
            details = ', '.join(f'{term} {a}/{b}' for term, (a, b) in sorted(values.items()))
            print(f'| {engine} / {mode} | {hits}/{count} ({hits / count:.1%}) | {details} |')


def tts_table():
    """Bảng TTS tách SDK, WAV/PCM HTTP và cặp câu qua normalizer."""
    groups = defaultdict(list)
    for path in sorted((OUT / 'tts').glob('*.csv')):
        with path.open(encoding='utf-8') as stream:
            for row in csv.DictReader(stream):
                key = (row['engine'], row['interface'], row['format'] or '—', row['normalized'])
                groups[key].append(row)
    print('\n## TTS theo cấu hình và đường gọi\n')
    print('| Engine | Đường gọi | Normalizer backend | Lượt đạt / tổng | TTFA p50/p95 ms | Tổng p50/p95 s | RTF p50 | Peak MiB | Load s |')
    print('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
    for (engine, method, fmt, normalized), records in sorted(groups.items()):
        good = [row for row in records if row['status'] == 'ok']
        start = f'| {engine} | {method} {fmt} | {"Có" if normalized == "True" else "Không"} | {len(good)}/{len(records)}'
        if not good:
            print(start + ' | — | — | — | — | — |')
            continue
        pairs = []
        for field, multiplier in [('ttfa_ms', 1), ('total_ms', .001)]:
            times = [float(row[field]) for row in good]
            pairs.append(' / '.join(format_value(percentile(times, q), multiplier) for q in (.5, .95)))
        rss = max((float(row['ram_mib']) for row in good if row['ram_mib']), default=None)
        rtf = statistics.median(float(row['rtf']) for row in good)
        print(start + f' | {pairs[0]} | {pairs[1]} | {rtf:.2f} | {format_value(rss, 1, 0)}'
              f' | {format_value(good[0]["load_ms"], .001)} |')


if __name__ == '__main__':
    asr_table()
    tts_table()
