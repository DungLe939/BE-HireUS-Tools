import { ZonosTtsProvider } from './zonos-tts.provider';
import { FakeTtsProvider } from './fake-tts.provider';
import { Logger } from '@nestjs/common';
import { VmiLanguage } from '../types/vmi.types';

describe('ZonosTtsProvider (mock HTTP)', () => {
  const provider = new ZonosTtsProvider();
  const environment = { ...process.env };
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let wav: Buffer;
  beforeEach(async () => {
    process.env.ZONOS_TTS_BASE_URL = 'http://127.0.0.1:1919';
    process.env.ZONOS_TTS_TIMEOUT_MS = '30000';
    delete process.env.ZONOS_TTS_VOICE_VI; delete process.env.ZONOS_TTS_VOICE_EN;
    wav = await new FakeTtsProvider().synthesize();
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(wav, { headers: { 'Content-Type': 'audio/wav' } }));
  });
  afterEach(() => { process.env = { ...environment }; jest.restoreAllMocks(); });
  it.each([VmiLanguage.VI, VmiLanguage.EN])('uses verified native API and language %s', async language => {
    expect(await provider.synthesize('REST API 5%', language)).toEqual(wav);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:1919/v1/audio/speech', expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'zonos3', input: language === 'vi' ? 'rét ây pi ai năm phần trăm' : 'REST API 5%',
        language: language === 'vi' ? 'vi' : 'en_us', voice: 'default_34370fd91e3484ef', response_format: 'wav' }),
    }));
  });
  it('allows a configured speaker ID', async () => {
    process.env.ZONOS_TTS_VOICE_VI = 'configured-fixture-id';
    await provider.synthesize('Fixture', VmiLanguage.VI);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).voice).toBe('configured-fixture-id');
  });
  it.each([400, 422, 429, 500, 503, 504])('maps upstream HTTP %i without exposing details', async status => {
    fetchMock.mockResolvedValue(new Response('private text http://internal-secret fixture-key', { status }));
    try { await provider.synthesize('Private fixture', VmiLanguage.VI); throw new Error('Expected error'); }
    catch (error) {
      expect(error).toMatchObject({ response: { code: status === 504 ? 'VMI_TTS_TIMEOUT' : 'VMI_TTS_UNAVAILABLE' } });
      expect(JSON.stringify(error)).not.toMatch(/internal-secret|fixture-key|Private fixture/);
    }
  });
  it('sanitizes network errors and logs no content', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    fetchMock.mockRejectedValue(new Error('http://internal-secret fixture-key Private fixture'));
    await expect(provider.synthesize('Private fixture', VmiLanguage.VI)).rejects.toMatchObject({ response: { code: 'VMI_TTS_UNAVAILABLE' } });
    expect(log).not.toHaveBeenCalled();
  });
  it.each([Buffer.alloc(0), Buffer.from('not wav'), Buffer.from('RIFFfakeWAVE')])('rejects invalid/empty WAV %#', async bytes => {
    fetchMock.mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'audio/wav' } }));
    await expect(provider.synthesize('Fixture', VmiLanguage.VI)).rejects.toMatchObject({ status: 502 });
  });
  it('rejects a truncated WAV and incorrect sample format', async () => {
    for (const bytes of [wav.subarray(0, 44), Buffer.from(wav)]) {
      if (bytes.length > 44) bytes.writeUInt16LE(3, 20);
      fetchMock.mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'audio/wav' } }));
      await expect(provider.synthesize('Fixture', VmiLanguage.VI)).rejects.toMatchObject({ status: 502 });
    }
  });
  it('rejects JSON masquerading as audio', async () => {
    fetchMock.mockResolvedValue(Response.json({ detail: 'private fixture' }));
    await expect(provider.synthesize('Fixture', VmiLanguage.VI)).rejects.toMatchObject({ status: 502 });
  });
  it('times out during fetch and body streaming', async () => {
    process.env.ZONOS_TTS_TIMEOUT_MS = '5';
    for (const bodyRead of [false, true]) {
      fetchMock.mockImplementation(async (_url, init) => {
        if (!bodyRead) return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
        return new Response(new ReadableStream({ start(controller) {
          init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason), { once: true });
        } }), { headers: { 'Content-Type': 'audio/wav' } });
      });
      await expect(provider.synthesize('Fixture', VmiLanguage.VI)).rejects.toMatchObject({ response: { code: 'VMI_TTS_TIMEOUT' } });
    }
  });
  it.each(['', '0', 'bad', '2147483648'])('rejects invalid timeout %s', async value => {
    process.env.ZONOS_TTS_TIMEOUT_MS = value;
    await expect(provider.synthesize('Fixture', VmiLanguage.VI)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['file:///tmp/audio', 'http://user:secret@internal'])('rejects unsafe config %s', async value => {
    process.env.ZONOS_TTS_BASE_URL = value;
    await expect(provider.synthesize('Fixture', VmiLanguage.VI)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
