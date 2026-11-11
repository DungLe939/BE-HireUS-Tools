import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AI_PROVIDER } from '../interfaces/ai-provider.interface';
import {
  VmiLanguage,
  VmiLevel,
  VmiPosition,
  VmiStage,
} from '../types/vmi.types';
import type { InitInterviewContextInput } from '../types/vmi.types';
import { VmiModule } from '../vmi.module';
import { GeminiAiProvider } from './gemini-ai.provider';

const input: InitInterviewContextInput = {
  position: VmiPosition.BACKEND,
  level: VmiLevel.INTERN,
  language: VmiLanguage.VI,
};

function plan(count = 6, withCv = false) {
  return {
    context: 'Luyện phỏng vấn kỹ thuật phù hợp vị trí và cấp độ.',
    questionPlan: [
      { stage: 'OPENING', questionText: 'Bạn hãy giới thiệu bản thân.', cvBased: false },
      ...Array.from({ length: count - 2 }, (_, index) => ({
        stage: 'TECHNICAL',
        questionText: `Hãy giải thích quyết định kỹ thuật số ${index + 1}.`,
        cvBased: withCv,
      })),
      { stage: 'CLOSING', questionText: 'Bạn muốn hỏi thêm điều gì?', cvBased: false },
    ],
  };
}

function envelope(text: string, finishReason = 'STOP') {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
  };
}

