import { Injectable } from '@nestjs/common';
import { VmiLanguage } from '../types/vmi.types';
import { normalizeTtsText } from '../utils/tts-text-normalizer.util';
import { HttpWavTtsProvider } from './http-wav-tts.provider';

const WYATT = 'default_34370fd91e3484ef';

/** Giữ nguyên cách gọi Zonos khi dùng cấu hình hiện tại. */
@Injectable()
export class ZonosTtsProvider extends HttpWavTtsProvider {
  /** Tạo request theo giao diện native của Zonos. */
  protected request(questionText: string, language: VmiLanguage) {
    return {
      baseUrl: process.env.ZONOS_TTS_BASE_URL ?? 'http://127.0.0.1:1919',
      rawTimeout: process.env.ZONOS_TTS_TIMEOUT_MS ?? '30000',
      body: {
        model: 'zonos3',
        input: normalizeTtsText(questionText, language),
        language: language === VmiLanguage.VI ? 'vi' : 'en_us',
        voice: (language === VmiLanguage.VI ? process.env.ZONOS_TTS_VOICE_VI
          : process.env.ZONOS_TTS_VOICE_EN)?.trim() || WYATT,
        response_format: 'wav',
      },
    };
  }
}
