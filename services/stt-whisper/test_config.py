import os
import unittest
from unittest.mock import patch, Mock
import sys
from types import SimpleNamespace
import main


class WhisperConfigTests(unittest.TestCase):
    def config(self, **environment):
        with patch.dict(os.environ, environment, clear=True), patch.object(main, 'available_cpu_threads', return_value=4):
            return main.whisper_config()

    def test_cpu_defaults_and_gpu_defaults(self):
        cpu = self.config()
        self.assertEqual((cpu.model, cpu.device, cpu.compute_type, cpu.cpu_threads), ('small', 'cpu', 'int8', 4))
        self.assertEqual((cpu.beam_size, cpu.vad_filter, cpu.condition_on_previous_text), (5, False, True))
        gpu = self.config(WHISPER_DEVICE='cuda')
        self.assertEqual((gpu.model, gpu.compute_type), ('large-v3-turbo', 'float16'))

    def test_explicit_model_threads_compute_and_beam(self):
        for model in ['base', 'small', 'medium', 'large-v3-turbo']:
            cfg = self.config(WHISPER_MODEL=model, WHISPER_CPU_THREADS='3', WHISPER_COMPUTE_TYPE='float32', WHISPER_BEAM_SIZE='5')
            self.assertEqual((cfg.model, cfg.cpu_threads, cfg.compute_type, cfg.beam_size), (model, 3, 'float32', 5))

    def test_bad_configuration_fails_before_model_download(self):
        for key, values in {
            'WHISPER_MODEL': ['', 'giant'], 'WHISPER_DEVICE': ['', 'gpu'],
            'WHISPER_CPU_THREADS': ['', '0', '-1', '65', 'x', '2.5'],
            'WHISPER_BEAM_SIZE': ['', '0', '11', 'x'], 'WHISPER_COMPUTE_TYPE': ['', 'not-a-type'],
            'WHISPER_VAD_FILTER': ['yes', '2'], 'WHISPER_CONDITION_ON_PREVIOUS_TEXT': ['no'],
        }.items():
            for value in values:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError): self.config(**{key: value})

    def test_configured_flags(self):
        cfg = self.config(WHISPER_VAD_FILTER='false', WHISPER_CONDITION_ON_PREVIOUS_TEXT='true', WHISPER_BEAM_SIZE='3')
        self.assertEqual((cfg.vad_filter, cfg.condition_on_previous_text, cfg.beam_size), (False, True, 3))

    def test_thread_default_is_bounded_and_respects_visible_cores(self):
        with patch.object(main.os, 'process_cpu_count', return_value=2): self.assertLessEqual(main.available_cpu_threads(), 2)
        with patch.object(main.os, 'process_cpu_count', return_value=128): self.assertLessEqual(main.available_cpu_threads(), 4)


    def test_factory_passes_configuration_to_mock_model(self):
        cfg = self.config(WHISPER_MODEL='medium', WHISPER_CPU_THREADS='3')
        factory = Mock()
        with patch.dict(sys.modules, {'faster_whisper': SimpleNamespace(WhisperModel=factory)}), patch.dict(os.environ, {}, clear=True):
            main.create_model(cfg)
        factory.assert_called_once_with('medium', device='cpu', compute_type='int8', cpu_threads=3, num_workers=1, download_root=None)