describe('GeminiAiProvider.initInterviewContext', () => {
  let provider: GeminiAiProvider;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      GEMINI_API_KEY: 'fake-unit-test-key',
      GEMINI_MODEL: 'test-gemini-model',
      GEMINI_TIMEOUT_MS: '15000',
    });
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(envelope(JSON.stringify(plan()))),
    );
    provider = new GeminiAiProvider();
  });

  afterEach(() => jest.restoreAllMocks());

  function respond(value: unknown) {
    fetchMock.mockResolvedValue(Response.json(envelope(JSON.stringify(value))));
  }

  async function expectFailure(status: number, code: string) {
    let failure: unknown;
    try {
      await provider.initInterviewContext(input);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(HttpException);
    const exception = failure as HttpException;
    expect(exception.getStatus()).toBe(status);
    expect(exception.getResponse()).toMatchObject({ code });
    const visible = `${exception.message} ${JSON.stringify(exception.getResponse())}`;
    expect(visible).not.toContain('fake-unit-test-key');
    expect(visible).not.toContain('private-cv-marker');
    expect(exception.cause).toBeUndefined();
  }

  it('returns a validated context, complete plan and its opening question', async () => {
    const result = await provider.initInterviewContext(input);
    expect(result).toEqual({ ...plan(), openingQuestion: plan().questionPlan[0] });
    expect(result.openingQuestion.stage).toBe(VmiStage.OPENING);
  });

  it('uses the env model, header authentication and documented REST JSON mode', async () => {
    await provider.initInterviewContext(input);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/test-gemini-model:generateContent');
    expect(String(url)).not.toContain('fake-unit-test-key');
    expect(options).toMatchObject({
      method: 'POST',
      headers: { 'x-goog-api-key': 'fake-unit-test-key', 'Content-Type': 'application/json' },
      signal: expect.any(AbortSignal),
    });
    const body = JSON.parse(options!.body as string);
    expect(body.generationConfig.responseFormat.text).toMatchObject({
      mimeType: 'APPLICATION_JSON',
      schema: { type: 'object', required: ['context', 'questionPlan'], additionalProperties: false },
    });
  });

  it.each([
    [VmiLanguage.VI, VmiLevel.INTERN, 'Vietnamese', 'OOP'],
    [VmiLanguage.EN, VmiLevel.FRESHER, 'English', 'architecture'],
  ])('sends language %s and level %s with their depth constraints', async (language, level, languageName, depth) => {
    await provider.initInterviewContext({ ...input, language, level });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    const sent = JSON.stringify(body);
    expect(sent).toContain(languageName);
    expect(sent).toContain(depth);
    expect(sent).toContain(level);
    expect(sent).toContain('BACKEND');
    expect(sent).toContain('5-8');
    expect(sent).toContain('3-6');
    expect(sent).toContain('180');
  });

  it('sends CV data and requires at least 40% of technical questions grounded in it', async () => {
    respond(plan(6, true));
    await provider.initInterviewContext({ ...input, cvSnapshot: { id: 'cv-test', summary: 'private-cv-marker' } });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.contents[0].parts[0].text).toContain('private-cv-marker');
    expect(body.systemInstruction.parts[0].text).toContain('40%');
    expect(body.systemInstruction.parts[0].text).toContain('untrusted');
  });

  it.each([5, 8])('accepts a valid %i-question plan', async (count) => {
    respond(plan(count));
    const result = await provider.initInterviewContext({ ...input, targetQuestionCount: count });
    expect(result.questionPlan).toHaveLength(count);
  });

  it('rejects a plan with fewer than 40% CV-based technical questions', async () => {
    const result = plan(8);
    result.questionPlan[1].cvBased = true;
    result.questionPlan[2].cvBased = true;
    respond(result);
    await expect(provider.initInterviewContext({ ...input, targetQuestionCount: 8, cvSnapshot: { id: 'cv-test', summary: 'A sample project' } })).rejects.toMatchObject({
      response: { code: 'AI_INVALID_RESPONSE' },
    });
  });

  it('accepts exactly 40% CV-based technical questions', async () => {
    const result = plan(7);
    result.questionPlan[1].cvBased = true;
    result.questionPlan[2].cvBased = true;
    respond(result);
    await expect(provider.initInterviewContext({ ...input, targetQuestionCount: 7, cvSnapshot: { id: 'cv-test', summary: 'A sample project' } })).resolves.toMatchObject({ questionPlan: result.questionPlan });
  });

  it.each([
    ['missing context', () => ({ questionPlan: plan().questionPlan })],
    ['blank context', () => ({ ...plan(), context: ' ' })],
    ['wrong context type', () => ({ ...plan(), context: 123 })],
    ['missing question plan', () => ({ context: 'Context' })],
    ['non-array question plan', () => ({ ...plan(), questionPlan: {} })],
    ['too few questions', () => plan(4)],
    ['too many questions', () => plan(9)],
    ['unexpected count', () => plan(5)],
    ['unknown property', () => ({ ...plan(), internalPrompt: 'private-cv-marker' })],
    ['invalid stage', () => { const p = plan(); p.questionPlan[2].stage = 'UNKNOWN'; return p; }],
    ['misplaced opening', () => { const p = plan(); p.questionPlan[1].stage = 'OPENING'; return p; }],
    ['missing closing', () => { const p = plan(); p.questionPlan[5].stage = 'TECHNICAL'; return p; }],
    ['empty question', () => { const p = plan(); p.questionPlan[1].questionText = ' '; return p; }],
    ['non-boolean cv flag', () => { const p = plan(); return { ...p, questionPlan: [{ ...p.questionPlan[0], cvBased: 'false' }, ...p.questionPlan.slice(1)] }; }],
    ['CV questions without CV', () => plan(6, true)],
    ['unknown question property', () => { const p = plan(); return { ...p, questionPlan: [{ ...p.questionPlan[0], extra: true }, ...p.questionPlan.slice(1)] }; }],
    ['null response', () => null],
  ])('rejects invalid schema: %s', async (_name, makeValue) => {
    respond(makeValue());
    await expectFailure(502, 'AI_INVALID_RESPONSE');
  });

  it.each(['not JSON private-cv-marker', '{"context":', '```json\n{}\n```'])('rejects malformed generated JSON', async (text) => {
    fetchMock.mockResolvedValue(Response.json(envelope(text)));
    await expectFailure(502, 'AI_INVALID_RESPONSE');
  });

  it.each([
    {},
    { candidates: [] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] },
    envelope(JSON.stringify(plan()), 'MAX_TOKENS'),
    { promptFeedback: { blockReason: 'SAFETY' } },
  ])('rejects missing, blocked or incomplete Gemini content', async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expectFailure(502, 'AI_INVALID_RESPONSE');
  });

  it('joins text parts and excludes thinking content', async () => {
    const text = JSON.stringify(plan());
    fetchMock.mockResolvedValue(Response.json({ candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ thought: true, text: 'internal thinking' }, { text: text.slice(0, 30) }, { text: text.slice(30) }] },
    }] }));
    await expect(provider.initInterviewContext(input)).resolves.toMatchObject(plan());
  });

  it('sanitizes malformed HTTP response JSON', async () => {
    fetchMock.mockResolvedValue(new Response('private-cv-marker fake-unit-test-key'));
    await expectFailure(502, 'AI_INVALID_RESPONSE');
  });

  it.each([[400, 502], [401, 502], [403, 502], [429, 503], [500, 502], [503, 503], [504, 504]])('maps upstream HTTP %i to %i without leaking its body', async (upstream, expected) => {
    fetchMock.mockResolvedValue(new Response('fake-unit-test-key private-cv-marker', { status: upstream }));
    await expectFailure(expected, upstream === 504 ? 'AI_TIMEOUT' : upstream === 429 || upstream === 503 ? 'AI_UNAVAILABLE' : 'AI_HTTP_ERROR');
  });

  it('sanitizes network failures', async () => {
    fetchMock.mockRejectedValue(new Error('fake-unit-test-key private-cv-marker'));
    await expectFailure(503, 'AI_NETWORK_ERROR');
  });

  it.each(['TimeoutError', 'AbortError'])('maps %s to a clean timeout error', async (name) => {
    fetchMock.mockRejectedValue(new DOMException('fake-unit-test-key private-cv-marker', name));
    await expectFailure(504, 'AI_TIMEOUT');
  });

  it('uses GEMINI_TIMEOUT_MS and aborts a pending request', async () => {
    process.env.GEMINI_TIMEOUT_MS = '20';
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
    }));
    await expectFailure(504, 'AI_TIMEOUT');
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });

  it('enforces timeout while reading the response body', async () => {
    process.env.GEMINI_TIMEOUT_MS = '20';
    fetchMock.mockImplementation(async (_url, options) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
      }),
    }) as Response);
    await expectFailure(504, 'AI_TIMEOUT');
  });

  it('defaults timeout to 15000 ms when unset', async () => {
    delete process.env.GEMINI_TIMEOUT_MS;
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    await provider.initInterviewContext(input);
    expect(timeout).toHaveBeenCalledWith(15000);
  });

  it.each([
    ['GEMINI_API_KEY', undefined], ['GEMINI_API_KEY', ' '],
    ['GEMINI_MODEL', undefined], ['GEMINI_MODEL', ' '],
    ['GEMINI_MODEL', '../invalid?key=secret'],
    ['GEMINI_TIMEOUT_MS', '0'], ['GEMINI_TIMEOUT_MS', '-1'],
    ['GEMINI_TIMEOUT_MS', 'abc'], ['GEMINI_TIMEOUT_MS', '1.5'],
    ['GEMINI_TIMEOUT_MS', '4294967296'],
  ])('rejects invalid configuration %s before fetching', async (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    await expectFailure(500, 'AI_CONFIGURATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([4, 9, 5.5])('rejects invalid target count %s before fetching', async (count) => {
    await expect(provider.initInterviewContext({ ...input, targetQuestionCount: count })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('can be injected by AI_PROVIDER without configured credentials at bootstrap', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    const module = await Test.createTestingModule({ imports: [VmiModule] }).compile();
    try {
      expect(module.get(AI_PROVIDER)).toBeInstanceOf(GeminiAiProvider);
    } finally {
      await module.close();
    }
  });
});
