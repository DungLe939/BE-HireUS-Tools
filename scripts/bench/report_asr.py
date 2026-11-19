"""Tổng hợp CSV, bảng đối chiếu nghe lại và số liệu ASR từ các lượt đã chạy."""
import csv
import difflib
import html
import json
import re
import runpy
import statistics
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent
OUT = BASE / 'out'
EVAL = runpy.run_path(str(BASE.parent / 'eval-real-voice.py'))
NORMALIZE = EVAL['normalize_for_eval']
TRUTHS = EVAL['GROUND_TRUTHS']
TERMS = EVAL['TERMS']

VI_UNIT = 'không một hai ba bốn năm sáu bảy tám chín mốt tư lăm'.split()
VI_SCALE = 'mười mươi trăm nghìn ngàn triệu tỷ tỉ'.split()
EN_SINGLE = ('zero one two three four five six seven eight nine ten eleven twelve thirteen '
             'fourteen fifteen sixteen seventeen eighteen nineteen').split()
EN_SCALE = ('twenty thirty forty fifty sixty seventy eighty ninety hundred thousand '
            'million billion trillion').split()


def no_numbers(text, lang):
    """Loại token có chữ số và cụm số viết bằng chữ rồi mới chấm WER."""
    tokens = NORMALIZE(text, lang).split()
    singles, scales = (VI_UNIT, VI_SCALE) if lang == 'vi' else (EN_SINGLE, EN_SCALE)
    numbers = set(singles + scales)
    filler = {'linh', 'lẻ', 'phẩy'} if lang == 'vi' else {'and', 'point'}
    prefixes = {'âm', 'dương'} if lang == 'vi' else {'minus', 'negative', 'positive'}
    suffixes = [('phần', 'trăm')] if lang == 'vi' else [('per', 'cent'), ('percent',)]
    kept = []
    index = 0
    while index < len(tokens):
        start = index
        if tokens[index] in prefixes and index + 1 < len(tokens):
            index += 1
        token = tokens[index]
        if token not in numbers and not any(ch.isdigit() for ch in token):
            kept.append(tokens[start])
            index = start + 1
            continue
        index += 1
        while index < len(tokens):
            token = tokens[index]
            if token in numbers or any(ch.isdigit() for ch in token):
                index += 1
            elif token in filler and index + 1 < len(tokens) and tokens[index + 1] in numbers:
                index += 1
            else:
                break
        for suffix in suffixes:
            if tuple(tokens[index:index + len(suffix)]) == suffix:
                index += len(suffix)
                break
        # Các từ Việt đa nghĩa đi riêng được giữ, ví dụ “trong năm qua”.
        if index == start + 1 and tokens[start] in {'không', 'năm', 'tư', 'lẻ'}:
            kept.append(tokens[start])
    return ' '.join(kept)


def term_counts(ref, hyp, lang):
    """Đếm số lần xuất hiện cả cụm, không coi cache là caching."""
    ref, hyp = (NORMALIZE(text, lang) for text in (ref, hyp))
    scores = {}
    for term in TERMS:
        pattern = rf'(?<!\w){re.escape(NORMALIZE(term, lang))}(?!\w)'
        total = len(re.findall(pattern, ref))
        if total:
            scores[term] = (min(total, len(re.findall(pattern, hyp))), total)
    return scores


def score(row):
    """Tính điểm mỗi lượt có đáp án và loại lỗi kỹ thuật khỏi thống kê."""
    row = {**row, 'bucket': duration_bucket(row['duration_s'])}
    if row['status'] != 'ok':
        return row
    row['rtf'] = row['latency_ms'] / (1000 * row['duration_s'])
    if row['label'] != 'NATURAL':
        ref, hyp, lang = TRUTHS[row['label']], row['text'], row['lang']
        numeric_ref = no_numbers(ref, lang)
        terms = term_counts(ref, hyp, lang)
        row.update(wer=EVAL['compute_wer'](ref, hyp, lang)['wer'],
                   WER_no_num=EVAL['compute_wer'](numeric_ref, no_numbers(hyp, lang), lang)['wer']
                   if numeric_ref else None, cer=EVAL['compute_cer'](ref, hyp, lang)['cer'],
                   term_recall=sum(a for a, _ in terms.values()) / sum(b for _, b in terms.values())
                   if terms else None, terms=json.dumps(terms, ensure_ascii=False))
    return row


