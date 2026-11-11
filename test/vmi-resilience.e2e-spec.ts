import { randomUUID } from 'node:crypto';
import { BadGatewayException, GatewayTimeoutException, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AI_PROVIDER } from '../src/vmi/interfaces/ai-provider.interface';
import { VMI_SESSION_REPOSITORY } from '../src/vmi/interfaces/vmi-session-repository.interface';
import type { VmiSessionRepository } from '../src/vmi/interfaces/vmi-session-repository.interface';
import { VmiSessionStatus } from '../src/vmi/types/vmi.types';

describe('VMI recovery (e2e)', () => {
  let app: INestApplication;
  let repository: VmiSessionRepository;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  const ai = { initInterviewContext: jest.fn(), generateNextQuestion: jest.fn(), evaluateInterview: jest.fn() };
  const assessment = { technical: 80, problemSolving: 50, communication: 20,
    strengths: ['Strength'], knowledgeGaps: ['Gap'], suggestedAnswers: ['Guidance'], reviewTopics: ['Topic'] };
  const settings = { position: 'BACKEND', level: 'FRESHER', language: 'en', targetQuestionCount: 5 };

  function failure(status: number) {
    return status === 504 ? new GatewayTimeoutException('private-marker') : status === 503
      ? new ServiceUnavailableException('private-marker') : new BadGatewayException('private-marker');
  }
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
      const opening = { stage: 'OPENING', questionText: 'Opening', cvBased: false };
      return { context: 'internal-context-marker', openingQuestion: opening, questionPlan: [opening,
        ...Array.from({ length: input.targetQuestionCount - 2 }, () => ({ stage: 'TECHNICAL', questionText: 'Technical', cvBased: false })),
        { stage: 'CLOSING', questionText: 'Closing', cvBased: false }],
      };
    });
    ai.generateNextQuestion.mockReset().mockImplementation(async input => ({ stage: input.stage, questionText: 'Recovered question', cvBased: input.requireCvBased }));
    ai.evaluateInterview.mockReset().mockResolvedValue({ ...assessment, overallScore: 100, band: 'GREEN' });
  });
  afterAll(async () => {
    try { expect(fetchMock).not.toHaveBeenCalled(); }
    finally { await app.close(); jest.restoreAllMocks(); }
  });
  function post(id: string, action: string, body: object = {}, owner = 'owner') {
    return request(app.getHttpServer()).post(`/vmi/sessions/${id}/${action}`).set('x-mock-user-id', owner).send(body);
  }
  async function created() {
    return (await request(app.getHttpServer()).post('/vmi/sessions').set('x-mock-user-id', 'owner').send(settings).expect(201)).body;
  }
  async function started() {
    const session = await created();
    return (await post(session.id, 'start', { deviceReady: true }).expect(200)).body;
  }
  function answer(id: string, questionId: string) {
    return post(id, 'answers', { questionId, answerText: 'Saved confirmed answer' });
  }
  async function pendingThird() {
    const session = await started();
    const second = (await answer(session.id, session.question.questionId).expect(200)).body;
    ai.generateNextQuestion.mockRejectedValueOnce(failure(504));
    await answer(session.id, second.question.questionId).expect(504);
    return session.id as string;
  }
  async function failedReport() {
    const id = await pendingThird();
    await post(id, 'finish').expect(200);
    ai.evaluateInterview.mockRejectedValueOnce(failure(503));
    await post(id, 'evaluate').expect(503);
    return id;
  }

  it.each([502,503,504])('recovers question three after repeated AI %i errors without duplicating turns', async status => {
    const id = await pendingThird();
    const before = (await repository.findById(id))!;
    ai.generateNextQuestion.mockRejectedValueOnce(failure(status));
    const failed = await post(id, 'next-question/retry').expect(status);
    expect(failed.body).toMatchObject({ statusCode: status, pendingNextQuestion: true });
    expect(JSON.stringify(failed.body)).not.toContain('private-marker');
    const pending = (await repository.findById(id))!;
    expect(pending.turns).toEqual(before.turns);
    expect(pending.pendingNextQuestion).toBe(true);
    const result = await post(id, 'next-question/retry').expect(200);
    expect(result.body).toMatchObject({ id, completed: false, status: 'IN_PROGRESS', question: { stage: 'TECHNICAL' } });
    expect(result.body).not.toHaveProperty('context'); expect(result.body).not.toHaveProperty('questionPlan');
    const saved = (await repository.findById(id))!;
    expect(saved.turns).toHaveLength(3); expect(saved.turns.slice(0,2)).toEqual(before.turns);
    expect(new Set(saved.turns.map(turn => turn.questionId)).size).toBe(3);
    expect(saved.pendingNextQuestion).toBe(false); expect(saved.lastAiError).toBeUndefined();
    expect(ai.generateNextQuestion.mock.calls.at(-1)![0]).toMatchObject({ transcript: before.turns, context: before.context, questionPlan: before.questionPlan });
    const calls = ai.generateNextQuestion.mock.calls.length;
    await post(id, 'next-question/retry').expect(409);
    expect(ai.generateNextQuestion).toHaveBeenCalledTimes(calls);
  });

  it.each([502,503,504])('recovers the report after repeated AI %i errors and computes its own score', async status => {
    const id = await failedReport();
    const before = (await repository.findById(id))!;
    ai.evaluateInterview.mockRejectedValueOnce(failure(status));
    const failed = await post(id, 'report/retry').expect(status);
    expect(failed.body).toMatchObject({ statusCode: status, sessionStatus: 'REPORT_FAILED', code: expect.any(String) });
    expect(JSON.stringify(failed.body)).not.toContain('private-marker');
    const failedAgain = (await repository.findById(id))!;
    expect(failedAgain.status).toBe('REPORT_FAILED'); expect(failedAgain.report).toBeUndefined();
    expect(failedAgain.turns).toEqual(before.turns);
    const result = await post(id, 'report/retry').expect(200);
    expect(result.body).toMatchObject({ id, status: 'EVALUATED', report: { ...assessment, overallScore: 59, band: 'YELLOW' } });
    expect(result.body.transcript[0].answerText).toBe('Saved confirmed answer');
    expect(result.body).not.toHaveProperty('context'); expect(result.body).not.toHaveProperty('questionPlan');
    const saved = (await repository.findById(id))!;
    expect(saved.turns).toEqual(before.turns); expect(saved.lastAiError).toBeUndefined();
    const read = await request(app.getHttpServer()).get(`/vmi/sessions/${id}/report`).set('x-mock-user-id', 'owner').expect(200);
    expect(read.body).toEqual(result.body);
    const calls = ai.evaluateInterview.mock.calls.length;
    await post(id, 'report/retry').expect(409);
    await post(id, 'evaluate').expect(409);
    expect(ai.evaluateInterview).toHaveBeenCalledTimes(calls);
  });

  it('rejects both retries for SETUP, healthy IN_PROGRESS and ENDED sessions', async () => {
    const session = await created();
    for (const action of ['next-question/retry','report/retry']) await post(session.id, action).expect(409);
    await post(session.id, 'start', { deviceReady: true }).expect(200);
    for (const action of ['next-question/retry','report/retry']) await post(session.id, action).expect(409);
    await post(session.id, 'finish').expect(200);
    for (const action of ['next-question/retry','report/retry']) await post(session.id, action).expect(409);
    expect(ai.generateNextQuestion).not.toHaveBeenCalled(); expect(ai.evaluateInterview).not.toHaveBeenCalled();
  });

  it('returns 404 to other users, and 400 for malformed IDs', async () => {
    const pending = await pendingThird();
    await post(pending, 'next-question/retry', {}, 'other').expect(404);
    const failed = await failedReport();
    await post(failed, 'report/retry', {}, 'other').expect(404);
    for (const action of ['next-question/retry','report/retry']) {
      await post(randomUUID(), action).expect(404);
      await post('invalid-id', action).expect(400);
    }
  });

  it('rejects next-question retry while original answer generation is running', async () => {
    const session = await started();
    let release!: () => void; let entered!: () => void;
    const enteredAi = new Promise<void>(r => { entered = r; });
    ai.generateNextQuestion.mockImplementationOnce(async input => {
      entered(); await new Promise<void>(r => { release = r; });
      return { stage: input.stage, questionText: 'Next', cvBased: false };
    });
    const original = answer(session.id, session.question.questionId).then(response => response);
    await enteredAi;
    try { await post(session.id, 'next-question/retry').expect(409); }
    finally { release(); }
    expect((await original).status).toBe(200);
    expect(ai.generateNextQuestion).toHaveBeenCalledTimes(1);
    expect((await repository.findById(session.id))!.turns).toHaveLength(2);
  });

  it('rejects concurrent next-question retries without running AI twice', async () => {
    const id = await pendingThird();
    let release!: () => void; let entered!: () => void;
    const enteredAi = new Promise<void>(r => { entered = r; });
    ai.generateNextQuestion.mockImplementationOnce(async input => {
      entered(); await new Promise<void>(r => { release = r; });
      return { stage: input.stage, questionText: 'Recovered', cvBased: false };
    });
    const first = post(id, 'next-question/retry').then(response => response);
    await enteredAi;
    const calls = ai.generateNextQuestion.mock.calls.length;
    try { await post(id, 'next-question/retry').expect(409); }
    finally { release(); }
    expect((await first).status).toBe(200);
    expect(ai.generateNextQuestion).toHaveBeenCalledTimes(calls);
    expect((await repository.findById(id))!.turns).toHaveLength(3);
  });

  it('rejects concurrent report retries and keeps evaluate ENDED-only', async () => {
    const id = await failedReport();
    let release!: () => void; let entered!: () => void;
    const enteredAi = new Promise<void>(r => { entered = r; });
    ai.evaluateInterview.mockImplementationOnce(async () => {
      entered(); await new Promise<void>(r => { release = r; }); return assessment;
    });
    const first = post(id, 'report/retry').then(response => response);
    await enteredAi;
    const calls = ai.evaluateInterview.mock.calls.length;
    try {
      await post(id, 'report/retry').expect(409);
      await post(id, 'evaluate').expect(409);
    } finally { release(); }
    expect((await first).status).toBe(200);
    expect(ai.evaluateInterview).toHaveBeenCalledTimes(calls);
  });

  it('recovers the closing question and ends after its answer without a sixth question', async () => {
    const session = await started();
    let question = session.question;
    for (let index = 0; index < 3; index++) question = (await answer(session.id, question.questionId).expect(200)).body.question;
    ai.generateNextQuestion.mockRejectedValueOnce(failure(504));
    await answer(session.id, question.questionId).expect(504);
    const recovered = await post(session.id, 'next-question/retry').expect(200);
    expect(recovered.body.question.stage).toBe('CLOSING'); expect(recovered.body.completed).toBe(false);
    const calls = ai.generateNextQuestion.mock.calls.length;
    const completed = await answer(session.id, recovered.body.question.questionId).expect(200);
    expect(completed.body).toMatchObject({ status: 'ENDED', completed: true });
    expect((await repository.findById(session.id))!.turns).toHaveLength(5);
    expect(ai.generateNextQuestion).toHaveBeenCalledTimes(calls);
    await post(session.id, 'next-question/retry').expect(409);
  });

  it('completes a pending fully answered session without calling AI or changing transcript', async () => {
    const session = await started();
    let question = session.question;
    for (let index = 0; index < 5; index++) {
      const response = await answer(session.id, question.questionId).expect(200);
      if (response.body.question) question = response.body.question;
    }
    const before = (await repository.findById(session.id))!;
    before.status = VmiSessionStatus.IN_PROGRESS; before.pendingNextQuestion = true; before.lastAiError = 'VMI_NEXT_QUESTION_TIMEOUT';
    delete before.endedAt;
    await repository.save(before);
    const calls = ai.generateNextQuestion.mock.calls.length;
    const response = await post(session.id, 'next-question/retry').expect(200);
    expect(response.body).toMatchObject({ status: 'ENDED', completed: true });
    expect(response.body).not.toHaveProperty('question');
    const saved = (await repository.findById(session.id))!;
    expect(saved.turns).toEqual(before.turns); expect(saved.pendingNextQuestion).toBe(false); expect(saved.lastAiError).toBeUndefined();
    expect(ai.generateNextQuestion).toHaveBeenCalledTimes(calls);
  });

  it.each([false,true])('preserves finish while retry is waiting for late AI success/failure (%s)', async fail => {
    const id = await pendingThird();
    let release!: () => void; let entered!: () => void;
    const enteredAi = new Promise<void>(r => { entered = r; });
    ai.generateNextQuestion.mockImplementationOnce(async input => {
      entered(); await new Promise<void>(r => { release = r; });
      if (fail) throw failure(504);
      return { stage: input.stage, questionText: 'Late', cvBased: false };
    });
    const first = post(id, 'next-question/retry').then(response => response);
    await enteredAi;
    const before = (await repository.findById(id))!.turns;
    try { await post(id, 'finish').expect(200); }
    finally { release(); }
    expect((await first).body).toMatchObject({ status: 'ENDED', completed: true });
    const saved = (await repository.findById(id))!;
    expect(saved.status).toBe('ENDED'); expect(saved.turns).toEqual(before);
  });
});
