import { BadGatewayException, GatewayTimeoutException, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AI_PROVIDER } from '../src/vmi/interfaces/ai-provider.interface';
import { VMI_SESSION_REPOSITORY } from '../src/vmi/interfaces/vmi-session-repository.interface';
import type { VmiSessionRepository } from '../src/vmi/interfaces/vmi-session-repository.interface';

describe('VMI evaluation (e2e)', () => {
  let app: INestApplication;
  let repository: VmiSessionRepository;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  const ai = { initInterviewContext: jest.fn(), generateNextQuestion: jest.fn(), evaluateInterview: jest.fn() };
  const assessment = { technical: 80, problemSolving: 50, communication: 20,
    strengths: ['Specific strength'], knowledgeGaps: ['Knowledge gap'], suggestedAnswers: ['Better explanation'], reviewTopics: ['Review topic'] };

  beforeAll(async () => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network forbidden'));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER).useValue(ai).compile();
    app = module.createNestApplication(); await app.init();
    repository = app.get(VMI_SESSION_REPOSITORY);
  });
  beforeEach(() => {
    ai.initInterviewContext.mockReset().mockImplementation(async input => {
      const opening = { stage: 'OPENING', questionText: 'Introduce yourself', cvBased: false };
      return { context: 'private-context', openingQuestion: opening, questionPlan: [opening,
        ...Array.from({ length: input.targetQuestionCount - 2 }, () => ({ stage: 'TECHNICAL', questionText: 'Technical topic', cvBased: false })),
        { stage: 'CLOSING', questionText: 'Any questions?', cvBased: false }],
      };
    });
    ai.generateNextQuestion.mockReset().mockImplementation(async input => ({ stage: input.stage, questionText: 'Follow-up', cvBased: false }));
    ai.evaluateInterview.mockReset().mockResolvedValue({ ...assessment, overallScore: 100, band: 'GREEN' });
  });
  afterAll(async () => {
    try { expect(fetchMock).not.toHaveBeenCalled(); }
    finally { await app.close(); jest.restoreAllMocks(); }
  });
  function post(path: string, body: object = {}, owner = 'owner') {
    return request(app.getHttpServer()).post(path).set('x-mock-user-id', owner).send(body);
  }
  function report(id: string, owner = 'owner') {
    return request(app.getHttpServer()).get(`/vmi/sessions/${id}/report`).set('x-mock-user-id', owner);
  }
  async function ended(answers = 1, language = 'en') {
    const created = await post('/vmi/sessions', { position: 'BACKEND', level: 'INTERN', language, targetQuestionCount: 5 }).expect(201);
    const started = (await post(`/vmi/sessions/${created.body.id}/start`, { deviceReady: true }).expect(200)).body;
    let question = started.question;
    for (let index = 0; index < answers; index++) {
      const answered = await post(`/vmi/sessions/${started.id}/answers`, { questionId: question.questionId, answerText: `Confirmed answer ${index}` }).expect(200);
      if (answered.body.question) question = answered.body.question;
    }
    if (answers < 5) await post(`/vmi/sessions/${started.id}/finish`).expect(200);
    return started.id as string;
  }

  it('evaluates a completed interview with all transcript and independent server scoring', async () => {
    const id = await ended(5);
    const response = await post(`/vmi/sessions/${id}/evaluate`).expect(200);
    expect(response.body).toMatchObject({ id, status: 'EVALUATED', language: 'en', report: { ...assessment, overallScore: 59, band: 'YELLOW' } });
    expect(response.body.transcript).toHaveLength(5);
    expect(response.body.transcript.map((turn: { answerText: string }) => turn.answerText)).toEqual(Array.from({ length: 5 }, (_, index) => `Confirmed answer ${index}`));
    expect(response.body.report.disclaimer).toContain('does not predict hiring');
    expect(JSON.stringify(response.body)).not.toContain('private-context');
    expect(response.body).not.toHaveProperty('questionPlan');
    const read = await report(id).expect(200);
    expect(read.body).toEqual(response.body);
    await post(`/vmi/sessions/${id}/evaluate`).expect(409);
    expect(ai.evaluateInterview).toHaveBeenCalledTimes(1);
  });

  it.each([[49.99, 'RED'], [50, 'YELLOW'], [74.99, 'YELLOW'], [75, 'GREEN']] as const)('classifies score %s as %s', async (value, band) => {
    const id = await ended();
    ai.evaluateInterview.mockResolvedValue({ ...assessment, technical: value, problemSolving: value, communication: value });
    const response = await post(`/vmi/sessions/${id}/evaluate`).expect(200);
    expect(response.body.report.overallScore).toBe(value);
    expect(response.body.report.band).toBe(band);
  });

  it('rejects an empty interview without saving any evaluation', async () => {
    const id = await ended(0);
    const before = await repository.findById(id);
    await post(`/vmi/sessions/${id}/evaluate`).expect(422);
    expect(await repository.findById(id)).toEqual(before);
    expect(ai.evaluateInterview).not.toHaveBeenCalled();
    await report(id).expect(404);
  });

  it('protects evaluation and report access by owner', async () => {
    const id = await ended();
    await post(`/vmi/sessions/${id}/evaluate`, {}, 'other').expect(404);
    await report(id, 'other').expect(404);
    await post(`/vmi/sessions/${id}/evaluate`).expect(200);
    await report(id, 'other').expect(404);
  });

  it.each([502,503,504])('preserves every transcript field on AI %i, saving REPORT_FAILED', async status => {
    const id = await ended();
    const before = (await repository.findById(id))!;
    ai.evaluateInterview.mockRejectedValue(status === 504 ? new GatewayTimeoutException('private-marker') : status === 503 ? new ServiceUnavailableException('private-marker') : new BadGatewayException('private-marker'));
    const response = await post(`/vmi/sessions/${id}/evaluate`).expect(status);
    expect(response.body).toMatchObject({ statusCode: status, sessionStatus: 'REPORT_FAILED', code: expect.any(String) });
    expect(JSON.stringify(response.body)).not.toContain('private-marker');
    const after = (await repository.findById(id))!;
    expect(after.status).toBe('REPORT_FAILED');
    expect(after.turns).toEqual(before.turns);
    expect(after.report).toBeUndefined();
    await report(id).expect(404);
    await post(`/vmi/sessions/${id}/evaluate`).expect(409);
  });

  it('localizes recommendations and disclaimer for Vietnamese', async () => {
    const id = await ended(1, 'vi');
    const response = await post(`/vmi/sessions/${id}/evaluate`).expect(200);
    expect(ai.evaluateInterview.mock.calls[0][0].language).toBe('vi');
    expect(response.body.report.disclaimer).toContain('không khẳng định xác suất trúng tuyển');
    expect(response.body.report.recommendation).toContain('Rà soát');
  });

  it('rejects evaluation before the interview ends', async () => {
    const created = await post('/vmi/sessions', { position: 'MOBILE', level: 'FRESHER', language: 'en' }).expect(201);
    await post(`/vmi/sessions/${created.body.id}/evaluate`).expect(409);
    expect(ai.evaluateInterview).not.toHaveBeenCalled();
  });
});
