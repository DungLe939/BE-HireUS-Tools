import { STT_PROVIDER, MAX_AUDIO_BYTES } from '../src/vmi/interfaces/stt-provider.interface';
import { FakeSttProvider } from '../src/vmi/providers/fake-stt.provider';
import { AI_PROVIDER } from '../src/vmi/interfaces/ai-provider.interface';
import { UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';
import { VmiService } from '../src/vmi/vmi.service';
import { BadGatewayException, GatewayTimeoutException, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { TTS_PROVIDER } from '../src/vmi/interfaces/tts-provider.interface';
import { FakeTtsProvider } from '../src/vmi/providers/fake-tts.provider';
import { VMI_SESSION_REPOSITORY } from '../src/vmi/interfaces/vmi-session-repository.interface';
import type { VmiSessionRepository } from '../src/vmi/interfaces/vmi-session-repository.interface';
import { VmiLanguage, VmiLevel, VmiPosition, VmiSessionStatus, VmiStage } from '../src/vmi/types/vmi.types';

describe('VMI audio (fake providers, no external network)', () => {
  let app: INestApplication;
  let repository: VmiSessionRepository;
  const tts = new FakeTtsProvider();
  const stt = new FakeSttProvider();
  const ai = { generateNextQuestion: jest.fn() };
  const environment = { ...process.env };
  let logs: jest.SpyInstance;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(TTS_PROVIDER).useValue(tts).overrideProvider(STT_PROVIDER).useValue(stt).overrideProvider(AI_PROVIDER).useValue(ai).compile();
    app = module.createNestApplication(); await app.init(); repository = app.get(VMI_SESSION_REPOSITORY);
  });
  beforeEach(() => {
    delete process.env.VMI_AUDIO_MAX_BYTES;
    ai.generateNextQuestion.mockReset().mockResolvedValue({ stage: VmiStage.TECHNICAL, questionText: "Next fixture", cvBased: false });
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External network forbidden'));
    logs = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => { process.env = { ...environment }; jest.restoreAllMocks(); });
  afterAll(async () => { await app.close(); });
  async function seed(language = VmiLanguage.VI, status = VmiSessionStatus.IN_PROGRESS) {
    const id = randomUUID(), questionId = randomUUID(), now = new Date();
    await repository.save({ id, userId: 'owner', language, position: VmiPosition.BACKEND, level: VmiLevel.INTERN,
      status, targetQuestionCount: 5, pendingNextQuestion: false, createdAt: now, updatedAt: now,
      context: 'Fixture context', questionPlan: Array.from({ length: 5 }, () => ({ stage: VmiStage.TECHNICAL, questionText: 'Fixture', cvBased: false })),
      turns: status === VmiSessionStatus.SETUP ? [] : [{ questionId, questionText: 'Private fixture', stage: VmiStage.OPENING, askedAt: now }] });
    return { id, questionId, snapshot: await repository.findById(id) };
  }
  function audio(id: string, questionId: string, owner = 'owner') {
    return request(app.getHttpServer()).get(`/vmi/sessions/${id}/questions/${questionId}/audio`).set('x-mock-user-id', owner);
  }
  it.each([VmiLanguage.VI, VmiLanguage.EN])('returns repeatable WAV in %s without mutation', async language => {
    const { id, questionId, snapshot } = await seed(language);
    const spy = jest.spyOn(tts, 'synthesize');
    for (let i = 0; i < 2; i++) {
      const result = await audio(id, questionId).expect(200).expect('Content-Type', /audio\/wav/).expect('Cache-Control', 'no-store');
      expect(result.body).toEqual(await new FakeTtsProvider().synthesize());
    }
    expect(spy).toHaveBeenCalledWith('Private fixture', language);
    expect(await repository.findById(id)).toEqual(snapshot);
  });
  it('hides foreign sessions and questions outside the session', async () => {
    const { id, questionId } = await seed();
    await audio(id, questionId, 'other').expect(404);
    await audio(randomUUID(), questionId).expect(404);
    await audio(id, randomUUID()).expect(404);
    await audio('invalid', questionId).expect(400);
  });
  it.each([VmiSessionStatus.ENDED, VmiSessionStatus.EVALUATED, VmiSessionStatus.REPORT_FAILED])('rejects playback in %s', async status => {
    const { id, questionId } = await seed(VmiLanguage.VI, status);
    await audio(id, questionId).expect(400);
  });
  it('SETUP has no saved question in existing code', async () => {
    const { id, questionId } = await seed(VmiLanguage.VI, VmiSessionStatus.SETUP);
    await audio(id, questionId).expect(404);
  });
  it.each([502, 503, 504])('preserves session on TTS %i and permits retry', async status => {
    const { id, questionId, snapshot } = await seed();
    const failure = status === 504 ? new GatewayTimeoutException('private') : status === 503 ? new ServiceUnavailableException('private') : new BadGatewayException('private');
    jest.spyOn(tts, 'synthesize').mockRejectedValueOnce(failure);
    const result = await audio(id, questionId).expect(status);
    expect(result.body.code).toBe(status === 504 ? 'VMI_TTS_TIMEOUT' : 'VMI_TTS_UNAVAILABLE');
    expect(JSON.stringify(result.body)).not.toContain('private');
    expect(await repository.findById(id)).toEqual(snapshot);
    await audio(id, questionId).expect(200);
    expect(logs.mock.calls.every(args => Object.keys(args[0]).sort().join(',') === 'durationMs,event')).toBe(true);
  });
  it('coalesces concurrent playback and releases the lock after failure', async () => {
    const { id, questionId } = await seed();
    let resolve!: (audio: Buffer) => void;
    const spy = jest.spyOn(tts, 'synthesize').mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const service = app.get(VmiService);
    const first = service.synthesizeQuestion('owner', id, questionId);
    const second = service.synthesizeQuestion('owner', id, questionId);
    await new Promise(r => setImmediate(r));
    resolve(await new FakeTtsProvider().synthesize());
    await Promise.all([first, second]);
    expect(spy).toHaveBeenCalledTimes(1);
    await audio(id, questionId).expect(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });
  function transcribe(id: string, mime = 'audio/webm', bytes = Buffer.from('mock audio fixture'), owner = 'owner') {
    return request(app.getHttpServer()).post(`/vmi/sessions/${id}/transcribe`).set('x-mock-user-id', owner)
      .attach('audio', bytes, { filename: 'fixture', contentType: mime });
  }
  it.each(['audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a'])('STT accepts %s and leaves draft unsubmitted', async mime => {
    const { id, snapshot } = await seed();
    const result = await transcribe(id, mime).expect(200).expect('Cache-Control', 'no-store');
    expect(result.body).toEqual({ text: 'Draft fixture', language: 'vi' });
    expect(await repository.findById(id)).toEqual(snapshot);
    expect(ai.generateNextQuestion).not.toHaveBeenCalled();
  });
  it('takes STT language only from session and permits confirmation through /answers', async () => {
    const { id, questionId } = await seed(VmiLanguage.EN);
    const spy = jest.spyOn(stt, 'transcribe');
    expect((await transcribe(id).expect(200)).body.language).toBe('en');
    expect(spy).toHaveBeenCalledWith(expect.any(Object), VmiLanguage.EN);
    await request(app.getHttpServer()).post(`/vmi/sessions/${id}/transcribe`).set('x-mock-user-id', 'owner')
      .field('language', 'vi').attach('audio', Buffer.from('fixture'), { filename: 'fixture', contentType: 'audio/wav' }).expect(400);
    await request(app.getHttpServer()).post(`/vmi/sessions/${id}/answers`).set('x-mock-user-id', 'owner')
      .send({ questionId, answerText: 'User corrected draft' }).expect(200);
    expect((await repository.findById(id))!.turns[0].answerText).toBe('User corrected draft');
  });
  it('STT conceals foreign/missing sessions', async () => {
    const { id } = await seed();
    await transcribe(id, 'audio/wav', Buffer.from('fixture'), 'other').expect(404);
    await transcribe(randomUUID()).expect(404);
  });
  it.each([VmiSessionStatus.SETUP, VmiSessionStatus.ENDED, VmiSessionStatus.EVALUATED, VmiSessionStatus.REPORT_FAILED])('STT rejects %s (400)', async status => {
    const { id } = await seed(VmiLanguage.VI, status);
    await transcribe(id).expect(400);
  });
  it('rejects STT without an awaiting question or while next-question generation is pending', async () => {
    const { id, snapshot } = await seed();
    for (const session of [{ ...snapshot!, turns: [] }, { ...snapshot!, pendingNextQuestion: true },
      { ...snapshot!, turns: [{ ...snapshot!.turns[0], answerText: 'Saved fixture' }] }]) {
      await repository.save(session); await transcribe(id).expect(400);
    }
  });
  it('rejects empty, absent, extra and wrong-field uploads', async () => {
    const { id } = await seed();
    await request(app.getHttpServer()).post(`/vmi/sessions/${id}/transcribe`).set('x-mock-user-id', 'owner').send({}).expect(400);
    await transcribe(id, 'audio/wav', Buffer.alloc(0)).expect(400);
    await request(app.getHttpServer()).post(`/vmi/sessions/${id}/transcribe`).set('x-mock-user-id', 'owner')
      .attach('other', Buffer.from('fixture'), { filename: 'fixture', contentType: 'audio/wav' }).expect(400);
    await request(app.getHttpServer()).post(`/vmi/sessions/${id}/transcribe`).set('x-mock-user-id', 'owner')
      .attach('audio', Buffer.from('fixture'), { filename: 'fixture', contentType: 'audio/wav' })
      .attach('audio', Buffer.from('fixture'), { filename: 'fixture', contentType: 'audio/wav' }).expect(400);
  });
  it('rejects hard-cap and configured upload excess (413)', async () => {
    const { id, snapshot } = await seed();
    await transcribe(id, 'audio/wav', Buffer.alloc(MAX_AUDIO_BYTES + 1)).expect(413);
    process.env.VMI_AUDIO_MAX_BYTES = '4';
    await transcribe(id, 'audio/wav', Buffer.alloc(5)).expect(413);
    expect(await repository.findById(id)).toEqual(snapshot);
  });
  it('rejects unsupported MIME (415)', async () => {
    const { id } = await seed();
    const spy = jest.spyOn(stt, 'transcribe');
    await transcribe(id, 'text/plain').expect(415);
    expect(spy).not.toHaveBeenCalled();
  });
  it.each([502, 503, 504])('STT failure %i preserves saved transcript, permits retry and typed answer', async status => {
    const { id, questionId, snapshot } = await seed();
    const failure = status === 504 ? new GatewayTimeoutException('private') : status === 503 ? new ServiceUnavailableException('private') : new BadGatewayException('private');
    jest.spyOn(stt, 'transcribe').mockRejectedValueOnce(failure);
    const result = await transcribe(id).expect(status);
    expect(result.body.code).toBe(status === 504 ? 'VMI_STT_TIMEOUT' : 'VMI_STT_UNAVAILABLE');
    expect(JSON.stringify(result.body)).not.toContain('private');
    expect(await repository.findById(id)).toEqual(snapshot);
    await transcribe(id).expect(200);
    await request(app.getHttpServer()).post(`/vmi/sessions/${id}/answers`).set('x-mock-user-id', 'owner')
      .send({ questionId, answerText: 'Typed fallback' }).expect(200);
  });
  it.each(['VMI_STT_EMPTY_TRANSCRIPT', 'VMI_STT_AUDIO_TOO_LONG'])('preserves explicit STT validation %s', async code => {
    const { id, snapshot } = await seed();
    jest.spyOn(stt, 'transcribe').mockRejectedValueOnce(new UnprocessableEntityException({ code, message: 'private' }));
    expect((await transcribe(id).expect(422)).body.code).toBe(code);
    expect(await repository.findById(id)).toEqual(snapshot);
  });
  it('preserves decoded-format 415 and records only latency', async () => {
    const { id } = await seed();
    jest.spyOn(stt, 'transcribe').mockRejectedValueOnce(new UnsupportedMediaTypeException('private'));
    await transcribe(id).expect(415);
    expect(logs.mock.calls).toEqual([[{ event: 'stt', durationMs: expect.any(Number) }]]);
  });
  it('blocks double transcription and releases lock even after failure', async () => {
    const { id } = await seed();
    let reject!: (e: Error) => void;
    jest.spyOn(stt, 'transcribe').mockImplementationOnce(() => new Promise((_r, j) => { reject = j; }));
    const service = app.get(VmiService);
    const file = { buffer: Buffer.from('fixture'), mimetype: 'audio/wav', size: 7 };
    const first = service.transcribeAudio('owner', id, file);
    const failure = expect(first).rejects.toMatchObject({ status: 502 });
    await new Promise(r => setImmediate(r));
    await expect(service.transcribeAudio('owner', id, file)).rejects.toMatchObject({ status: 400 });
    reject(new Error('private fixture'));
    await failure;
    await transcribe(id).expect(200);
  });

});
