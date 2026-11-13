import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('measure', Path(__file__).with_name('measure-stt-latency.py'))
measure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measure)


class WordErrorMetricTests(unittest.TestCase):
    def test_identity_ignores_case_and_punctuation(self):
        self.assertEqual(measure.word_errors('Tiếng Việt.', 'TIẾNG VIỆT')['wer'], 0)

    def test_substitution_insertion_deletion_are_counted(self):
        for ref, hyp, expected in [('a b', 'a c', (1, 0, 0)), ('a b', 'a', (0, 1, 0)), ('a b', 'a b c', (0, 0, 1))]:
            result = measure.word_errors(ref, hyp)
            self.assertEqual((result['substitutions'], result['deletions'], result['insertions']), expected)
            self.assertEqual(result['wer'], 0.5)

    def test_repeated_utterances_are_not_silently_deduplicated(self):
        self.assertEqual(measure.word_errors('a b a b a b', 'a b')['deletions'], 4)
