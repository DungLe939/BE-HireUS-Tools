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
  let logs: jest.SpyInstance;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(TTS_PROVIDER).useValue(tts).compile();
    app = module.createNestApplication(); await app.init(); repository = app.get(VMI_SESSION_REPOSITORY);
  });
  beforeEach(() => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('External network forbidden'));
    logs = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => { jest.restoreAllMocks(); });
  afterAll(async () => { await app.close(); });
  async function seed(language = VmiLanguage.VI, status = VmiSessionStatus.IN_PROGRESS) {
    const id = randomUUID(), questionId = randomUUID(), now = new Date();
    await repository.save({ id, userId: 'owner', language, position: VmiPosition.BACKEND, level: VmiLevel.INTERN,
      status, targetQuestionCount: 5, pendingNextQuestion: false, createdAt: now, updatedAt: now,
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
});
