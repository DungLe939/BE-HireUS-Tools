import type { VmiLanguage } from '../types/vmi.types';

export const STT_PROVIDER = Symbol('STT_PROVIDER');
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const DEFAULT_AUDIO_DURATION_MS = 195000;
export const STT_MIME = /^audio\/(?:webm|ogg|wav|x-wav|mpeg|mp3|mp4|m4a|x-m4a)(?:\s*;[^\r\n]*)?$/i;

/** The subset of an in-memory Multer upload that STT needs. */
export interface SttAudio { buffer: Buffer; mimetype: string; size: number }
export interface SttResult {
  text: string;
  language: VmiLanguage;
  /** Trusted decoded duration for validation; excluded from the public draft. */
  durationMs: number;
}
export interface SttProvider {
  transcribe(audio: SttAudio, language: VmiLanguage): Promise<SttResult>;
}
