"""Adapter thử ba lớp Auto trên snapshot MOSS đã duyệt mã và khóa SHA-256."""
import hashlib
import re
import time
from pathlib import Path

from audio_io import decode_mono

REVISION = 'd930a0b2d78f47abed5943d240c859c320454828'
CHECKSUMS = {
    'configuration_moss_transcribe_diarize.py': 'b4d12b0f4609af69b61c2fe3aa5fbaf476af22278369e4540745bc47d1d37892',
    'modeling_moss_transcribe_diarize.py': 'a01da90fe1f7cb88942b8c56f443e7b4ecd307ed4b4c356ac08d7503dd7422c1',
    'processing_moss_transcribe_diarize.py': '6f228d22d9379e2f6a6830b18ce7336b22da8267547e96e65545d871d7f48766',
}


def strip_tags(text):
    """Chỉ bỏ timestamp số và mã người nói; giữ số trong lời nói."""
    return ' '.join(re.sub(r'\[(?:S\d+|\d+(?:[.,]\d+)?)\]', ' ', text,
                           flags=re.IGNORECASE).split())


def load_moss(engine):
    """Nạp bản cục bộ đã đối chiếu checksum, với chế độ offline."""
    import torch
    import transformers

    path = Path(__file__).resolve().parent / 'envs' / 'sources' / f'moss-{REVISION}'
    source_files = {p.name for p in path.rglob('*.py')}
    if source_files != CHECKSUMS.keys():
        raise ValueError('Danh sách Python trong snapshot khác bản đã duyệt.')
    for file, digest in CHECKSUMS.items():
        if hashlib.sha256((path / file).read_bytes()).hexdigest() != digest:
            raise ValueError(f'Checksum MOSS thay đổi: {file}')
    class_name = {
        'moss-speech': 'AutoModelForSpeechSeq2Seq',
        'moss-multimodal': 'AutoModelForMultimodalLM',
        'moss-causal': 'AutoModelForCausalLM',
    }[engine]
    cls = getattr(transformers, class_name)
    kwargs = {'trust_remote_code': True, 'local_files_only': True}
    model = cls.from_pretrained(str(path), dtype=torch.float32, attn_implementation='sdpa',
                                use_safetensors=True, **kwargs).eval()
    processor = transformers.AutoProcessor.from_pretrained(str(path), **kwargs)
    # Không đưa thuật ngữ đáp án vào prompt để tránh làm lệch phép đo.
    messages = [{'role': 'user', 'content': [
        {'type': 'audio', 'audio': 'clip'},
        {'type': 'text', 'text': 'Transcribe the speech with timestamps and speaker labels.'},
    ]}]
    prompt = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

    def transcribe(path, _lang):
        """Trả phiên âm nguyên ngữ sau khi bỏ tag của model."""
        began = time.perf_counter()
        audio = decode_mono(path)
        inputs = processor(text=prompt, audio=audio, return_tensors='pt')
        with torch.inference_mode():
            tokens = model.generate(**inputs, max_new_tokens=1024, do_sample=False)
        text = processor.tokenizer.decode(tokens[0, inputs['input_ids'].shape[1]:],
                                          skip_special_tokens=True)
        return {'text': strip_tags(text), 'latency_ms': (time.perf_counter() - began) * 1000}

    return transcribe
