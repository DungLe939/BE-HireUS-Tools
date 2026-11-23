import { Injectable } from '@nestjs/common';
import { VmiLanguage } from '../types/vmi.types';
import { HttpWavTtsProvider } from './http-wav-tts.provider';

/** Gửi văn bản cho dịch vụ VieNeu cục bộ đã nạp hai giọng của VMI. */
@Injectable()
export class VieneuTtsProvider extends HttpWavTtsProvider {
  /** Chọn giọng theo phiên và để VieNeu tự chuẩn hóa văn bản. */
  protected request(questionText: string, language: VmiLanguage) {
    return {
      baseUrl: process.env.VIENEU_TTS_BASE_URL ?? 'http://127.0.0.1:1920',
      rawTimeout: process.env.VIENEU_TTS_TIMEOUT_MS ?? '30000',
      body: {
        input: questionText,
        voice: language === VmiLanguage.EN ? 'alba' : 'nhat-phong',
        response_format: 'wav',
      },
    };
  }
}
