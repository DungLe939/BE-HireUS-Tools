"""Thử xuất checkpoint PhoWhisper sang CTranslate2 int8 để chạy faster-whisper."""
import argparse
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    """Xuất tokenizer đi cùng model để adapter không rơi về tokenizer khác."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('size', choices=['base', 'small'])
    size = parser.parse_args().size
    os.environ.setdefault('HF_HOME', str(ROOT / 'envs' / 'models'))
    from ctranslate2.converters import TransformersConverter
    from transformers import AutoProcessor

    model = f'vinai/PhoWhisper-{size}'
    dest = ROOT / 'envs' / 'converted' / f'pho-{size}-ct2'
    converter = TransformersConverter(model)
    converter.convert(str(dest), quantization='int8', force=True)
    AutoProcessor.from_pretrained(model).save_pretrained(dest)
    if not (dest / 'tokenizer.json').is_file():
        raise FileNotFoundError('Bản export thiếu tokenizer.json.')
    print(f'Đã chuyển {model} sang {dest}')


if __name__ == '__main__':
    main()
