"""Kiểm tra phép đo và xử lý định dạng âm thanh mà không tải model."""
import unittest

from moss_adapter import strip_tags
from report_asr import duration_bucket, flags, no_numbers, score, term_counts
from run_tts import wav_offset


class BenchmarkTests(unittest.TestCase):
    """Bảo vệ các trường hợp dễ làm sai kết quả khi đổi cách chuẩn hóa."""

    def test_no_numbers(self):
        # Hai cách đọc/viết số cho cùng chuỗi sau chuẩn hóa.
        self.assertEqual(no_numbers('chờ 180 giây và giảm 10%', 'vi'),
                         no_numbers('chờ một trăm tám mươi giây và giảm mười phần trăm', 'vi'))
        self.assertEqual(no_numbers('latency is one hundred and eighty milliseconds', 'en'),
                         no_numbers('latency is 180 milliseconds', 'en'))
        self.assertEqual(no_numbers('em không biết', 'vi'), 'em không biết')

    def test_terms(self):
        # cache và caching là hai thuật ngữ tách biệt, CI/CD vẫn khớp sau bỏ dấu câu.
        self.assertEqual(term_counts('cache CACHE CI/CD', 'Caching ci cd cache', 'vi'),
                         {'cache': (1, 2), 'CI/CD': (1, 1)})
        self.assertEqual(term_counts('caching', 'cache', 'vi'), {'caching': (0, 1)})

    def test_natural(self):
        # NATURAL có RTF nhưng không có đáp án để tính WER.
        row = score({'label': 'NATURAL', 'duration_s': 80, 'latency_ms': 8000, 'status': 'ok'})
        self.assertNotIn('wer', row)
        self.assertEqual(row['rtf'], .1)
        self.assertIn('lặp', flags('xin chào xin chào xin chào xin chào', [], 'vi'))
        self.assertNotIn('lặp', flags('xin chào xin chào xin chào', [], 'vi'))

    def test_moss_tags(self):
        # Dấu số chỉ bị bỏ nếu nằm trong thẻ timestamp.
        self.assertEqual(strip_tags('[0.48][S01]chờ 180 giây[1.66][2][S02]xong[3]'),
                         'chờ 180 giây xong')

    def test_duration_edges(self):
        # Không đếm clip ở biên độ dài vào hai nhóm.
        self.assertEqual([duration_bucket(s) for s in [20, 20.01, 45, 45.01, 60, 60.01]],
                         ['<=20s', '20-45s', '20-45s', '45-60s', '45-60s', '>60s'])

    def test_wav_first_audio(self):
        # Cần tìm chunk data và chỉ coi TTFA bắt đầu khi có mẫu thật.
        header = (b'RIFF\xff\xff\xff\xffWAVEfmt ' + (16).to_bytes(4, 'little')
                  + bytes(16) + b'data\xff\xff\xff\xff')
        self.assertIsNone(wav_offset(header[:40]))
        self.assertEqual(wav_offset(header), 44)


if __name__ == '__main__':
    unittest.main()
