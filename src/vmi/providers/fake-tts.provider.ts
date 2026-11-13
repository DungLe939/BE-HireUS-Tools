import type { TtsProvider } from '../interfaces/tts-provider.interface';

/** Deterministic silence fixture for tests; never registered by VmiModule. */
export class FakeTtsProvider implements TtsProvider {
  async synthesize(): Promise<Buffer> {
    const dataBytes = 882; // 10 ms at 44100 Hz, mono PCM16.
    const wav = Buffer.alloc(44 + dataBytes);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(dataBytes, 40);
    return wav;
  }
}
