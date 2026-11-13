import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('eval_refine', Path(__file__).with_name('eval-stt-refine.py'))
eval_refine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eval_refine)


class RefineMetricsTests(unittest.TestCase):
    def test_false_correction_tracks_correct_original_tokens_not_existing_errors(self):
        self.assertEqual(eval_refine.false_corrections('em dùng Jest để test', 'em dùng jazz để test', 'em dùng Jest để code', 'vi'),
                         [{'word': 'test', 'replacement': 'code', 'index': 4}])

    def test_false_correction_counts_deletion_of_originally_correct_word(self):
        self.assertEqual(eval_refine.false_corrections('I use Redis', 'I use Redis', 'I Redis', 'en'),
                         [{'word': 'use', 'replacement': '<deleted>', 'index': 1}])

    def test_metrics_and_terms_have_hand_checked_values(self):
        self.assertEqual(eval_refine.compute_wer('a b c d', 'a b e d')['wer'], .25)
        self.assertEqual(eval_refine.compute_cer('abcd', 'abed')['cer'], .25)
        self.assertEqual(eval_refine.term_results('Jest Redis', 'jazz Redis', 'Jest Redis', 'en'),
                         [{'term': 'Redis', 'category': 'kept_correct'}, {'term': 'Jest', 'category': 'corrected'}])

    def test_numeric_spellings_are_equivalent_without_rewriting_wrong_units(self):
        self.assertEqual(eval_refine.compute_wer('mười nghìn request tám mươi phần trăm hai trăm mili giây', '10 nghìn request 80% 200ms', 'vi')['wer'], 0)
        self.assertNotEqual(eval_refine.compute_wer('hai trăm mili giây', '200mg', 'vi')['wer'], 0)

    def test_term_matching_does_not_count_cache_inside_decache(self):
        self.assertEqual(eval_refine.term_results('cache', 'Decache', 'cache', 'vi'), [{'term': 'cache', 'category': 'corrected'}])
