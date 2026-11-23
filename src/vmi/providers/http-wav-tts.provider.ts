import { BadGatewayException, GatewayTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import type { TtsProvider } from '../interfaces/tts-provider.interface';
import type { VmiLanguage } from '../types/vmi.types';

const MAX_WAV_BYTES = 32 * 1024 * 1024;

interface WavRequest {
  baseUrl: string;
  rawTimeout: string;
  body: object;
}

/** Gọi dịch vụ phát giọng và giữ một định dạng WAV chung cho trình duyệt. */
export abstract class HttpWavTtsProvider implements TtsProvider {
  protected abstract request(questionText: string, language: VmiLanguage): WavRequest;

  /** Giới hạn thời gian và dung lượng ở cả phần header lẫn body. */
  async synthesize(questionText: string, language: VmiLanguage): Promise<Buffer> {
    const { baseUrl, rawTimeout, body } = this.request(questionText, language);
    const timeout = Number(rawTimeout);
    let url: URL;
    try {
      url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { throw this.failure(503); }
    if (!/^\d+$/.test(rawTimeout) || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647) throw this.failure(503);
    url.pathname = url.pathname.replace(/\/$/, '') + '/v1/audio/speech';
    const signal = AbortSignal.timeout(timeout);
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'POST', signal, redirect: 'error', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      signal.throwIfAborted();
    } catch { throw this.failure(signal.aborted ? 504 : 503); }
    if (!response.ok) throw this.failure(response.status === 504 ? 504 : [429, 503].includes(response.status) ? 503 : 502);
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (mime !== 'audio/wav' && mime !== 'audio/x-wav') { await response.body?.cancel().catch(() => undefined); throw this.failure(502); }
    let audio: Buffer;
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          signal.throwIfAborted();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_WAV_BYTES) throw new Error();
          chunks.push(value);
        }
      } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
      finally { reader.releaseLock(); }
      audio = Buffer.concat(chunks, size);
    } catch { throw this.failure(signal.aborted ? 504 : 502); }
    if (!this.validWav(audio)) throw this.failure(502);
    return audio;
  }

  /** Xác thực WAV PCM mono 44,1 kHz trước khi trả frontend. */
  private validWav(audio: Buffer): boolean {
    if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE' || audio.readUInt32LE(4) + 8 !== audio.length) return false;
    let validFormat = false;
    let nonemptyData = false;
    for (let offset = 12; offset + 8 <= audio.length;) {
      const tag = audio.toString('ascii', offset, offset + 4);
      const length = audio.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (start + length > audio.length) return false;
      if (tag === 'fmt ') validFormat = length >= 16 && audio.readUInt16LE(start) === 1 && audio.readUInt16LE(start + 2) === 1 &&
        audio.readUInt32LE(start + 4) === 44100 && audio.readUInt32LE(start + 8) === 88200 && audio.readUInt16LE(start + 12) === 2 && audio.readUInt16LE(start + 14) === 16;
      if (tag === 'data') nonemptyData = length > 0 && length % 2 === 0;
      offset = start + length + (length % 2);
    }
    return validFormat && nonemptyData;
  }

  /** Chỉ trả mã lỗi VMI, không đưa nội dung của dịch vụ vào lỗi. */
  private failure(status: number) {
    const body = { statusCode: status, error: status === 504 ? 'Gateway Timeout' : status === 503 ? 'Service Unavailable' : 'Bad Gateway',
      code: status === 504 ? 'VMI_TTS_TIMEOUT' : 'VMI_TTS_UNAVAILABLE', message: 'Question audio is unavailable. Retry or read the question text.' };
    return status === 504 ? new GatewayTimeoutException(body) : status === 503 ? new ServiceUnavailableException(body) : new BadGatewayException(body);
  }
}
