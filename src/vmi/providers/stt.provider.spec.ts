import { WhisperSttProvider } from './whisper-stt.provider';
import { VmiLanguage } from '../types/vmi.types';

describe('WhisperSttProvider (mock HTTP)', () => {
  const environment = { ...process.env };
  const provider = new WhisperSttProvider();
  const audio = { buffer: Buffer.from('audio fixture'), mimetype: 'audio/wav', size: 13 };
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    process.env.WHISPER_STT_BASE_URL = 'http://127.0.0.1:8001';
    process.env.WHISPER_STT_TIMEOUT_MS = '30000';
    delete process.env.VMI_AUDIO_MAX_DURATION_MS;
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ text: 'Draft fixture', language: 'vi', durationMs: 1000 }));
  });
  afterEach(() => { process.env = { ...environment }; jest.restoreAllMocks(); });
  it.each([VmiLanguage.VI, VmiLanguage.EN])('sends multipart audio and trusted language %s', async language => {
    fetchMock.mockResolvedValue(Response.json({ text: 'Draft fixture', language, durationMs: 1000 }));
    expect(await provider.transcribe(audio, language)).toEqual({ text: 'Draft fixture', language, durationMs: 1000 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8001/transcribe');
    expect(init?.method).toBe('POST');
    const form = init!.body as FormData;
    expect(form.get('language')).toBe(language);
    expect(Buffer.from(await (form.get('audio') as Blob).arrayBuffer())).toEqual(audio.buffer);
  });
  it.each([400, 429, 500, 503, 504])('sanitizes HTTP %i', async status => {
    fetchMock.mockResolvedValue(new Response('private http://secret-internal key-fixture', { status }));
    try { await provider.transcribe(audio, VmiLanguage.VI); throw new Error('Expected failure'); }
    catch (error) {
      expect(error).toMatchObject({ response: { code: status === 504 ? 'VMI_STT_TIMEOUT' : 'VMI_STT_UNAVAILABLE' } });
      expect(JSON.stringify(error)).not.toMatch(/secret-internal|key-fixture|private/);
    }
  });
  it.each([null, {}, { text: 1, language: 'vi', durationMs: 1 }, { text: 'x', language: 'en', durationMs: 1 },
    { text: 'x', language: 'vi', durationMs: -1 }, { text: 'x', language: 'vi', durationMs: '1000' }])('rejects bad JSON %#', async body => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(provider.transcribe(audio, VmiLanguage.VI)).rejects.toMatchObject({ status: 502 });
  });
  it('rejects malformed JSON', async () => {
    fetchMock.mockResolvedValue(new Response('{'));
    await expect(provider.transcribe(audio, VmiLanguage.VI)).rejects.toMatchObject({ status: 502 });
  });
  it('rejects empty recognized text', async () => {
    fetchMock.mockResolvedValue(Response.json({ text: '  ', language: 'vi', durationMs: 1000 }));
    await expect(provider.transcribe(audio, VmiLanguage.VI)).rejects.toMatchObject({ status: 422, response: { code: 'VMI_STT_EMPTY_TRANSCRIPT' } });
  });
  it.each(['VMI_STT_EMPTY_TRANSCRIPT', 'VMI_STT_AUDIO_TOO_LONG'])('maps validation code %s from ASR safely', async code => {
    fetchMock.mockResolvedValue(Response.json({ detail: { code, private: 'never return' } }, { status: 422 }));
    await expect(provider.transcribe(audio, VmiLanguage.VI)).rejects.toMatchObject({ status: 422, response: { code } });
  });
  it('validates the decoded duration independently of the client', async () => {
    fetchMock.mockResolvedValue(Response.json({ text: 'Draft', language: 'vi', durationMs: 195001 }));
    await expect(provider.transcribe(audio, VmiLanguage.VI)).rejects.toMatchObject({ status: 422, response: { code: 'VMI_STT_AUDIO_TOO_LONG' } });
  });
  it('sanitizes network failure', async () => {
    fetchMock.mockRejectedValue(new Error('private audio http://internal key-fixture'));
    await expect(provider.transcribe(audio, VmiLanguage.VI)).rejects.toMatchObject({ response: { code: 'VMI_STT_UNAVAILABLE' } });
  });
  it('times out both fetch and JSON body read', async () => {
    process.env.WHISPER_STT_TIMEOUT_MS = '5';
    for (const bodyRead of [false, true]) {
      fetchMock.mockImplementation(async (_url, init) => {
        const pending = () => new Promise<never>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
        return bodyRead ? { ok: true, json: pending } as unknown as Response : pending();
      });
      await expect(provider.transcribe(audio, VmiLanguage.VI)).rejects.toMatchObject({ response: { code: 'VMI_STT_TIMEOUT' } });
    }
  });
  it.each(['', '0', 'bad', '2147483648'])('rejects invalid timeout %s', async value => {
    process.env.WHISPER_STT_TIMEOUT_MS = value;
    await expect(provider.transcribe(audio, VmiLanguage.VI)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
