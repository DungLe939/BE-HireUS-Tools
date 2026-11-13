import type { SttAudio, SttProvider, SttResult } from '../interfaces/stt-provider.interface';
import type { VmiLanguage } from '../types/vmi.types';

/** Deterministic draft fixture, never registered by VmiModule. */
export class FakeSttProvider implements SttProvider {
  async transcribe(_audio: SttAudio, language: VmiLanguage): Promise<SttResult> {
    return { text: 'Draft fixture', language, durationMs: 1000 };
  }
}