def duration_bucket(seconds):
    """Phân nhóm độ dài theo các mốc yêu cầu."""
    if seconds <= 20:
        return '<=20s'
    if seconds <= 45:
        return '20-45s'
    if seconds <= 60:
        return '45-60s'
    return '>60s'


def flags(text, peers, lang):
    """Gắn cờ đoạn lặp, trống hoặc dài hơn hai lần trung vị các model khác."""
    words = NORMALIZE(text, lang).split()
    issues = []
    if not words:
        issues.append('rỗng')
    elif peers and statistics.median(peers) > 0 and len(words) > 2 * statistics.median(peers):
        issues.append('dài hơn 2× trung vị model khác')
    if any(words[i:i + n] == words[i + n:i + 2*n] == words[i + 2*n:i + 3*n]
           == words[i + 3*n:i + 4*n]
           for n in range(1, len(words) // 4 + 1) for i in range(len(words) - 4*n + 1)):
        issues.append('cụm lặp ≥4 lần liên tiếp')
    return ', '.join(issues)


def highlight(ref, hyp, lang):
    """Tô phần khác đáp án, giữ nguyên cách viết của model khi hiển thị."""
    reference = NORMALIZE(ref, lang).split()
    original = hyp.split()
    normalized = []
    owner = []
    for index, token in enumerate(original):
        tokens = NORMALIZE(token, lang).split()
        normalized.extend(tokens)
        owner.extend([index] * len(tokens))
    wrong = set()
    missing = defaultdict(list)
    for tag, i, j, k, l in difflib.SequenceMatcher(None, reference, normalized, autojunk=False).get_opcodes():
        if tag != 'equal':
            wrong.update(owner[k:l])
        if tag in {'delete', 'replace'}:
            missing[owner[k] if k < len(owner) else len(original)].extend(reference[i:j])
    parts = []
    for index in range(len(original) + 1):
        if missing[index]:
            parts.append('<del>' + html.escape(' '.join(missing[index])) + '</del>')
        if index < len(original):
            token = html.escape(original[index])
            parts.append(f'<mark>{token}</mark>' if index in wrong else token)
    return ' '.join(parts)


def write_compare(rows, out):
    """Tạo bảng nghe lại có ghi chú cục bộ và bản Markdown đi kèm."""
    sections, md = [], ['# Đối chiếu transcript ASR', '']
    clips = defaultdict(dict)
    for row in rows:
        variants = clips[row['file']]
        key = (row['engine'], row['mode'])
        if key not in variants or variants[key]['status'] != 'ok':
            variants[key] = row
    for file, variants in sorted(clips.items()):
        group = list(variants.values())
        label, lang = group[0]['label'], group[0]['lang']
        ref = TRUTHS.get(label)
        src = Path(group[0]['path']).as_uri()
        cards = []
        md.extend([f'## {file} · {label}', '', f'[Phát clip]({src})', '',
                   f'Đáp án: {ref or "Không có đáp án"}', ''])
        for row in group:
            name = row['engine'] + ' / ' + row['mode']
            text = row['text']
            warning = ''
            if row['status'] != 'ok':
                text = row.get('error', 'Lượt chạy lỗi')
                warning = 'Lượt chạy lỗi'
                view = html.escape(text)
            elif ref is None:
                peers = [len(NORMALIZE(peer['text'], lang).split()) for peer in group
                         if peer['engine'] != row['engine'] and peer['status'] == 'ok']
                warning = flags(text, peers, lang)
                view = html.escape(text)
            else:
                view = highlight(ref, text, lang)
                terms = json.loads(row.get('terms', '{}'))
                missing = [f'{term} ({a}/{b})' for term, (a, b) in terms.items() if a < b]
                warning = f'Thiếu thuật ngữ: {", ".join(missing)}' if missing else ''
            cards.append(f'<article><h3>{html.escape(name)}</h3><p>{view}</p>'
                         f'<p class="warn">{html.escape(warning)}</p></article>')
            md.extend([f'### {name}', '', view or '*(rỗng)*', '', warning, ''])
        sections.append(f'<section><h2>{html.escape(file)} · {label}</h2>'
                        f'<audio controls preload="none" src="{html.escape(src, quote=True)}"></audio>'
                        f'<p><strong>Đáp án:</strong> {html.escape(ref or "Không có đáp án")}</p>'
                        f'<div class="grid">{"".join(cards)}</div><label>Ghi chú '
                        f'<textarea data-clip="{html.escape(file, quote=True)}"></textarea></label></section>')
        md.extend(['**Ghi chú:**', ''])
    (out / 'compare.html').write_text(
        '<!doctype html><html lang="vi"><meta charset="utf-8"><title>Đối chiếu ASR VMI</title>'
        '<style>body{font:16px system-ui;max-width:1500px;margin:2rem auto;padding:0 1rem}'
        'section{border-top:1px solid #aaa;padding:1em 0}.grid{display:grid;gap:.8em;'
        'grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}article{padding:.8em;'
        'background:#f2f2f2;border-radius:.4em;overflow-wrap:anywhere}'
        'del{color:#923012;margin-right:.25em}.warn{color:#923012}textarea{display:block;width:98%;margin:.5em 0}'
        '</style><h1>Đối chiếu ASR VMI</h1><p>Tô vàng: từ khác đáp án. Gạch ngang: từ bị bỏ hoặc thay.</p>'
        + ''.join(sections) + '<script>for (const box of document.querySelectorAll("textarea")) {'
        'const key="vmi-note:"+box.dataset.clip;try{box.value=localStorage.getItem(key)||"";'
        'box.addEventListener("input",()=>localStorage.setItem(key,box.value));}catch{}}</script></html>',
        encoding='utf-8')
    (out / 'compare.md').write_text('\n'.join(md), encoding='utf-8')


def percentile(values, q):
    """Nội suy tuyến tính theo vị trí trong danh sách đã sắp xếp."""
    ordered = sorted(values)
    pos = (len(ordered) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


def summarize(rows):
    """Tách số liệu theo ngôn ngữ và độ dài; chất lượng lấy lượt hợp lệ đầu tiên mỗi clip."""
    groups = defaultdict(list)
    for row in rows:
        if row['status'] == 'ok':
            groups[row['engine'], row['mode'], row['lang'], row['bucket']].append(row)
    result = []
    for (engine, mode, lang, bucket), group in sorted(groups.items()):
        first = {row['file']: row for row in reversed(group)}
        terms = defaultdict(lambda: [0, 0])
        for row in first.values():
            for term, (hit, total) in json.loads(row.get('terms', '{}')).items():
                terms[term][0] += hit
                terms[term][1] += total
        stat = dict(engine=engine, mode=mode, lang=lang, bucket=bucket, clips=len(first),
                    runs=len(group), terms=dict(terms))
        for field in ('wer', 'WER_no_num', 'cer'):
            vals = [row[field] for row in first.values() if row.get(field) is not None]
            stat[field] = statistics.mean(vals) if vals else None
        stat.update(p50_ms=percentile([r['latency_ms'] for r in group], .5),
                    p95_ms=percentile([r['latency_ms'] for r in group], .95),
                    rtf=statistics.mean(r['rtf'] for r in group),
                    peak_ram_mib=max(r['peak_ram_mib'] or 0 for r in group),
                    load_ms=group[0]['load_ms'],
                    term_recall=sum(a for a, _ in terms.values()) / sum(b for _, b in terms.values())
                    if terms else None)
        result.append(stat)
    return result


def main():
    """Ghi kết quả thô và dữ liệu tổng hợp để lập báo cáo."""
    rows = []
    status_dir = OUT / 'asr'
    statuses = {path.name.removesuffix('.status.json'): json.loads(path.read_text(encoding='utf-8'))
                for path in status_dir.glob('*.status.json')}
    for path in sorted(status_dir.glob('*.jsonl')):
        if statuses.get(path.stem, {}).get('status') == 'missing':
            continue
        for line in path.read_text(encoding='utf-8').splitlines():
            try:
                rows.append(score(json.loads(line)))
            except json.JSONDecodeError:
                # Worker bị dừng giữa lượt có thể để lại một dòng chưa hoàn chỉnh.
                print(f'Bỏ qua dòng JSON chưa hoàn chỉnh trong {path.name}.')
    fields = ['engine', 'mode', 'file', 'lang', 'label', 'bucket', 'duration_s', 'run', 'status',
              'latency_ms', 'rtf', 'load_ms', 'peak_ram_mib', 'wer', 'WER_no_num', 'cer',
              'term_recall', 'terms', 'text', 'error']
    with (OUT / 'results.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)
    write_compare(rows, OUT)
    (OUT / 'asr-summary.json').write_text(json.dumps(summarize(rows), ensure_ascii=False, indent=2),
                                          encoding='utf-8')
    (OUT / 'asr-model-status.json').write_text(json.dumps(statuses, ensure_ascii=False, indent=2),
                                               encoding='utf-8')
    print(f'Đã tổng hợp {len(rows)} lượt ASR.')


if __name__ == '__main__':
    main()
