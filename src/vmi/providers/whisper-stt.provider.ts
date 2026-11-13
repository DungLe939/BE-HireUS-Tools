import { BadGatewayException, GatewayTimeoutException, Injectable, PayloadTooLargeException, ServiceUnavailableException, UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { SttAudio, SttProvider, SttResult } from '../interfaces/stt-provider.interface';
import { DEFAULT_AUDIO_DURATION_MS } from '../interfaces/stt-provider.interface';
import type { VmiLanguage } from '../types/vmi.types';

@Injectable()
export class WhisperSttProvider implements SttProvider {
  async transcribe(audio: SttAudio, language: VmiLanguage): Promise<SttResult> {
    const rawTimeout = process.env.VMI_STT_TIMEOUT_MS?.trim() || (process.env.WHISPER_STT_TIMEOUT_MS ?? '600000');
    const timeout = Number(rawTimeout);
    const rawDuration = process.env.VMI_AUDIO_MAX_DURATION_MS ?? String(DEFAULT_AUDIO_DURATION_MS);
    const maxDuration = Number(rawDuration);
    let url: URL;
    try {
      url = new URL(process.env.WHISPER_STT_BASE_URL ?? 'http://127.0.0.1:8001');
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { throw this.failure(503); }
    if (!/^\d+$/.test(rawTimeout) || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647 ||
      !/^\d+$/.test(rawDuration) || !Number.isSafeInteger(maxDuration) || maxDuration < 180000 || maxDuration > 600000) throw this.failure(503);
    url.pathname = url.pathname.replace(/\/$/, '') + '/transcribe';
    const form = new FormData();
    form.set('audio', new Blob([new Uint8Array(audio.buffer)], { type: audio.mimetype }), 'recording');
    form.set('language', language);
    const signal = AbortSignal.timeout(timeout);
    let response: Response;
    try {
      response = await fetch(url.toString(), { method: 'POST', signal, redirect: 'error', body: form });
      signal.throwIfAborted();
    } catch { throw this.failure(signal.aborted ? 504 : 503); }
    if (!response.ok) {
      if (response.status === 413) throw new PayloadTooLargeException('Audio exceeds the upload limit.');
      if (response.status === 415) throw new UnsupportedMediaTypeException({ statusCode: 415, error: 'Unsupported Media Type', code: 'VMI_STT_UNSUPPORTED_AUDIO', message: 'Provide valid supported audio.' });
      if (response.status === 422) {
        const detail = await this.readJson(response, signal);
        const code = detail && typeof detail === 'object' ? (detail as { detail?: { code?: unknown } }).detail?.code : undefined;
        if (code === 'VMI_STT_AUDIO_TOO_LONG' || code === 'VMI_STT_EMPTY_TRANSCRIPT') throw this.validation(code);
      }
      throw this.failure(response.status === 504 ? 504 : [429, 503].includes(response.status) ? 503 : 502);
    }
    const body = await this.readJson(response, signal);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw this.failure(502);
    const value = body as Record<string, unknown>;
    if (typeof value.text !== 'string' || value.text.length > 100000 || value.language !== language ||
      typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs <= 0) throw this.failure(502);
    if (value.durationMs > maxDuration) throw this.validation('VMI_STT_AUDIO_TOO_LONG');
    if (!value.text.trim()) throw this.validation('VMI_STT_EMPTY_TRANSCRIPT');
    return { text: value.text.trim(), language, durationMs: value.durationMs };
  }

  private async readJson(response: Response, signal: AbortSignal): Promise<unknown> {
    try { const body: unknown = await response.json(); signal.throwIfAborted(); return body; }
    catch { throw this.failure(signal.aborted ? 504 : 502); }
  }

  private validation(code: 'VMI_STT_AUDIO_TOO_LONG' | 'VMI_STT_EMPTY_TRANSCRIPT') {
    return new UnprocessableEntityException({ statusCode: 422, error: 'Unprocessable Entity', code,
      message: code === 'VMI_STT_AUDIO_TOO_LONG' ? 'Recording exceeds the duration limit.' : 'No speech recognized. Record again or type your answer.' });
  }

  private failure(status: number) {
    const body = { statusCode: status, error: status === 504 ? 'Gateway Timeout' : status === 503 ? 'Service Unavailable' : 'Bad Gateway',
      code: status === 504 ? 'VMI_STT_TIMEOUT' : 'VMI_STT_UNAVAILABLE', message: 'Speech recognition is unavailable. Record again or type your answer.' };
    return status === 504 ? new GatewayTimeoutException(body) : status === 503 ? new ServiceUnavailableException(body) : new BadGatewayException(body);
  }
}
