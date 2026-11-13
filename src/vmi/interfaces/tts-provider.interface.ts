import type { VmiLanguage } from '../types/vmi.types';

export const TTS_PROVIDER = Symbol('TTS_PROVIDER');
export interface TtsProvider {
  /** Buffered PCM 16-bit mono 44100 Hz WAV; no persistence. */
  synthesize(questionText: string, language: VmiLanguage): Promise<Buffer>;
}
