import { randomUUID } from 'node:crypto';
import { BadGatewayException, GatewayTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AI_PROVIDER } from '../src/vmi/interfaces/ai-provider.interface';
import { CV_PROVIDER } from '../src/vmi/interfaces/cv-provider.interface';
import { VMI_SESSION_REPOSITORY } from '../src/vmi/interfaces/vmi-session-repository.interface';
import type { VmiSessionRepository } from '../src/vmi/interfaces/vmi-session-repository.interface';
import { VmiStage } from '../src/vmi/types/vmi.types';

const setup = { position: 'BACKEND', level: 'INTERN', language: 'vi' };
const opening = { stage: VmiStage.OPENING, questionText: 'Giới thiệu bản thân.', cvBased: false };
const aiResult = {
  context: 'private-context-marker', openingQuestion: opening,
  questionPlan: [opening, ...Array.from({ length: 4 }, () => ({
    stage: VmiStage.TECHNICAL, questionText: 'Câu hỏi kỹ thuật.', cvBased: true,
  })), { stage: VmiStage.CLOSING, questionText: 'Bạn có câu hỏi nào không?', cvBased: false }],
};

describe('VMI sessions (e2e)', () => {
  let app: INestApplication;
  let repository: VmiSessionRepository;
  const ai = { initInterviewContext: jest.fn() };
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeAll(async () => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real fetch is forbidden in VMI e2e'));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER).useValue(ai).compile();
    app = module.createNestApplication();
    await app.init();
    repository = app.get(VMI_SESSION_REPOSITORY);
  });

  beforeEach(() => {
    ai.initInterviewContext.mockReset().mockResolvedValue(structuredClone(aiResult));
  });

  afterAll(async () => {
    try {
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
      fetchMock.mockRestore();
    }
  });

  function create(owner = 'user-a', body: object = setup) {
    return request(app.getHttpServer()).post('/vmi/sessions').set('x-mock-user-id', owner).send(body);
  }

  function start(id: string, owner = 'user-a', body: object = { deviceReady: true }) {
    return request(app.getHttpServer()).post(`/vmi/sessions/${id}/start`).set('x-mock-user-id', owner).send(body);
  }

  it('GET /vmi/options returns all supported choices', async () => {
    const response = await request(app.getHttpServer()).get('/vmi/options').expect(200);
    expect(response.body).toEqual({
      positions: ['FRONTEND', 'BACKEND', 'FULLSTACK', 'MOBILE', 'AI_DATA'],
      levels: ['INTERN', 'FRESHER'], languages: ['vi', 'en'],
      targetQuestionCount: { min: 5, max: 8, default: 6 },
    });
  });

  it('creates without CV, then starts only after device confirmation', async () => {
    const created = await create().expect(201);
    expect(created.body).toEqual({
      id: expect.any(String), ...setup, status: 'SETUP', targetQuestionCount: 6,
      createdAt: expect.any(String), updatedAt: expect.any(String),
    });
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
    const started = await start(created.body.id).expect(200);
    expect(started.body).toEqual({
      id: created.body.id, status: 'IN_PROGRESS', startedAt: expect.any(String),
      question: { questionId: expect.any(String), questionText: opening.questionText, stage: 'OPENING', askedAt: expect.any(String) },
    });
    expect(started.body.startedAt).toBe(started.body.question.askedAt);
    expect(JSON.stringify(started.body)).not.toContain('private-context-marker');
    expect(ai.initInterviewContext).toHaveBeenCalledTimes(1);
    expect(ai.initInterviewContext).toHaveBeenCalledWith({ ...setup, targetQuestionCount: 6 });
    await start(created.body.id).expect(409);
    expect(ai.initInterviewContext).toHaveBeenCalledTimes(1);
  });

  it.each(['FRONTEND', 'BACKEND', 'FULLSTACK', 'MOBILE', 'AI_DATA'])('accepts position %s', async (position) => {
    const response = await create('user-a', { ...setup, position }).expect(201);
    expect(response.body.position).toBe(position);
  });

  it.each([
    ['INTERN', 'vi', 5], ['INTERN', 'en', 8], ['FRESHER', 'vi', 8], ['FRESHER', 'en', 5],
  ])('passes level %s, language %s and count %i to AI on start', async (level, language, targetQuestionCount) => {
    const created = await create('user-a', { ...setup, level, language, targetQuestionCount }).expect(201);
    await start(created.body.id).expect(200);
    expect(ai.initInterviewContext).toHaveBeenCalledWith({ ...setup, level, language, targetQuestionCount });
  });

  it.each([
    {}, { ...setup, position: 'DESIGN' }, { ...setup, level: 'SENIOR' },
    { ...setup, language: 'fr' }, { ...setup, language: null },
    { ...setup, cvId: null }, { ...setup, cvId: '' }, { ...setup, cvId: ' ' },
    { ...setup, cvId: 5 }, { ...setup, cvId: 'x'.repeat(201) },
    { ...setup, targetQuestionCount: 4 }, { ...setup, targetQuestionCount: 9 },
    { ...setup, targetQuestionCount: 5.5 }, { ...setup, targetQuestionCount: '6' },
    { ...setup, targetQuestionCount: null }, { ...setup, userId: 'spoofed' },
    { ...setup, cvSnapshot: { summary: 'forged' } },
  ])('rejects invalid creation DTO %#', async (body) => {
    const response = await create('user-a', body).expect(400);
    expect(response.body).toMatchObject({ statusCode: 400, error: 'Bad Request', message: expect.any(Array) });
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
  });

  it('returns 404 for every cvId while EmptyCvProvider is active', async () => {
    await create('user-a', { ...setup, cvId: 'missing-cv' }).expect(404);
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
  });

  it.each([{}, { deviceReady: false }, { deviceReady: 'true' }, { deviceReady: 1 }, { deviceReady: null }, { deviceReady: true, extra: true }])('rejects invalid readiness DTO %# without changing SETUP', async (body) => {
    const created = await create().expect(201);
    const before = await repository.findById(created.body.id);
    await start(created.body.id, 'user-a', body).expect(400);
    expect(await repository.findById(created.body.id)).toEqual(before);
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
  });

  it('isolates user identities and hides the existence of foreign sessions', async () => {
    const created = await create('user-a').expect(201);
    const foreign = await start(created.body.id, 'user-b').expect(404);
    const missing = await start(randomUUID(), 'user-b').expect(404);
    expect(foreign.body).toEqual(missing.body);
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
    await start(created.body.id, 'user-a').expect(200);
  });

  it('rejects malformed IDs before invoking AI', async () => {
    await start('not-a-uuid').expect(400);
    expect(ai.initInterviewContext).not.toHaveBeenCalled();
  });

  it.each([
    [new BadGatewayException('sensitive-provider-marker'), 502, 'VMI_AI_ERROR'],
    [new ServiceUnavailableException('sensitive-provider-marker'), 503, 'VMI_AI_UNAVAILABLE'],
    [new GatewayTimeoutException('sensitive-provider-marker'), 504, 'VMI_AI_TIMEOUT'],
    [new Error('sensitive-provider-marker'), 502, 'VMI_AI_ERROR'],
  ])('keeps SETUP on AI failure and supports retrying start', async (error, status, code) => {
    const created = await create().expect(201);
    const before = await repository.findById(created.body.id);
    ai.initInterviewContext.mockRejectedValueOnce(error);
    const failed = await start(created.body.id).expect(status);
    expect(failed.body).toMatchObject({ statusCode: status, code, error: expect.any(String), message: expect.any(String) });
    expect(JSON.stringify(failed.body)).not.toContain('sensitive-provider-marker');
    expect(await repository.findById(created.body.id)).toEqual(before);
    await start(created.body.id).expect(200);
    expect((await repository.findById(created.body.id))!.turns).toHaveLength(1);
  });

  it.each(['production', 'development', undefined])('ignores identity headers when NODE_ENV=%s', async (environment) => {
    const original = process.env.NODE_ENV;
    try {
      if (environment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = environment;
      const created = await create('header-user-a').expect(201);
      expect((await repository.findById(created.body.id))!.userId).toBe('vmi-mock-user');
      await start(created.body.id, 'header-user-b').expect(200);
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  });
});

describe('VMI sessions with an overridden CV provider (e2e)', () => {
  it('uses a snapshot of the owner CV despite edits before start', async () => {
    const sourceCv = { id: 'cv-1', summary: 'Original CV project' };
    const cv = { getSummary: jest.fn().mockResolvedValue(sourceCv) };
    const ai = { initInterviewContext: jest.fn().mockResolvedValue(structuredClone(aiResult)) };
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real fetch is forbidden in VMI e2e'));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER).useValue(ai)
      .overrideProvider(CV_PROVIDER).useValue(cv).compile();
    const app = module.createNestApplication();
    try {
      await app.init();
      const created = await request(app.getHttpServer()).post('/vmi/sessions')
        .set('x-mock-user-id', 'cv-owner').send({ ...setup, cvId: 'cv-1' }).expect(201);
      expect(created.body.cvId).toBe('cv-1');
      expect(created.body).not.toHaveProperty('cvSnapshot');
      sourceCv.summary = 'Edited CV project';
      await request(app.getHttpServer()).post(`/vmi/sessions/${created.body.id}/start`)
        .set('x-mock-user-id', 'cv-owner').send({ deviceReady: true }).expect(200);
      expect(cv.getSummary).toHaveBeenCalledTimes(1);
      expect(cv.getSummary).toHaveBeenCalledWith('cv-owner', 'cv-1');
      expect(ai.initInterviewContext).toHaveBeenCalledWith({
        ...setup, targetQuestionCount: 6, cvSnapshot: { id: 'cv-1', summary: 'Original CV project' },
      });
      const repository = app.get<VmiSessionRepository>(VMI_SESSION_REPOSITORY);
      expect((await repository.findById(created.body.id))!.cvSnapshot!.summary).toBe('Original CV project');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
      fetchMock.mockRestore();
    }
  });
});
